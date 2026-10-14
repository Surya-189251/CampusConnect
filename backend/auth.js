const express = require("express");
const bcrypt = require("bcryptjs");
const crypto = require("node:crypto");
const { rateLimit } = require("express-rate-limit");
const pool = require("./db");

const router = express.Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    message: "Too many login attempts. Please try again after 15 minutes.",
  },
});

// Used so unknown accounts also go through a password comparison.
const dummyHash = bcrypt.hashSync(
  crypto.randomBytes(32).toString("hex"),
  12
);

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function publicUser(user) {
  return {
    id: user.id,
    loginId: user.login_id,
    fullName: user.full_name,
    role: user.role,
    status: user.status,
    collegeId: user.college_id,
    collegeName: user.college_name,
    mustChangePassword: Boolean(user.must_change_password),
  };
}

// Check the session and current account status on every protected request.
async function requireAuth(req, res, next) {
  const authorization = req.get("Authorization") || "";
  const match = /^Bearer ([a-f0-9]{64})$/i.exec(authorization);

  if (!match) {
    return res.status(401).json({
      message: "Please log in to continue.",
    });
  }

  try {
    const tokenHash = hashToken(match[1]);

    const result = await pool.query(
  `SELECT
     s.id AS session_id,
     u.id,
     u.login_id,
     u.full_name,
     u.role,
     u.status,
     u.college_id, u.must_change_password,
     c.name AS college_name
   FROM sessions s
   JOIN users u ON u.id = s.user_id
   JOIN colleges c ON c.id = u.college_id
   WHERE s.token_hash = $1
     AND s.expires_at > NOW()
     AND c.is_active = TRUE`,
  [tokenHash]
);
    const user = result.rows[0];

    if (!user || user.status !== "approved") {
      return res.status(401).json({
        message: "Your session expired or your account is no longer active.",
      });
    }

    if (user.must_change_password && !['/api/auth/me','/api/auth/logout','/api/auth/change-password'].includes(req.originalUrl.split('?')[0])) {
      return res.status(403).json({ message: 'Set your own password before accessing your account.' });
    }
    req.user = user;
    req.sessionId = user.session_id;
    next();
  } catch (error) {
    next(error);
  }
}

// Future routes will use this to restrict access by account role.
function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        message: "You do not have permission to perform this action.",
      });
    }

    next();
  };
}

router.use((req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});

router.post("/login", loginLimiter, async (req, res, next) => {
  try {
const { loginId, password, role, collegeCode } = req.body || {};

if (
  typeof collegeCode !== "string" ||
  !collegeCode.trim() ||
  collegeCode.trim().length > 30
) {
  return res.status(400).json({
    message: "Select your college.",
  });
}

    if (
      typeof loginId !== "string" ||
      !loginId.trim() ||
      loginId.trim().length > 50 ||
      typeof password !== "string" ||
      !password ||
      Buffer.byteLength(password, "utf8") > 72 ||
      !["student", "faculty", "admin"].includes(role)
    ) {
      return res.status(400).json({
        message: "Enter a valid login ID, password, and account type.",
      });
    }

    const result = await pool.query(
  `SELECT
     u.id, u.login_id, u.full_name, u.password_hash,
     u.role, u.status, u.college_id, u.must_change_password,
     c.name AS college_name
   FROM users u
   JOIN colleges c ON c.id = u.college_id
   WHERE LOWER(u.login_id) = LOWER($1)
     AND c.code = $2
     AND c.is_active = TRUE`,
  [loginId.trim(), collegeCode.trim().toUpperCase()]
);

    const user = result.rows[0];

    const validPassword = await bcrypt.compare(
      password,
      user ? user.password_hash : dummyHash
    );

    if (!user || !validPassword || user.role !== role) {
      return res.status(401).json({
        message: "Incorrect login ID, password, or account type.",
      });
    }

    if (user.status !== "approved") {
      const messages = {
        pending: "Your account is awaiting admin approval.",
        rejected: "Your account request was rejected by the administrator.",
        disabled: "Your account has been disabled. Contact the administrator.",
      };

      return res.status(403).json({
        message: messages[user.status] || "Account access is unavailable.",
        status: user.status,
      });
    }

    const token = crypto.randomBytes(32).toString("hex");

    const createdSession = await pool.query(
      `INSERT INTO sessions (user_id, token_hash, expires_at)
       SELECT id, $2, NOW() + INTERVAL '8 hours' FROM users
       WHERE id=$1 AND password_hash=$3 AND status='approved'`,
      [user.id, hashToken(token), user.password_hash]
    );
    if (!createdSession.rowCount) return res.status(401).json({message:'Account changed during login. Sign in again.'});

    res.json({
      message: "Login successful.",
      token,
      user: publicUser(user),
    });
  } catch (error) {
    next(error);
  }
});

router.get('/me', requireAuth, async (req, res, next) => {
  try {
    const result = await pool.query('SELECT permission_code FROM user_permissions WHERE user_id=$1', [req.user.id]);
    res.json({user: {...publicUser(req.user), permissions: result.rows.map(p=>p.permission_code)}});
  } catch(error) { next(error); }
});
router.post('/change-password', requireAuth, loginLimiter, async (req,res,next) => {
  const {currentPassword,newPassword} = req.body || {};
  if(typeof currentPassword!=='string' || Buffer.byteLength(currentPassword)>72 ||
     typeof newPassword!=='string' || newPassword.length<12 || Buffer.byteLength(newPassword)>72 || newPassword===currentPassword) {
    return res.status(400).json({message:'Use a different password with at least 12 characters and at most 72 UTF-8 bytes.'});
  }
  let client;
  try {
    client=await pool.connect(); await client.query('BEGIN');
    const current=await client.query('SELECT password_hash FROM users WHERE id=$1 FOR UPDATE',[req.user.id]);
    if(!await bcrypt.compare(currentPassword,current.rows[0].password_hash)) {
      await client.query('ROLLBACK'); return res.status(400).json({message:'Current password is incorrect.'});
    }
    const hash=await bcrypt.hash(newPassword,12);
    await client.query('UPDATE users SET password_hash=$1,must_change_password=FALSE,updated_at=NOW() WHERE id=$2',[hash,req.user.id]);
    await client.query('DELETE FROM sessions WHERE user_id=$1',[req.user.id]);
    await client.query("INSERT INTO audit_logs (actor_user_id,action,target_type,target_id) VALUES ($1,'password.changed','user',$2)",[req.user.id,String(req.user.id)]);
    await client.query('COMMIT');
    res.json({message:'Password updated. Sign in again with your new password.'});
  } catch(error) { if(client) await client.query('ROLLBACK').catch(()=>{}); next(error); }
  finally { if(client) client.release(); }
});

router.get('/student-profile', requireAuth, requireRole('student'), async (req,res,next) => {
  try {
    const result = await pool.query(`SELECT u.login_id,u.full_name,u.email,p.mobile,p.department,p.admission_year,p.semester,p.section
      FROM users u JOIN student_profiles p ON p.user_id=u.id
      WHERE u.id=$1 AND u.college_id=$2 AND u.role='student'`, [req.user.id,req.user.college_id]);
    if(!result.rows[0]) return res.status(404).json({message:'Student profile has not been created. Contact your college.'});
    res.json({profile:result.rows[0]});
  } catch(error) { next(error); }
});

router.post("/logout", requireAuth, async (req, res, next) => {
  try {
    await pool.query(
      "DELETE FROM sessions WHERE id = $1",
      [req.sessionId]
    );

    res.json({
      message: "Logged out successfully.",
    });
  } catch (error) {
    next(error);
  }
});

module.exports = { router, requireAuth, requireRole };
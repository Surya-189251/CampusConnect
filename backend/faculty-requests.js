const express = require("express");
const bcrypt = require("bcryptjs");
const { rateLimit } = require("express-rate-limit");
const pool = require("./db");

const router = express.Router();

const requestLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    message: "Too many account requests. Please try again later.",
  },
});

router.post("/", requestLimiter, async (req, res, next) => {
  let client;

  try {
    const body = req.body || {};

if (
  typeof body.collegeCode !== "string" ||
  !body.collegeCode.trim() ||
  body.collegeCode.trim().length > 30
) {
  return res.status(400).json({
    message: "Select a valid college.",
  });
}

const collegeResult = await pool.query(
  `SELECT c.id FROM colleges c
   WHERE c.code = $1 AND c.is_active = TRUE AND EXISTS (SELECT 1 FROM users u WHERE u.college_id=c.id AND u.role='admin' AND u.status='approved')`,
  [body.collegeCode.trim().toUpperCase()]
);

if (collegeResult.rowCount === 0) {
  return res.status(400).json({
    message: "The selected college is unavailable.",
  });
}

const collegeId = collegeResult.rows[0].id;

    const textFields = [
      ["facultyId", 50],
      ["fullName", 120],
      ["email", 254],
      ["department", 100],
      ["designation", 100],
    ];

    for (const [field, maxLength] of textFields) {
      if (
        typeof body[field] !== "string" ||
        !body[field].trim() ||
        body[field].trim().length > maxLength
      ) {
        return res.status(400).json({
          message: `Enter a valid ${field} (maximum ${maxLength} characters).`,
        });
      }
    }

    const facultyId = body.facultyId.trim();
    const fullName = body.fullName.trim();
    const email = body.email.trim().toLowerCase();
    const department = body.department.trim();
    const designation = body.designation.trim();
    const password = body.password;

    if (!/^[A-Za-z0-9_-]+$/.test(facultyId)) {
      return res.status(400).json({
        message: "Faculty ID can contain letters, numbers, hyphens and underscores.",
      });
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({
        message: "Enter a valid email address.",
      });
    }

    if (
      typeof password !== "string" ||
      password.length < 12 ||
      Buffer.byteLength(password, "utf8") > 72
    ) {
      return res.status(400).json({
        message: "Use a password with at least 12 characters and at most 72 UTF-8 bytes.",
      });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    client = await pool.connect();
    await client.query("BEGIN");

    // Role and status are fixed by the server, never by the applicant.
    const result = await client.query(
  `INSERT INTO users
    (login_id, full_name, email, password_hash, role, status, college_id)
   VALUES ($1, $2, $3, $4, 'faculty', 'pending', $5)
   RETURNING id`,
  [facultyId, fullName, email, passwordHash, collegeId]
);

    const userId = result.rows[0].id;

    await client.query(
      `INSERT INTO faculty_profiles
        (user_id, department, requested_designation)
       VALUES ($1, $2, $3)`,
      [userId, department, designation]
    );

    await client.query(
      `INSERT INTO audit_logs
        (action, target_type, target_id)
       VALUES ($1, $2, $3)`,
      ["faculty.access_requested", "user", String(userId)]
    );

    await client.query("COMMIT");

    res.status(201).json({
      message: "Your request was submitted. Please wait for administrator approval.",
      status: "pending",
    });
  } catch (error) {
    if (client) {
      await client.query("ROLLBACK").catch(() => {});
    }

    if (error.code === "23505") {
      return res.status(409).json({
        message: "An account already uses that ID or email. Contact the administrator.",
      });
    }

    next(error);
  } finally {
    if (client) client.release();
  }
});

module.exports = router;
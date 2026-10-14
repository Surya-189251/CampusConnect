const express = require("express");
const pool = require("./db");
const { requireAuth, requireRole } = require("./auth");

const router = express.Router();

const permissionOptions = [
  { code: "notices.manage", label: "Manage College Notices" },
  { code: "timetable.manage", label: "Manage College Timetable" },
  { code: "students.manage", label: "Manage Student Accounts" },
  { code: "fees.manage", label: "Manage Fee Amounts" },
  { code: "payments.view", label: "View Payment Records" },
  { code: "payments.record_offline", label: "Record Offline Payments" },
];

router.use(requireAuth, requireRole("admin"));

router.use((req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});

// Show only approved faculty from the administrator's college.
router.get("/", async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT
         u.id,
         u.login_id,
         u.full_name,
         f.department,
         f.approved_designation,
         ARRAY(
           SELECT p.permission_code
           FROM user_permissions p
           WHERE p.user_id = u.id
           ORDER BY p.permission_code
         ) AS permissions
       FROM users u
       JOIN faculty_profiles f ON f.user_id = u.id
       WHERE u.college_id = $1
         AND u.role = 'faculty'
         AND u.status = 'approved'
       ORDER BY u.full_name, u.id`,
      [req.user.college_id]
    );

    res.json({
      faculty: result.rows,
      permissionOptions,
    });
  } catch (error) {
    next(error);
  }
});

// Change one permission at a time.
router.patch("/:id", async (req, res, next) => {
  let client;

  try {
    const facultyId = Number(req.params.id);
    const { permissionCode, enabled } = req.body || {};

    if (
      !Number.isSafeInteger(facultyId) ||
      facultyId < 1 ||
      facultyId > 2147483647
    ) {
      return res.status(400).json({
        message: "Invalid faculty account.",
      });
    }

    if (
      !permissionOptions.some((option) => option.code === permissionCode) ||
      typeof enabled !== "boolean"
    ) {
      return res.status(400).json({
        message: "Choose a valid permission and enabled status.",
      });
    }

    client = await pool.connect();
    await client.query("BEGIN");

    // Lock the account while its permissions are changed.
    const faculty = await client.query(
      `SELECT id FROM users
       WHERE id = $1
         AND college_id = $2
         AND role = 'faculty'
         AND status = 'approved'
       FOR UPDATE`,
      [facultyId, req.user.college_id]
    );

    if (faculty.rowCount === 0) {
      await client.query("ROLLBACK");

      return res.status(404).json({
        message: "An approved faculty account was not found in your college.",
      });
    }

    let change;

    if (enabled) {
      change = await client.query(
        `INSERT INTO user_permissions
          (user_id, permission_code, granted_by)
         VALUES ($1, $2, $3)
         ON CONFLICT (user_id, permission_code) DO NOTHING`,
        [facultyId, permissionCode, req.user.id]
      );
    } else {
      change = await client.query(
        `DELETE FROM user_permissions
         WHERE user_id = $1 AND permission_code = $2`,
        [facultyId, permissionCode]
      );
    }

    if (change.rowCount > 0) {
      await client.query(
        `INSERT INTO audit_logs
          (actor_user_id, action, target_type, target_id, details)
         VALUES ($1, $2, $3, $4, $5::jsonb)`,
        [
          req.user.id,
          enabled ? "permission.granted" : "permission.revoked",
          "user",
          String(facultyId),
          JSON.stringify({
            permissionCode,
            collegeId: req.user.college_id,
          }),
        ]
      );
    }

    const current = await client.query(
      `SELECT permission_code
       FROM user_permissions
       WHERE user_id = $1
       ORDER BY permission_code`,
      [facultyId]
    );

    await client.query("COMMIT");

    res.json({
      message: enabled ? "Permission granted." : "Permission removed.",
      permissions: current.rows.map((row) => row.permission_code),
    });
  } catch (error) {
    if (client) {
      await client.query("ROLLBACK").catch(() => {});
    }

    next(error);
  } finally {
    if (client) client.release();
  }
});

module.exports = router;
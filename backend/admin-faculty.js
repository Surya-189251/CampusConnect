const express = require("express");
const pool = require("./db");
const { requireAuth, requireRole } = require("./auth");

const router = express.Router();

// Every route in this file requires an approved administrator.
router.use(requireAuth, requireRole("admin"));

router.use((req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});

// List pending requests from the signed-in administrator's college.
router.get("/", async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT
         u.id,
         u.login_id,
         u.full_name,
         u.email,
         u.created_at,
         f.department,
         f.requested_designation
       FROM users u
       JOIN faculty_profiles f ON f.user_id = u.id
       WHERE u.college_id = $1
         AND u.role = 'faculty'
         AND u.status = 'pending'
       ORDER BY u.created_at ASC`,
      [req.user.college_id]
    );

    res.json({ requests: result.rows });
  } catch (error) {
    next(error);
  }
});

// Approve or reject one pending request.
router.patch("/:id", async (req, res, next) => {
  let client;

  try {
    const id = Number(req.params.id);
    const { decision, reason, designation } = req.body || {};

    if (!Number.isSafeInteger(id) || id < 1 || id > 2147483647) {
      return res.status(400).json({
        message: "Invalid faculty account ID.",
      });
    }

    if (!["approved", "rejected"].includes(decision)) {
      return res.status(400).json({
        message: "Choose approve or reject.",
      });
    }

    if (
      decision === "approved" &&
      (typeof designation !== "string" ||
        !designation.trim() ||
        designation.trim().length > 100)
    ) {
      return res.status(400).json({
        message: "Enter an approved designation of up to 100 characters.",
      });
    }

    if (
      decision === "rejected" &&
      (typeof reason !== "string" ||
        !reason.trim() ||
        reason.trim().length > 500)
    ) {
      return res.status(400).json({
        message: "Enter a rejection reason of up to 500 characters.",
      });
    }

    client = await pool.connect();
    await client.query("BEGIN");

    // The college restriction applies to the update, not just the list.
    const result = await client.query(
      `UPDATE users
       SET status = $1,
           reviewed_by = $2,
           reviewed_at = NOW(),
           rejection_reason = $3,
           updated_at = NOW()
       WHERE id = $4
         AND college_id = $5
         AND role = 'faculty'
         AND status = 'pending'
       RETURNING id`,
      [
        decision,
        req.user.id,
        decision === "rejected" ? reason.trim() : null,
        id,
        req.user.college_id,
      ]
    );

    if (result.rowCount === 0) {
      await client.query("ROLLBACK");

      return res.status(409).json({
        message: "This request is unavailable or has already been reviewed.",
      });
    }

    if (decision === "approved") {
      const profileResult = await client.query(
        `UPDATE faculty_profiles
         SET approved_designation = $1
         WHERE user_id = $2`,
        [designation.trim(), id]
      );

      if (profileResult.rowCount !== 1) {
        throw new Error("Faculty profile is missing.");
      }
    }

    await client.query(
      `INSERT INTO audit_logs
        (actor_user_id, action, target_type, target_id, details)
       VALUES ($1, $2, $3, $4, $5::jsonb)`,
      [
        req.user.id,
        `faculty.${decision}`,
        "user",
        String(id),
        JSON.stringify({
          collegeId: req.user.college_id,
          designation: decision === "approved" ? designation.trim() : null,
          reason: decision === "rejected" ? reason.trim() : null,
        }),
      ]
    );

    await client.query("COMMIT");

    res.json({
      message:
        decision === "approved"
          ? "Faculty account approved successfully."
          : "Faculty account rejected.",
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
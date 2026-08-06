// ─────────────────────────────────────────────────────────────
// routes/staff-onboarding/db.js
//
// Table bootstrap + shared helpers for the Staff Onboarding module
// (Part 3 of the Sabino Edu addendum: admin-assisted registration,
// self-registration via code, and the school-owner > admin hierarchy).
//
// Follows the same "CREATE TABLE IF NOT EXISTS, best effort" pattern
// already used elsewhere in this codebase (see students.js push-token
// route), so no separate migration runner is required.
// ─────────────────────────────────────────────────────────────
const pool = require('../../database/db');

let tablesReadyPromise = null;

/**
 * Ensures every table this module needs exists. Safe to call on every
 * request — the CREATE statements are idempotent and Postgres makes the
 * repeated IF NOT EXISTS check cheap, but we still memoize so we only
 * hit the DB once per process lifetime.
 */
async function ensureStaffTables() {
  if (tablesReadyPromise) return tablesReadyPromise;

  tablesReadyPromise = (async () => {
    // Staff / admin accounts, scoped to a school.
    // The school OWNER is still the existing row in `schools` — this
    // table only holds *additional* accounts the owner (or, later, a
    // permitted admin) creates.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS staff (
        id SERIAL PRIMARY KEY,
        school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
        full_name VARCHAR(255) NOT NULL,
        email VARCHAR(255) NOT NULL UNIQUE,
        phone VARCHAR(50),
        role VARCHAR(30) NOT NULL DEFAULT 'admin',
        password_hash VARCHAR(255),
        status VARCHAR(30) NOT NULL DEFAULT 'password_reset_required',
        force_password_change BOOLEAN NOT NULL DEFAULT true,
        created_by_type VARCHAR(20) NOT NULL DEFAULT 'owner',
        created_by_staff_id INTEGER REFERENCES staff(id) ON DELETE SET NULL,
        last_login_at TIMESTAMP,
        deactivated_at TIMESTAMP,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // status values in use:
    //   'password_reset_required' -> Path A, owner created it, temp password issued
    //   'invited'                 -> Path B, code generated but not yet redeemed (no login row yet — see staff_invite_codes)
    //   'active'                  -> can log in normally
    //   'deactivated'             -> access revoked by the owner

    // Invite codes for self-registration (Path B).
    await pool.query(`
      CREATE TABLE IF NOT EXISTS staff_invite_codes (
        id SERIAL PRIMARY KEY,
        school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
        code VARCHAR(20) NOT NULL UNIQUE,
        full_name VARCHAR(255),
        email VARCHAR(255),
        phone VARCHAR(50),
        role VARCHAR(30) NOT NULL DEFAULT 'admin',
        status VARCHAR(20) NOT NULL DEFAULT 'pending',
        created_by_type VARCHAR(20) NOT NULL DEFAULT 'owner',
        created_by_staff_id INTEGER REFERENCES staff(id) ON DELETE SET NULL,
        redeemed_by_staff_id INTEGER REFERENCES staff(id) ON DELETE SET NULL,
        expires_at TIMESTAMP NOT NULL,
        used_at TIMESTAMP,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    // status: 'pending' | 'used' | 'revoked' | 'expired'

    // Audit trail — required by spec 3.4 ("Audit Logs: successful
    // self-registration is logged with who and when") and by the
    // "Audit log entry" line under Path A.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS staff_audit_logs (
        id SERIAL PRIMARY KEY,
        school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
        actor_type VARCHAR(20) NOT NULL,
        actor_staff_id INTEGER REFERENCES staff(id) ON DELETE SET NULL,
        action VARCHAR(100) NOT NULL,
        target_staff_id INTEGER REFERENCES staff(id) ON DELETE SET NULL,
        details JSONB,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Helpful indexes — best effort, ignore if they already exist.
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_staff_school_id ON staff(school_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_staff_invite_codes_school_id ON staff_invite_codes(school_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_staff_audit_logs_school_id ON staff_audit_logs(school_id)`);
  })();

  return tablesReadyPromise;
}

/**
 * Write one audit log row. Never throws — an audit log failure should
 * not take down the request that triggered it, it just gets console'd.
 */
async function logStaffAudit({ schoolId, actorType, actorStaffId = null, action, targetStaffId = null, details = null }) {
  try {
    await pool.query(
      `INSERT INTO staff_audit_logs (school_id, actor_type, actor_staff_id, action, target_staff_id, details)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [schoolId, actorType, actorStaffId, action, targetStaffId, details ? JSON.stringify(details) : null]
    );
  } catch (err) {
    console.error('⚠️ [staff-onboarding] Failed to write audit log:', err.message);
  }
}

module.exports = { pool, ensureStaffTables, logStaffAudit };

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

    // Class assignment — additive, so ALTER rather than rebuild (the
    // table above may already exist with real rows). `role` already
    // accepted any VARCHAR(30); 'class_teacher' is just a new value for
    // it, not a schema change. A class_teacher with a class_id here is
    // restricted, at request time, to only that class — see
    // middleware/auth.js -> getTeacherClassScope / enforceClassScope.
    await pool.query(`ALTER TABLE staff ADD COLUMN IF NOT EXISTS class_id INTEGER REFERENCES classes(id) ON DELETE SET NULL`);

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
    await pool.query(`ALTER TABLE staff_invite_codes ADD COLUMN IF NOT EXISTS class_id INTEGER REFERENCES classes(id) ON DELETE SET NULL`);

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

    // Widen the table to log actions against ANY entity (students,
    // scores, etc.), not just staff accounts. Purely additive — both
    // columns are nullable, existing rows and existing queries that
    // only select target_staff_id are unaffected.
    await pool.query(`ALTER TABLE staff_audit_logs ADD COLUMN IF NOT EXISTS target_type VARCHAR(30)`);
    await pool.query(`ALTER TABLE staff_audit_logs ADD COLUMN IF NOT EXISTS target_id INTEGER`);

    // Helpful indexes — best effort, ignore if they already exist.
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_staff_school_id ON staff(school_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_staff_invite_codes_school_id ON staff_invite_codes(school_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_staff_audit_logs_school_id ON staff_audit_logs(school_id)`);

    // Self-healing fix: `classes` is supposed to carry a UNIQUE
    // (school_id, class_name) constraint (see database/migrate.js's
    // CREATE TABLE), but on any database where that table was created
    // before this constraint existed, CREATE TABLE IF NOT EXISTS is a
    // no-op and the constraint never gets added — so every `ON CONFLICT
    // (school_id, class_name)` in resolveClassForSchool() below (and in
    // routes/classes.js) fails with Postgres error 42P10 ("no unique or
    // exclusion constraint matching the ON CONFLICT specification").
    // Best-effort, one-time attempt to add it; resolveClassForSchool
    // still works even if this never succeeds (e.g. pre-existing
    // duplicate rows block it) — it has its own 42P10 fallback.
    try {
      await pool.query(`ALTER TABLE classes ADD CONSTRAINT classes_school_id_class_name_key UNIQUE (school_id, class_name)`);
    } catch (constraintErr) {
      // 42710 = constraint already exists (harmless — it was already
      // added, possibly under a different name via the original CREATE
      // TABLE). Anything else (e.g. duplicate rows already violating
      // uniqueness) is logged but not fatal — resolveClassForSchool's
      // fallback covers the gap.
      if (constraintErr.code !== '42710') {
        console.warn('⚠️  [staff-onboarding] Could not add classes(school_id, class_name) unique constraint:', constraintErr.message);
      }
    }
  })();

  return tablesReadyPromise;
}

/**
 * Resolves a class assignment (for staff onboarding) to a real row in
 * this school's OWN `classes` table — never a `global_class_templates`
 * id, which is a different, country-scoped id space that the rest of
 * the app's write paths (enrollments.class_id, etc.) don't use.
 *
 * Accepts either:
 *   - classId:   an id the caller already believes is in `classes` for
 *                this school — verified, not trusted blindly.
 *   - className: a display name (e.g. "GHS 1", "JSS 1") — typically
 *                what a country-scoped picker (GET /api/classes, which
 *                reads `global_class_templates` by the admin's
 *                countryId) actually hands back. If the school hasn't
 *                instantiated that class yet, it's created now — the
 *                same idempotent insert /api/classes/initialize-from-templates
 *                already does — so assignment never fails just because
 *                nobody ran the initializer first.
 *
 * Returns { id, class_name } or null if neither was supplied (class
 * assignment is optional per addendum §3.2). Throws a plain Error with
 * a user-facing message if a supplied classId doesn't belong to the
 * school — callers should catch and respond 400/404.
 */
async function resolveClassForSchool({ classId, className, schoolId, client }) {
  const db = client || pool;

  if (classId) {
    const check = await db.query('SELECT id, class_name FROM classes WHERE id = $1 AND school_id = $2', [classId, schoolId]);
    if (check.rows.length === 0) {
      throw new Error('That class was not found for your school.');
    }
    return check.rows[0];
  }

  if (className) {
    const trimmed = String(className).trim();
    if (!trimmed) return null;

    const existing = await db.query('SELECT id, class_name FROM classes WHERE school_id = $1 AND class_name = $2', [schoolId, trimmed]);
    if (existing.rows.length > 0) return existing.rows[0];

    // Fast path — works once the (school_id, class_name) unique
    // constraint exists (see the self-healing ALTER in
    // ensureStaffTables above).
    try {
      const created = await db.query(
        `INSERT INTO classes (school_id, class_name)
         VALUES ($1, $2)
         ON CONFLICT (school_id, class_name) DO NOTHING
         RETURNING id, class_name`,
        [schoolId, trimmed]
      );
      if (created.rows.length > 0) return created.rows[0];

      // ON CONFLICT fired (someone else created it a moment ago).
      const reselect = await db.query('SELECT id, class_name FROM classes WHERE school_id = $1 AND class_name = $2', [schoolId, trimmed]);
      return reselect.rows[0] || null;
    } catch (err) {
      // 42P10 = "no unique or exclusion constraint matching the ON
      // CONFLICT specification" — this database's `classes` table
      // predates that constraint and the self-healing ALTER above
      // hasn't fixed it (e.g. pre-existing duplicate rows block it).
      // Fall back to a plain insert; a duplicate-row race here would
      // need two requests resolving the exact same brand-new class
      // name in the same instant, and is harmless (a cosmetic extra
      // row) if it ever happens — far better than a hard failure.
      if (err.code === '42P10') {
        try {
          const plainInsert = await db.query(
            `INSERT INTO classes (school_id, class_name) VALUES ($1, $2) RETURNING id, class_name`,
            [schoolId, trimmed]
          );
          return plainInsert.rows[0];
        } catch (insertErr) {
          if (insertErr.code === '23505') {
            // Real unique constraint DOES exist after all and we lost a
            // race — reselect the winner.
            const reselect = await db.query('SELECT id, class_name FROM classes WHERE school_id = $1 AND class_name = $2', [schoolId, trimmed]);
            return reselect.rows[0] || null;
          }
          throw insertErr;
        }
      }
      throw err;
    }
  }

  return null;
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

/**
 * Generic counterpart to logStaffAudit — used by middleware/auditLog.js
 * for non-staff entities (students, scores, ...). Targets go in
 * target_type/target_id instead of target_staff_id, which stays null
 * here so existing staff-account queries (WHERE target_staff_id = ...)
 * are unaffected. Also never throws, for the same reason as above, and
 * ensures the (idempotent) table/columns exist first since callers
 * outside this module won't have already triggered ensureStaffTables.
 */
async function logGenericAudit({ schoolId, actorType, actorStaffId = null, action, targetType = null, targetId = null, details = null }) {
  try {
    await ensureStaffTables();
    await pool.query(
      `INSERT INTO staff_audit_logs (school_id, actor_type, actor_staff_id, action, target_type, target_id, details)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [schoolId, actorType, actorStaffId, action, targetType, targetId, details ? JSON.stringify(details) : null]
    );
  } catch (err) {
    console.error('⚠️ [auditLog] Failed to write audit log:', err.message);
  }
}

module.exports = { pool, ensureStaffTables, logStaffAudit, logGenericAudit, resolveClassForSchool };

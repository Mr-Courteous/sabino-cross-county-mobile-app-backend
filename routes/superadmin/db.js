// ─────────────────────────────────────────────────────────────
// routes/superadmin/db.js
// Tables + audit helper for the Sabino Control (superadmin) console.
// Self-ensuring, same pattern as routes/staff-onboarding/db.js.
// ─────────────────────────────────────────────────────────────
const pool = require('../../database/db');

const ROLES = ['owner', 'admin', 'viewer'];

let ready = null;
function ensureSuperadminTables() {
  if (!ready) {
    ready = (async () => {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS superadmins (
          id SERIAL PRIMARY KEY,
          email VARCHAR(255) UNIQUE NOT NULL,
          name VARCHAR(150) NOT NULL,
          password_hash VARCHAR(255) NOT NULL,
          role VARCHAR(20) NOT NULL DEFAULT 'admin' CHECK (role IN ('owner','admin','viewer')),
          is_active BOOLEAN NOT NULL DEFAULT true,
          must_change_password BOOLEAN NOT NULL DEFAULT false,
          last_login_at TIMESTAMPTZ,
          created_by INTEGER REFERENCES superadmins(id),
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )`);
      // Audit rows are append-only: no route updates or deletes them, and
      // admins are deactivated rather than deleted, so the actor always resolves.
      // admin_email/admin_name are snapshots so history survives renames.
      await pool.query(`
        CREATE TABLE IF NOT EXISTS superadmin_audit_logs (
          id BIGSERIAL PRIMARY KEY,
          admin_id INTEGER REFERENCES superadmins(id),
          admin_email VARCHAR(255) NOT NULL,
          admin_name VARCHAR(150),
          action VARCHAR(100) NOT NULL,
          target_type VARCHAR(30),
          target_id INTEGER,
          target_label VARCHAR(255),
          details JSONB,
          ip VARCHAR(64),
          user_agent TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_sa_audit_created ON superadmin_audit_logs(created_at DESC)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_sa_audit_target ON superadmin_audit_logs(target_type, target_id)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_sa_audit_admin ON superadmin_audit_logs(admin_email)`);

      // The superadmin console and subscription middleware support a fixed
      // three-day grace period. Older deployments may still have a check
      // constraint that only allows pending/completed/expired.
      const paymentStatusConstraint = (await pool.query(`
        SELECT pg_get_constraintdef(oid) AS definition
        FROM pg_constraint
        WHERE conrelid = 'schools'::regclass AND conname = 'valid_payment_status'
      `)).rows[0];
      if (!paymentStatusConstraint?.definition?.includes("'grace_period'")) {
        await pool.query(`ALTER TABLE schools DROP CONSTRAINT IF EXISTS valid_payment_status`);
        await pool.query(`
          ALTER TABLE schools ADD CONSTRAINT valid_payment_status
          CHECK (payment_status IN ('pending', 'completed', 'grace_period', 'expired'))
        `);
      }

      // ── School status history ────────────────────────────────────────────
      // Your schools table has no "payment completed at" column, and several code
      // paths (Flutterwave, store webhook, cron, this console) change payment_status.
      // A trigger on schools records each change in one place, whichever path made it.
      // It only INSERTs into our own table and swallows its own errors, so it can
      // never block or slow down a normal school update. To remove it:
      //   DROP TRIGGER sa_school_status_history ON schools;
      const existed = (await pool.query(`SELECT to_regclass('school_status_history') AS t`)).rows[0].t;
      await pool.query(`
        CREATE TABLE IF NOT EXISTS school_status_history (
          id BIGSERIAL PRIMARY KEY,
          school_id INTEGER NOT NULL,
          old_status VARCHAR(50),
          new_status VARCHAR(50),
          old_expiry TIMESTAMPTZ,
          new_expiry TIMESTAMPTZ,
          changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          estimated BOOLEAN NOT NULL DEFAULT false
        )`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_ssh_school ON school_status_history(school_id, changed_at DESC)`);
      if (!existed) {
        // One-time backfill for schools that are already paid: the real date wasn't recorded,
        // so use the row's last update and mark it as an estimate.
        await pool.query(`
          INSERT INTO school_status_history (school_id, old_status, new_status, new_expiry, changed_at, estimated)
          SELECT id, NULL, payment_status, subscription_expiry, COALESCE(updated_at::timestamptz, created_at::timestamptz, NOW()), true
          FROM schools WHERE payment_status = 'completed'`);
      }
      try {
        await pool.query(`
          CREATE OR REPLACE FUNCTION sa_log_school_status() RETURNS trigger AS $fn$
          BEGIN
            BEGIN
              IF NEW.payment_status IS DISTINCT FROM OLD.payment_status
                 OR (NEW.payment_status = 'completed' AND NEW.subscription_expiry IS DISTINCT FROM OLD.subscription_expiry) THEN
                INSERT INTO school_status_history (school_id, old_status, new_status, old_expiry, new_expiry)
                VALUES (NEW.id, OLD.payment_status, NEW.payment_status, OLD.subscription_expiry, NEW.subscription_expiry);
              END IF;
            EXCEPTION WHEN OTHERS THEN
              NULL; -- history is best-effort: never block a school update
            END;
            RETURN NEW;
          END;
          $fn$ LANGUAGE plpgsql`);
        await pool.query(`DROP TRIGGER IF EXISTS sa_school_status_history ON schools`);
        await pool.query(`
          CREATE TRIGGER sa_school_status_history AFTER UPDATE OF payment_status, subscription_expiry ON schools
          FOR EACH ROW EXECUTE PROCEDURE sa_log_school_status()`);
      } catch (err) {
        // e.g. the database user may not be allowed to create triggers. Everything else still works;
        // "paid on" will then only reflect changes made from this console.
        console.warn('⚠️ [superadmin] Could not install school status trigger:', err.message);
      }
    })().catch((err) => { ready = null; throw err; });
  }
  return ready;
}

/**
 * Write one audit row. `db` is the pool OR a transaction client, so a state
 * change and its log entry commit (or roll back) together.
 * `actor` = { id, email, name } — for failed logins id is null and email is what was typed.
 */
async function writeAudit(db, req, actor, { action, targetType = null, targetId = null, targetLabel = null, details = null }) {
  await db.query(
    `INSERT INTO superadmin_audit_logs
       (admin_id, admin_email, admin_name, action, target_type, target_id, target_label, details, ip, user_agent)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      actor.id ?? null, actor.email, actor.name ?? null, action, targetType, targetId, targetLabel,
      details ? JSON.stringify(details) : null,
      req.ip || null, (req.headers['user-agent'] || '').slice(0, 400) || null,
    ]
  );
}

module.exports = { pool, ROLES, ensureSuperadminTables, writeAudit };

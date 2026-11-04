/* node scripts/run-unique-emails-migration.js   - safe to run more than once. Back up first.
 * Creates the staff tables if needed, then installs the duplicate-email protection. */
const fs = require('fs');
const path = require('path');
const pool = require('../database/db');
const { ensureStaffTables } = require('../routes/staff-onboarding/db');

(async () => {
  try {
    await ensureStaffTables(); // also installs the guards (self-healing), shown below for the record
    await pool.query(fs.readFileSync(path.join(__dirname, '../database/migrations/2026_11_unique_emails.sql'), 'utf8'));
    const t = await pool.query(`SELECT tgname FROM pg_trigger WHERE tgname IN ('trg_guard_staff_email','trg_guard_school_email') AND NOT tgisinternal ORDER BY 1`);
    const i = await pool.query(`SELECT indexname FROM pg_indexes WHERE indexname = 'uq_staff_email_lower'`);
    console.log('✅ Email protection installed. Triggers:', t.rows.map((r) => r.tgname).join(', '), '| unique index:', i.rows.length ? 'yes' : 'NO (existing staff emails differ only by case - see notice above)');
  } catch (e) {
    console.error('❌ Email protection migration failed:', e.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();

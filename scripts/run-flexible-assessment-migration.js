/* Runs database/migrations/2026_10_flexible_assessment.sql against DATABASE_URL.
 *   node scripts/run-flexible-assessment-migration.js
 * Safe to run more than once. Take a database backup first. */
const fs = require('fs');
const path = require('path');
const pool = require('../database/db');

(async () => {
  const sql = fs.readFileSync(path.join(__dirname, '../database/migrations/2026_10_flexible_assessment.sql'), 'utf8');
  try {
    const v = await pool.query('SHOW server_version_num');
    if (Number(v.rows[0].server_version_num) < 130000) {
      throw new Error('PostgreSQL 13+ is required (ALTER COLUMN ... DROP EXPRESSION).');
    }
    await pool.query(sql);
    console.log('✅ Flexible assessment migration applied.');
  } catch (e) {
    console.error('❌ Migration failed (nothing was changed):', e.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();

/* node scripts/run-parent-access-migration.js  - safe to run more than once. Back up first. */
const fs = require('fs');
const path = require('path');
const pool = require('../database/db');
(async () => {
  try {
    await pool.query(fs.readFileSync(path.join(__dirname, '../database/migrations/2026_11_parent_access.sql'), 'utf8'));
    console.log('✅ Parent-access migration applied.');
  } catch (e) {
    console.error('❌ Parent-access migration failed (nothing was changed):', e.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();

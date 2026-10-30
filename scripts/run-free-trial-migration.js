/* node scripts/run-free-trial-migration.js  - safe to run more than once */
const fs = require('fs');
const path = require('path');
const pool = require('../database/db');
(async () => {
  try {
    await pool.query(fs.readFileSync(path.join(__dirname, '../database/migrations/2026_10_free_trial.sql'), 'utf8'));
    console.log('✅ Free-trial migration applied.');
  } catch (e) {
    console.error('❌ Free-trial migration failed:', e.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();

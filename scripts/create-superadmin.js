// Create the FIRST owner (or any later owner) from the command line:
//   node scripts/create-superadmin.js you@example.com "Your Name"
// Prints a one-time password if SUPERADMIN_PASSWORD isn't set. You'll be
// asked to change it at first sign-in.
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { pool, ensureSuperadminTables, writeAudit } = require('../routes/superadmin/db');

(async () => {
  const [email, ...nameParts] = process.argv.slice(2);
  const name = nameParts.join(' ').trim();
  if (!email || !name) {
    console.error('Usage: node scripts/create-superadmin.js <email> "<Full Name>"');
    process.exit(1);
  }
  const password = process.env.SUPERADMIN_PASSWORD || crypto.randomBytes(11).toString('base64url');
  if (password.length < 10) { console.error('Password must be at least 10 characters.'); process.exit(1); }

  await ensureSuperadminTables();
  try {
    const { rows } = await pool.query(
      `INSERT INTO superadmins (email, name, password_hash, role, must_change_password)
       VALUES ($1,$2,$3,'owner',true) RETURNING id, email, name`,
      [email.toLowerCase(), name, await bcrypt.hash(password, 12)]
    );
    await writeAudit(pool, { ip: 'cli', headers: {} }, { id: rows[0].id, email: rows[0].email, name: rows[0].name },
      { action: 'admin.bootstrap', targetType: 'admin', targetId: rows[0].id, targetLabel: rows[0].email, details: { role: 'owner' } });
    console.log(`\n✅ Owner created: ${rows[0].email}`);
    if (!process.env.SUPERADMIN_PASSWORD) console.log(`   One-time password: ${password}\n`);
  } catch (err) {
    console.error(err.code === '23505' ? '❌ An admin with that email already exists.' : `❌ ${err.message}`);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();

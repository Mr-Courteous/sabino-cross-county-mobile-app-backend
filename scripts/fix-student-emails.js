/**
 * fix-student-emails.js
 * 
 * One-time migration: normalize existing student emails to lowercase+trimmed.
 * 
 * Problem: The bulk student creation route was storing emails as-is (e.g.,
 * "John@School.com"). The login endpoint normalizes to lowercase before querying,
 * so students with mixed-case emails could never log in ("Invalid email or password").
 * 
 * If two students have the same email in different cases (e.g., "John@x.com" and
 * "john@x.com"), the duplicate gets its email set to NULL and is reported separately
 * so you can manually resolve it.
 * 
 * Run once: node scripts/fix-student-emails.js
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env.local') });
const pool = require('../database/db');

async function fixStudentEmails() {
  const client = await pool.connect();
  try {
    console.log('🔍 Checking for student emails that need normalization...\n');

    // Find students whose email doesn't match the normalized form
    const checkResult = await client.query(`
      SELECT id, email
      FROM students
      WHERE email IS NOT NULL
        AND email != LOWER(TRIM(email))
      ORDER BY id
    `);

    if (checkResult.rows.length === 0) {
      console.log('✅ All student emails are already normalized. Nothing to do.');
      return;
    }

    console.log(`⚠️  Found ${checkResult.rows.length} student(s) with non-normalized emails:\n`);

    let fixed = 0;
    let skipped = 0;
    const conflicts = [];

    for (const row of checkResult.rows) {
      const normalized = row.email.trim().toLowerCase();
      console.log(`   ID ${row.id}: "${row.email}" → "${normalized}"`);

      // Check if the normalized email already exists for a DIFFERENT student
      const conflictCheck = await client.query(
        `SELECT id FROM students WHERE LOWER(TRIM(email)) = $1 AND id != $2 LIMIT 1`,
        [normalized, row.id]
      );

      if (conflictCheck.rows.length > 0) {
        // Duplicate — set email to null so at least the student record doesn't block others
        await client.query(
          `UPDATE students SET email = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
          [row.id]
        );
        conflicts.push({ id: row.id, email: row.email, conflictsWith: conflictCheck.rows[0].id });
        console.log(`     ⚠️  CONFLICT: student ${conflictCheck.rows[0].id} already has this email. Cleared email for ID ${row.id}.`);
        skipped++;
      } else {
        await client.query(
          `UPDATE students SET email = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
          [normalized, row.id]
        );
        fixed++;
      }
    }

    console.log(`\n✅ Summary:`);
    console.log(`   Fixed:    ${fixed} student(s)`);
    console.log(`   Skipped:  ${skipped} student(s) had duplicate conflicts (email cleared)`);

    if (conflicts.length > 0) {
      console.log(`\n⚠️  MANUAL ACTION NEEDED for these students (their email was cleared):`);
      for (const c of conflicts) {
        console.log(`   Student ID ${c.id} had email "${c.email}" which conflicts with student ID ${c.conflictsWith}.`);
        console.log(`   Please update one of them with a unique email from the School dashboard.`);
      }
    }

  } catch (err) {
    console.error('❌ Error during email normalization:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
    console.log('\n🏁 Done.');
  }
}

fixStudentEmails();

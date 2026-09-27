/**
 * URGENT FIX: enrollments_class_id_fkey points to wrong table.
 *
 * The constraint currently references global_class_templates (IDs 1-81),
 * but the app sends IDs from the 'classes' table (school-specific rows, e.g. 141).
 *
 * This script:
 *  1. Confirms the current constraint target.
 *  2. Drops the wrong constraint.
 *  3. Adds the correct one pointing to the 'classes' table.
 *  4. Verifies the change.
 *
 * Run once:  node scripts/fix-enrollment-fkey.js
 */

require('dotenv').config({ path: '.env.local' });
const { Client } = require('pg');

const DB_URL = process.env.DATABASE_URL;

async function main() {
  const client = new Client({ connectionString: DB_URL });
  await client.connect();
  console.log('✅  Connected to database.\n');

  try {
    // ── 1. Show current constraint ──────────────────────────────────────────
    const { rows: before } = await client.query(`
      SELECT
        tc.constraint_name,
        ccu.table_name  AS references_table,
        ccu.column_name AS references_column
      FROM information_schema.table_constraints AS tc
      JOIN information_schema.constraint_column_usage AS ccu
        ON ccu.constraint_name = tc.constraint_name
       AND ccu.table_schema    = tc.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND tc.table_name      = 'enrollments'
        AND tc.constraint_name = 'enrollments_class_id_fkey';
    `);

    if (before.length === 0) {
      console.log('⚠️  Constraint "enrollments_class_id_fkey" not found.');
      console.log('    It may already be fixed or have a different name.\n');
    } else {
      console.log('📋  Current constraint:');
      console.table(before);
    }

    // ── 2. Drop old constraint ──────────────────────────────────────────────
    console.log('🔧  Dropping old constraint...');
    await client.query(`
      ALTER TABLE enrollments
        DROP CONSTRAINT IF EXISTS enrollments_class_id_fkey;
    `);
    console.log('✅  Old constraint dropped.\n');

    // ── 3. Add correct constraint → classes(id) ─────────────────────────────
    console.log('🔧  Adding correct constraint → classes(id)...');
    await client.query(`
      ALTER TABLE enrollments
        ADD CONSTRAINT enrollments_class_id_fkey
        FOREIGN KEY (class_id)
        REFERENCES classes(id)
        ON DELETE CASCADE;
    `);
    console.log('✅  New constraint added.\n');

    // ── 4. Verify ────────────────────────────────────────────────────────────
    const { rows: after } = await client.query(`
      SELECT
        tc.constraint_name,
        ccu.table_name  AS references_table,
        ccu.column_name AS references_column
      FROM information_schema.table_constraints AS tc
      JOIN information_schema.constraint_column_usage AS ccu
        ON ccu.constraint_name = tc.constraint_name
       AND ccu.table_schema    = tc.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND tc.table_name      = 'enrollments'
        AND tc.constraint_name = 'enrollments_class_id_fkey';
    `);

    console.log('📋  Updated constraint:');
    console.table(after);

    if (after[0]?.references_table === 'classes') {
      console.log('🎉  SUCCESS! enrollments.class_id now correctly references classes(id).');
      console.log('    Schools can now add students without the foreign key error.\n');
    } else {
      console.log('❌  Something went wrong. Please check manually.');
    }

  } catch (err) {
    console.error('❌  Error during migration:', err.message);
    process.exit(1);
  } finally {
    await client.end();
    console.log('🔌  Disconnected.');
  }
}

main();

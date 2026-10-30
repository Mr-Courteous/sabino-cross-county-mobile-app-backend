/* Integration test against a real Postgres.
 *   PGURL=postgres://postgres@/sabino_test?host=/tmp/pg&port=5433 node tests/assessment.test.js
 * Expects tests/baseline_schema.sql + the migration to have been applied. */
const assert = require('assert');
const { Client } = require('pg');
const A = require('../utils/assessment');

(async () => {
  const db = new Client({ connectionString: process.env.PGURL });
  await db.connect();
  const ok = (m) => console.log('  ✓', m);

  await db.query(`TRUNCATE scores, enrollments, students, classes, global_subjects, assessment_configs, schools RESTART IDENTITY CASCADE`);
  await db.query(`INSERT INTO schools(name) VALUES ('S1')`);
  await db.query(`INSERT INTO classes(school_id,class_name) VALUES (1,'JSS1')`);
  await db.query(`INSERT INTO students(school_id,first_name,last_name) VALUES (1,'A','B'),(1,'C','D')`);
  await db.query(`INSERT INTO enrollments(school_id,student_id,class_id,session_id) VALUES (1,1,1,1),(1,2,1,1)`);
  await db.query(`INSERT INTO global_subjects(subject_name) VALUES ('Maths'),('English')`);
  const base = { schoolId: 1, userId: 1, sessionId: 1, term: 1 };

  // 1. Default school: legacy path, old limits, old totals
  let cfg = await A.getSchoolConfig(db, 1);
  assert.strictEqual(cfg.isCustom, false);
  let r = await A.saveScoreRecord(db, { ...base, enrollmentId: 1, subjectId: 1, incoming: { ca1_score: 8, ca2_score: 9, exam_score: 55 }, config: cfg });
  assert.strictEqual(Number(r.row.total_score), 72);
  assert.strictEqual(r.row.template_snapshot, null);
  r = await A.saveScoreRecord(db, { ...base, enrollmentId: 1, subjectId: 1, incoming: { ca3: 5 }, config: cfg }); // COALESCE keeps others
  assert.strictEqual(Number(r.row.total_score), 77);
  await assert.rejects(A.saveScoreRecord(db, { ...base, enrollmentId: 1, subjectId: 1, incoming: { ca1_score: 11 }, config: cfg }), /between 0 and 10/);
  ok('default school behaves exactly as before (legacy path, limits, COALESCE)');

  // 2. Validation
  assert.ok(!A.validateConfig({ components: [{ key: 'Bad Key', label: 'x', type: 'number', max: 10 }] }).ok);
  assert.ok(!A.validateConfig({ components: [{ key: 'c', label: 'C', type: 'text' }] }).ok); // nothing counts
  assert.ok(!A.validateConfig({ components: [{ key: 'a', label: 'A', type: 'number', max: 5 }], grading_bands: [{ min: 40, grade: 'A' }] }).ok); // no 0 band
  const v = A.validateConfig({
    components: [
      { key: 'ca1', label: 'CA1', type: 'number', max: 20 },
      { key: 'ca2', label: 'CA2', type: 'number', max: 20 },
      { key: 'exam', label: 'Exam', type: 'number', max: 60 },
      { key: 'comment', label: 'Comment', type: 'text' },
      { key: 'total', label: 'Total', type: 'computed', source: 'total' },
      { key: 'min', label: 'MIN', type: 'computed', source: 'class_min' },
      { key: 'grade', label: 'Grade', type: 'computed', source: 'grade' },
    ],
  });
  assert.ok(v.ok, v.errors.join(','));
  assert.strictEqual(v.config.total_max, 100);
  ok('config validation (keys, max, types, grade bands, total_max)');

  // 3. School adopts a custom 20/20/60 template
  await db.query(`INSERT INTO assessment_configs(school_id,components,grading_bands,version) VALUES (1,$1,$2,1)`,
    [JSON.stringify(v.config.components), JSON.stringify(v.config.grading_bands)]);
  cfg = await A.getSchoolConfig(db, 1);
  assert.strictEqual(cfg.isCustom, true);

  // 3a. Existing legacy record is NOT altered by the template change
  const legacyRow = (await db.query(`SELECT * FROM scores WHERE id=1`)).rows[0];
  assert.strictEqual(legacyRow.template_snapshot, null);
  assert.strictEqual(Number(legacyRow.total_score), 77);
  ok('changing template leaves existing records untouched');

  // 3b. Re-saving identical values on a legacy row is a no-op (stays legacy)
  r = await A.saveScoreRecord(db, { ...base, enrollmentId: 1, subjectId: 1, incoming: { ca1_score: 8, ca2_score: 9 }, config: cfg });
  assert.strictEqual(r.changed, false);
  assert.strictEqual(r.row.template_snapshot, null);
  ok('re-saving unchanged values does not re-stamp the record');

  // 3c. New record under custom template: 20/20/60 limits, text column
  await assert.rejects(A.saveScoreRecord(db, { ...base, enrollmentId: 2, subjectId: 1, incoming: { ca1: 21 }, config: cfg }), /CA1 must be between 0 and 20/);
  await assert.rejects(A.saveScoreRecord(db, { ...base, enrollmentId: 2, subjectId: 1, incoming: { ca3_score: 5 }, config: cfg }), /not an input column/);
  r = await A.saveScoreRecord(db, { ...base, enrollmentId: 2, subjectId: 1, incoming: { components: { ca1: 18, ca2: 15, exam: 52, comment: 'Good effort' } }, config: cfg });
  assert.strictEqual(Number(r.row.total_score), 85);
  assert.strictEqual(r.row.components.comment, 'Good effort');
  assert.strictEqual(Number(r.row.ca1_score), 18); // mirrored for old readers
  assert.strictEqual(r.row.ca3_score, null);
  ok('custom record: 20/20/60 limits, text column, total by trigger, legacy mirror');

  // 3d. Editing ONE field of a legacy row under the custom template re-stamps it and keeps old values
  r = await A.saveScoreRecord(db, { ...base, enrollmentId: 1, subjectId: 1, incoming: { exam: 40 }, config: cfg });
  assert.strictEqual(r.changed, true);
  assert.ok(r.row.template_snapshot);
  assert.strictEqual(Number(r.row.components.ca1), 8);
  // ca3=5 is kept in components but not counted (no ca3 in template): 8+9+40
  assert.strictEqual(Number(r.row.total_score), 57);
  ok('editing a legacy record adopts the new template; dropped column no longer counts');

  // 4. Template change later does NOT alter already-stamped records
  const v2 = A.validateConfig({ components: [
    { key: 'ca1', label: 'Test', type: 'number', max: 10 },
    { key: 'exam', label: 'Exam', type: 'number', max: 90 } ] });
  await db.query(`UPDATE assessment_configs SET components=$1, grading_bands=$2, version=2`, [JSON.stringify(v2.config.components), JSON.stringify(v2.config.grading_bands)]);
  const cfg2 = await A.getSchoolConfig(db, 1);
  const stamped = (await db.query(`SELECT * FROM scores WHERE enrollment_id=2`)).rows[0];
  assert.strictEqual(Number(stamped.total_score), 85);
  assert.strictEqual(stamped.template_snapshot.version, 1);
  ok('template v2 saved: stamped record still shows v1 and total 85');

  // 5. Report layout: mixed versions -> newest template columns + older data kept
  await A.saveScoreRecord(db, { ...base, enrollmentId: 2, subjectId: 2, incoming: { ca1: 7, exam: 80 }, config: cfg2 });
  const rows = (await db.query(`SELECT sc.*, g.subject_name FROM scores sc JOIN global_subjects g ON g.id=sc.subject_id WHERE enrollment_id=2 ORDER BY subject_id`)).rows;
  const stats = await A.getClassSubjectStats(db, 1, 1, 1, 1);
  const layout = A.buildReportLayout(rows, stats);
  assert.ok(layout.custom);
  const keys = layout.columns.map((c) => c.key);
  assert.deepStrictEqual(keys.slice(0, 2), ['ca1', 'exam']);
  assert.ok(keys.includes('ca2') && keys.includes('comment') && keys.includes('total'));
  assert.strictEqual(layout.rows[0].cells.total, 85);
  assert.strictEqual(layout.rows[1].cells.total, 87);
  ok('mixed-version report layout: newest columns first, older data still shown');

  // 6. Grades use each record's own frozen scale
  assert.strictEqual(A.gradeFor(72, A.DEFAULT_GRADING_BANDS).grade, 'A');
  assert.strictEqual(A.gradeFor(29.9, A.DEFAULT_GRADING_BANDS).grade, 'F');
  ok('grading helper matches the existing 70/60/50/40/30 scale');

  // 7. Apply-to-existing converts legacy rows then stamps them
  await db.query(`UPDATE scores SET template_snapshot=NULL, components=NULL, grading_snapshot=NULL WHERE enrollment_id=1`);
  await db.query(`UPDATE scores SET ca1_score=6, exam_score=30 WHERE enrollment_id=1`);
  const n = await A.applyConfigToExisting(db, 1, cfg2, { classId: 1, sessionId: 1, term: 1 });
  assert.ok(n >= 1);
  const conv = (await db.query(`SELECT * FROM scores WHERE enrollment_id=1 AND subject_id=1`)).rows[0];
  assert.strictEqual(Number(conv.total_score), 36); // ca1 6 + exam 30 under the v2 template
  ok('apply-to-existing converts legacy columns and recomputes totals');

  await db.end();
  console.log('\nALL ASSESSMENT TESTS PASSED');
})().catch((e) => { console.error('\nFAILED:', e); process.exit(1); });

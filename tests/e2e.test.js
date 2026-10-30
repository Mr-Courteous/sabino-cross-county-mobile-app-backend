/* End-to-end test: real Express routes + real Postgres.
 *   DATABASE_URL=postgres://postgres@localhost:5433/sabino_e2e?host=/tmp/pg JWT_SECRET=x node tests/e2e.test.js
 * Needs baseline_schema.sql, e2e_extra.sql, then the migration, applied first. */
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
const assert = require('assert');
const fs = require('fs');
const express = require('express');
const jwt = require('jsonwebtoken');
const pool = require('../database/db');

const app = express();
app.use(express.json());
app.use('/api/scores', require('../routes/scores'));
app.use('/api/reports', require('../routes/reports'));
app.use('/api/assessment', require('../routes/assessment'));
app.use('/api/subjects', require('../routes/subjects'));
app.use('/api/classes', require('../routes/classes'));
app.use('/api/academic-structure', require('../routes/academic-structure'));

const ok = (m) => console.log('  ✓', m);
let base;
const tok = (p) => jwt.sign(p, process.env.JWT_SECRET);
const T1 = tok({ id: 1, schoolId: 1, type: 'school', countryId: 1 });
const T2 = tok({ id: 2, schoolId: 2, type: 'school', countryId: 1 });
const TS = tok({ studentId: 1, schoolId: 1, type: 'student' });
const TTEACHER = tok({ id: 9, schoolId: 1, type: 'school', countryId: 1, staffRole: 'class_teacher', role: 'admin', staffId: 9, classId: 1 });
async function call(method, url, token, body) {
  const r = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: body ? JSON.stringify(body) : undefined });
  const ct = r.headers.get('content-type') || '';
  if (ct.includes('pdf')) return { status: r.status, pdf: Buffer.from(await r.arrayBuffer()) };
  return { status: r.status, ...(await r.json()) };
}

(async () => {
  const server = app.listen(0); base = `http://127.0.0.1:${server.address().port}`;
  await require('../routes/staff-onboarding/db').ensureStaffTables();
  await pool.query(`TRUNCATE scores, enrollments, students, classes, global_subjects, assessment_configs, schools, class_arms, teacher_assignments, school_preferences, report_remarks, global_class_templates RESTART IDENTITY CASCADE`);
  await pool.query(`INSERT INTO schools(name) VALUES ('Alpha School'),('Beta School')`);
  await pool.query(`INSERT INTO school_preferences(school_id, theme_color) VALUES (1,'#0B6E4F')`);
  await pool.query(`INSERT INTO classes(school_id,class_name) VALUES (1,'JSS1'),(2,'JSS1')`);
  await pool.query(`INSERT INTO academic_years(school_id,session_name) VALUES (1,'2026/2027')`);
  await pool.query(`INSERT INTO students(school_id,first_name,last_name,registration_number) VALUES (1,'Ada','Obi','R1'),(1,'Bayo','Ade','R2')`);
  await pool.query(`INSERT INTO enrollments(school_id,student_id,class_id,session_id) VALUES (1,1,1,1),(1,2,1,1)`);
  await pool.query(`INSERT INTO global_subjects(subject_name,category) VALUES ('Mathematics','Core'),('English','Core')`);
  await pool.query(`INSERT INTO global_class_templates(country_id,display_name) VALUES (1,'JSS1'),(1,'JSS2')`);

  // ── 1. Default school keeps the old behaviour ─────────────────────────
  let r = await call('GET', '/api/assessment/config', T1);
  assert.strictEqual(r.data.isCustom, false);
  assert.strictEqual(r.data.total_max, 100);
  r = await call('POST', '/api/scores/record', T1, { scores: [
    { enrollment_id: 1, subject_id: 1, term_id: 1, sessionId: 1, ca1_score: 8, ca2_score: 9, ca3_score: 7, ca4_score: 10, exam_score: 50 },
    { enrollment_id: 2, subject_id: 1, term_id: 1, sessionId: 1, ca1_score: 6, ca2_score: 5, exam_score: 40 }] });
  assert.strictEqual(r.status, 201, JSON.stringify(r));
  assert.strictEqual(Number(r.data[0].total_score), 84);
  r = await call('POST', '/api/scores/record', T1, { scores: [{ enrollment_id: 1, subject_id: 1, term_id: 1, sessionId: 1, ca1_score: 11 }] });
  assert.strictEqual(r.status, 400); assert.match(r.error, /CA1 must be between 0 and 10/);
  ok('default school: record, totals, old limits enforced');

  r = await call('GET', '/api/scores/sheet?classId=1&subjectId=1&sessionId=1&termId=1', T1);
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(r.config.columns.map((c) => c.key), ['ca1', 'ca2', 'ca3', 'ca4', 'exam']);
  const row1 = r.data.find((x) => x.enrollment_id === 1);
  assert.strictEqual(row1.ca1_score, '8.00'); // legacy fields still present
  assert.strictEqual(row1.values.exam, 50);
  ok('sheet returns legacy fields + columns/values');

  r = await call('GET', '/api/reports/data/student/1?term=1&sessionId=1', T1);
  assert.strictEqual(r.status, 200, JSON.stringify(r));
  assert.strictEqual(r.layout, null);
  assert.strictEqual(Number(r.data[0].student_total), 84);
  r = await call('GET', '/api/reports/data/class/1?term=1&sessionId=1', T1);
  assert.strictEqual(r.status, 200, JSON.stringify(r));
  assert.strictEqual(r.data.length, 2);
  assert.ok(!('layout' in r.data[0]));
  const legacyPdf = await call('GET', '/api/reports/pdf/1?term=1&sessionId=1', T1);
  assert.strictEqual(legacyPdf.pdf.slice(0, 4).toString(), '%PDF');
  fs.writeFileSync('/tmp/legacy.pdf', legacyPdf.pdf);
  r = await call('GET', '/api/scores/my-grades?term=1&sessionId=1', TS);
  assert.strictEqual(r.status, 200, JSON.stringify(r)); assert.strictEqual(r.layout, null);
  ok('default school: report JSON, class JSON, PDF, student grades unchanged');

  // ── 2. School configures its own template ────────────────────────────
  const custom = {
    components: [
      { key: 'ca1', label: 'CA 1', type: 'number', max: 20 },
      { key: 'ca2', label: 'CA 2', type: 'number', max: 20 },
      { key: 'exam', label: 'Exam', type: 'number', max: 60 },
      { key: 'comment', label: 'Comment', type: 'text' },
      { key: 'total', label: 'Total', type: 'computed', source: 'total' },
      { key: 'avg', label: 'Class Avg', type: 'computed', source: 'class_average' },
      { key: 'min', label: 'MIN', type: 'computed', source: 'class_min' },
      { key: 'grade', label: 'Grade', type: 'computed', source: 'grade' },
    ],
    grading_bands: [{ min: 75, grade: 'A', remark: 'Distinction' }, { min: 50, grade: 'B', remark: 'Credit' }, { min: 0, grade: 'C', remark: 'Pass' }],
  };
  r = await call('PUT', '/api/assessment/config', TTEACHER, custom); assert.strictEqual(r.status, 403);
  r = await call('PUT', '/api/assessment/config', T1, { components: [{ key: 'x y', label: 'x', type: 'number', max: 5 }] }); assert.strictEqual(r.status, 400);
  r = await call('PUT', '/api/assessment/config', T1, custom);
  assert.strictEqual(r.status, 200, JSON.stringify(r)); assert.strictEqual(r.data.version, 1); assert.strictEqual(r.data.total_max, 100);
  ok('template saved (teachers blocked, bad input rejected)');

  // existing report card is untouched
  r = await call('GET', '/api/reports/data/student/1?term=1&sessionId=1', T1);
  assert.strictEqual(r.layout, null); assert.strictEqual(Number(r.data[0].student_total), 84);
  const same = await call('GET', '/api/reports/pdf/1?term=1&sessionId=1', T1);
  assert.strictEqual(Buffer.compare(legacyPdf.pdf.slice(0, 0), same.pdf.slice(0, 0)), 0);
  ok('existing report cards unchanged after the template change');

  // ── 3. New scores follow the school's template ───────────────────────
  r = await call('POST', '/api/scores/record', T1, { scores: [{ enrollment_id: 1, subject_id: 2, term_id: 1, sessionId: 1, components: { ca1: 19, ca2: 14, exam: 55, comment: 'Excellent' } },
                                                              { enrollment_id: 2, subject_id: 2, term_id: 1, sessionId: 1, components: { ca1: 10, ca2: 12, exam: 30 } }] });
  assert.strictEqual(r.status, 201, JSON.stringify(r)); assert.strictEqual(Number(r.data[0].total_score), 88);
  r = await call('POST', '/api/scores/record', T1, { scores: [{ enrollment_id: 1, subject_id: 2, term_id: 1, sessionId: 1, components: { ca1: 25 } }] });
  assert.strictEqual(r.status, 400); assert.match(r.error, /CA 1 must be between 0 and 20/);
  r = await call('GET', '/api/scores/sheet?classId=1&subjectId=2&sessionId=1&termId=1', T1);
  assert.deepStrictEqual(r.config.columns.map((c) => c.key), ['ca1', 'ca2', 'exam', 'comment']);
  assert.strictEqual(r.data.find((x) => x.enrollment_id === 1).values.comment, 'Excellent');
  ok('20/20/60 + comment: saved, validated, sheet shows the school columns');

  r = await call('GET', '/api/reports/data/student/1?term=1&sessionId=1', T1);
  assert.ok(r.layout, 'layout present for mixed legacy/custom records');
  const keys = r.layout.columns.map((c) => c.key);
  assert.ok(keys.includes('min') && keys.includes('comment') && keys.includes('ca1'));
  const eng = r.layout.rows.find((x) => x.subject_name === 'English');
  assert.strictEqual(eng.cells.total, 88); assert.strictEqual(eng.grade, 'A'); assert.strictEqual(eng.cells.comment, 'Excellent');
  assert.strictEqual(eng.cells.min, 52); // class lowest in English (10+12+30)
  const maths = r.layout.rows.find((x) => x.subject_name === 'Mathematics');
  assert.strictEqual(maths.cells.total, 84); // old record keeps its marks...
  assert.strictEqual(maths.grade, 'A');      // ...and is graded on the OLD scale (>=70 = A)
  ok('mixed report: new columns + MIN, old record keeps its total and old grading');

  r = await call('GET', '/api/reports/data/class/1?term=1&sessionId=1', T1);
  assert.strictEqual(r.status, 200, JSON.stringify(r)); assert.ok(r.data[0].layout); assert.ok(!('_template_snapshot' in r.data[0].subjects[0]));
  const customPdf = await call('GET', '/api/reports/pdf/1?term=1&sessionId=1', T1);
  assert.strictEqual(customPdf.pdf.slice(0, 4).toString(), '%PDF'); fs.writeFileSync('/tmp/custom.pdf', customPdf.pdf);
  r = await call('GET', '/api/scores/my-grades?term=1&sessionId=1', TS);
  assert.strictEqual(r.status, 200, JSON.stringify(r)); assert.ok(r.layout);
  ok('class JSON, PDF and student grades all render the custom layout');

  // ── 4. Editing an old record adopts the new template; apply-to-existing ─
  r = await call('PUT', `/api/scores/${(await pool.query('SELECT id FROM scores WHERE enrollment_id=2 AND subject_id=1')).rows[0].id}`, T1, { ca1: 4 });
  assert.strictEqual(r.status, 200, JSON.stringify(r)); assert.ok(r.data.template_snapshot);
  r = await call('POST', '/api/assessment/apply', T1, { classId: 1 }); assert.strictEqual(r.status, 400);
  r = await call('POST', '/api/assessment/apply', T1, { confirm: true, classId: 1, sessionId: 1, term: 1 });
  assert.strictEqual(r.status, 200, JSON.stringify(r)); assert.ok(r.updated >= 4);
  r = await call('GET', '/api/reports/data/student/1?term=1&sessionId=1', T1);
  const maths2 = r.layout.rows.find((x) => x.subject_name === 'Mathematics');
  assert.strictEqual(maths2.cells.total, 8 + 9 + 50 - 0); // ca3/ca4 no longer in template; ca1+ca2+exam = 67
  ok('PUT edit restamps; apply-to-existing is explicit and confirmed');

  r = await call('POST', '/api/assessment/config/reset', T1); assert.strictEqual(r.data.isCustom, false);
  ok('reset to built-in layout');

  // ── 5. School-owned subjects ─────────────────────────────────────────
  r = await call('POST', '/api/subjects/school', T1, { name: 'Dance' }); assert.strictEqual(r.status, 201, JSON.stringify(r));
  const danceId = r.data.id;
  r = await call('POST', '/api/subjects/school', T1, { name: 'dance' }); assert.strictEqual(r.status, 409);
  r = await call('POST', '/api/subjects/school', T1, { name: 'mathematics' }); assert.strictEqual(r.status, 409);
  r = await call('POST', '/api/subjects/school', T2, { name: 'Dance' }); assert.strictEqual(r.status, 201);
  r = await call('GET', '/api/subjects/search?keyword=dan', T1); assert.strictEqual(r.data.length, 1);
  r = await call('GET', '/api/classes/subjects', T2);
  assert.ok(r.data.every((s) => s.name !== 'Dance' || s.is_custom)); assert.strictEqual(r.data.filter((s) => s.name === 'Dance').length, 1);
  r = await call('POST', '/api/scores/record', T2, { scores: [{ enrollment_id: 1, subject_id: danceId, term_id: 1, sessionId: 1, ca1_score: 5 }] });
  assert.strictEqual(r.status, 403); // school 2 cannot use school 1's subject (nor school 1's enrollment)
  r = await call('POST', '/api/scores/record', T1, { scores: [{ enrollment_id: 1, subject_id: danceId, term_id: 1, sessionId: 1, ca1_score: 5 }] });
  assert.strictEqual(r.status, 201);
  r = await call('DELETE', `/api/subjects/school/${danceId}`, T1); assert.strictEqual(r.status, 409);
  ok('school subjects: isolated per school, unique names, used in scores, protected once used');

  // ── 6. Classes: add / rename / archive without template resurrection ──
  r = await call('GET', '/api/classes/school', T1); // seeds JSS2 from templates
  assert.deepStrictEqual(r.data.map((c) => c.class_name).sort(), ['JSS1', 'JSS2']);
  const jss2 = r.data.find((c) => c.class_name === 'JSS2').id;
  r = await call('PUT', `/api/classes/school/${jss2}`, T1, { className: 'Grade 8' }); assert.strictEqual(r.status, 200);
  r = await call('GET', '/api/classes/school', T1);
  assert.deepStrictEqual(r.data.map((c) => c.class_name).sort(), ['Grade 8', 'JSS1']); // JSS2 NOT re-created
  r = await call('POST', '/api/classes/school', T1, { className: 'Nursery 1' }); assert.strictEqual(r.status, 201);
  const nurseryId = r.data.id;
  r = await call('POST', '/api/classes/school', T1, { className: 'nursery 1' }); assert.strictEqual(r.status, 409);
  r = await call('DELETE', '/api/classes/school/1', T1); assert.strictEqual(r.status, 409); // has students
  r = await call('DELETE', `/api/classes/school/${nurseryId}`, T1); assert.strictEqual(r.status, 200);
  r = await call('GET', '/api/classes/school', T1);
  assert.deepStrictEqual(r.data.map((c) => c.class_name).sort(), ['Grade 8', 'JSS1']);
  ok('classes: create, rename (template not re-seeded), archive, guarded while students enrolled');

  // ── 7. Arms + teacher assignments ────────────────────────────────────
  r = await call('POST', '/api/academic-structure/arms', T1, { classId: 1, armName: 'A' }); assert.strictEqual(r.status, 201);
  const armA = r.data.id;
  r = await call('POST', '/api/academic-structure/arms', T1, { classId: 1, armName: 'A' }); assert.strictEqual(r.status, 409);
  r = await call('PUT', '/api/academic-structure/enrollments/1/arm', T1, { armId: armA }); assert.strictEqual(r.status, 200);
  r = await call('GET', '/api/scores/sheet?classId=1&subjectId=1&sessionId=1&termId=1&armId=' + armA, T1);
  assert.strictEqual(r.data.length, 1);
  r = await call('DELETE', `/api/academic-structure/arms/${armA}`, T1); assert.strictEqual(r.status, 409);
  await pool.query(`INSERT INTO staff(school_id, full_name, email, role) VALUES (1,'Mrs Eze','eze@x.com','class_teacher')`);
  r = await call('POST', '/api/academic-structure/assignments', T1, { staffId: 1, subjectId: 1, classId: 1, armId: armA }); assert.strictEqual(r.status, 201, JSON.stringify(r));
  r = await call('POST', '/api/academic-structure/assignments', T1, { staffId: 1, subjectId: 1, classId: 1, armId: armA }); assert.strictEqual(r.status, 409);
  r = await call('GET', '/api/academic-structure/assignments?classId=1', T1);
  assert.strictEqual(r.data[0].staff_name, 'Mrs Eze'); assert.strictEqual(r.data[0].arm_name, 'A');
  r = await call('POST', '/api/academic-structure/assignments', T2, { staffId: 1, subjectId: 1, classId: 1 }); assert.strictEqual(r.status, 404); // other school's staff
  ok('arms + student placement + sheet filter + teacher assignments (school-isolated)');

  server.close(); await pool.end();
  console.log('\nALL END-TO-END TESTS PASSED');
})().catch((e) => { console.error('\nFAILED:', e); process.exit(1); });

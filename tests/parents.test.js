/* Parent-access test: real routes + real Postgres.
 *   DATABASE_URL=... JWT_SECRET=x GROQ_API_KEY=x node tests/parents.test.js
 * Needs baseline_schema.sql, e2e_extra.sql and all migrations applied. */
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
const assert = require('assert');
const Module = require('module');

// Capture e-mails instead of sending them (the OTP is read from the message)
const sent = [];
const realLoad = Module._load;
Module._load = function (request, ...rest) {
  const mod = realLoad.call(this, request, ...rest);
  if (request === 'nodemailer') return { ...mod, createTransport: () => ({ sendMail: async (m) => { sent.push(m); } }) };
  return mod;
};

const express = require('express');
const jwt = require('jsonwebtoken');
const pool = require('../database/db');

(async () => {
  const app = express(); app.use(express.json());
  app.use('/api/parents', require('../routes/parents'));
  app.use('/api/scores', require('../routes/scores'));
  app.use('/api/students', require('../routes/students'));
  app.use('/api/reports', require('../routes/reports'));
  const server = app.listen(0); const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, url, token, body) => {
    const r = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, ...(await r.json().catch(() => ({}))) };
  };
  const ok = (m) => console.log('  ✓', m);
  const otpFrom = () => sent[sent.length - 1].html.match(/>(\d{6})</)[1];
  const school1 = jwt.sign({ id: 1, schoolId: 1, type: 'school', countryId: 1 }, process.env.JWT_SECRET);
  const school2 = jwt.sign({ id: 2, schoolId: 2, type: 'school', countryId: 1 }, process.env.JWT_SECRET);

  // ── fixtures: two schools, three kids (two in school 1, one in school 2) ──
  await pool.query(`TRUNCATE parent_students, parents, scores, enrollments, students, classes, global_subjects, schools, email_verifications RESTART IDENTITY CASCADE`);
  await pool.query(`INSERT INTO schools(name, payment_status, subscription_expiry) VALUES ('Alpha School','completed', now()+interval '30 days'),('Beta School','completed', now()+interval '30 days')`);
  await pool.query(`INSERT INTO classes(school_id,class_name) VALUES (1,'JSS1'),(1,'JSS2'),(2,'Grade 5')`);
  await pool.query(`INSERT INTO academic_years(school_id,session_name) VALUES (1,'2026/2027'),(2,'2026/2027')`);
  await pool.query(`INSERT INTO students(school_id,first_name,last_name,registration_number,email) VALUES
     (1,'Ada','Obi','STU-A1','ada@x.com'),(1,'Bayo','Obi','STU-B2','bayo@x.com'),(2,'Chi','Obi','STU-C3','chi@x.com'),(1,'Dele','Stranger','STU-D4','dele@x.com')`);
  await pool.query(`INSERT INTO enrollments(school_id,student_id,class_id,session_id) VALUES (1,1,1,1),(1,2,2,1),(2,3,3,2),(1,4,1,1)`);
  await pool.query(`INSERT INTO global_subjects(subject_name) VALUES ('Maths'),('English')`);
  await pool.query(`INSERT INTO scores(school_id,enrollment_id,subject_id,session_id,term,ca1_score,exam_score) VALUES (1,1,1,1,1,8,50),(1,1,2,1,1,9,40),(1,2,1,1,1,5,30),(2,3,1,2,1,7,60),(1,4,1,1,1,10,59)`);

  // 0. migration gave every student a unique link code (trigger covers new rows too)
  const codes = (await pool.query(`SELECT id, parent_link_code FROM students ORDER BY id`)).rows;
  assert.ok(codes.every((r) => /^[0-9A-F]{8}$/.test(r.parent_link_code)));
  assert.strictEqual(new Set(codes.map((r) => r.parent_link_code)).size, 4);
  ok('every student has a unique link code (new students too, via trigger)');
  const code = (id) => codes.find((r) => r.id === id).parent_link_code;

  // 1. registration needs a verified email
  let r = await call('POST', '/api/parents/register', null, { fullName: 'Mrs Obi', email: 'mum@x.com', password: 'Str0ng!Passw0rd#1' });
  assert.strictEqual(r.status, 400);
  r = await call('POST', '/api/parents/otp', null, { email: 'mum@x.com' }); assert.strictEqual(r.status, 200);
  r = await call('POST', '/api/parents/verify-otp', null, { email: 'mum@x.com', otp: '000000' }); assert.strictEqual(r.status, 400);
  r = await call('POST', '/api/parents/verify-otp', null, { email: 'mum@x.com', otp: otpFrom() }); assert.strictEqual(r.status, 200);
  r = await call('POST', '/api/parents/register', null, { fullName: 'Mrs Obi', email: 'mum@x.com', password: 'weak' }); assert.strictEqual(r.status, 400);
  r = await call('POST', '/api/parents/register', null, { fullName: 'Mrs Obi', email: 'mum@x.com', password: 'Str0ng!Passw0rd#1', phone: '0801' });
  assert.strictEqual(r.status, 201, JSON.stringify(r));
  let P = r.data.token;
  r = await call('POST', '/api/parents/login', null, { email: 'mum@x.com', password: 'wrong' }); assert.strictEqual(r.status, 401);
  r = await call('POST', '/api/parents/login', null, { email: 'MUM@x.com', password: 'Str0ng!Passw0rd#1' }); assert.strictEqual(r.status, 200); P = r.data.token;
  ok('register (OTP verified, strong password) and login');

  // 2. a parent token is useless on school / student routes
  assert.strictEqual((await call('GET', '/api/scores/sheet?classId=1&subjectId=1&sessionId=1&termId=1', P)).status, 403);
  assert.strictEqual((await call('GET', '/api/scores/my-grades?term=1&sessionId=1', P)).status, 403);
  assert.strictEqual((await call('GET', '/api/parents/school/settings', P)).status, 403);
  ok('parent token is rejected by every school/student route');

  // 3. linking one child at a time, by registration number + code
  r = await call('GET', '/api/parents/children', P); assert.strictEqual(r.count, 0);
  r = await call('POST', '/api/parents/children/link', P, { registrationNumber: 'STU-A1', linkCode: 'WRONGCODE' }); assert.strictEqual(r.status, 404);
  r = await call('POST', '/api/parents/children/link', P, { registrationNumber: 'STU-A1', linkCode: code(2) }); assert.strictEqual(r.status, 404); // another child's code
  for (const [reg, id] of [['STU-A1', 1], ['stu-b2', 2], ['STU-C3', 3]]) {
    r = await call('POST', '/api/parents/children/link', P, { registrationNumber: reg, linkCode: code(id).toLowerCase(), relationship: 'mother' });
    assert.strictEqual(r.status, 201, JSON.stringify(r));
  }
  r = await call('GET', '/api/parents/children', P);
  assert.strictEqual(r.count, 3);
  const ada = r.data.find((c) => c.firstName === 'Ada'); const chi = r.data.find((c) => c.firstName === 'Chi');
  assert.strictEqual(ada.currentClass, 'JSS1'); assert.strictEqual(ada.latestResults.subjects, 2); assert.strictEqual(ada.latestResults.averageTotal, 53.5);
  assert.strictEqual(chi.school.name, 'Beta School');
  ok('one parent, three children across two schools - wrong/other codes rejected');

  // 4. child token -> the EXISTING student endpoints, scoped to that child only
  r = await call('POST', `/api/parents/children/${ada.studentId}/token`, P); assert.strictEqual(r.status, 200);
  const adaTok = r.data.token; assert.strictEqual(r.data.schoolActive, true);
  r = await call('GET', '/api/scores/my-grades?term=1&sessionId=1', adaTok);
  assert.strictEqual(r.status, 200, JSON.stringify(r)); assert.strictEqual(r.count, 2);
  assert.ok(r.data.every((x) => ['Maths', 'English'].includes(x.subject_name)));
  r = await call('GET', '/api/students/me/enrollments', adaTok); assert.strictEqual(r.status, 200, JSON.stringify(r)); assert.strictEqual(r.count, 1);
  r = await call('GET', '/api/reports/data/student/2?term=1&sessionId=1', adaTok); assert.strictEqual(r.status, 403); // a sibling's report is a different child
  r = await call('GET', '/api/reports/data/student/1?term=1&sessionId=1', adaTok); assert.strictEqual(r.status, 200, JSON.stringify(r));
  ok("child token shows only that child's grades, enrollments and report data");

  // 5. view-only
  r = await call('PUT', '/api/students/profile', adaTok, { firstName: 'Hacked' }); assert.strictEqual(r.status, 403); assert.strictEqual(r.code, 'PARENT_READ_ONLY');
  r = await call('POST', '/api/students/self-enroll', adaTok, {}); assert.strictEqual(r.status, 403);
  r = await call('POST', '/api/reports/regenerate-remark/1', adaTok, {}); assert.strictEqual(r.status, 403);
  assert.strictEqual((await pool.query(`SELECT first_name FROM students WHERE id=1`)).rows[0].first_name, 'Ada');
  r = await call('POST', '/api/reports/email/official-report/1', adaTok, { term: 1, sessionId: 1, email: 'mum@x.com' });
  assert.notStrictEqual(r.status, 403, 'emailing the report card is allowed'); // may fail later for missing AI key etc., but not blocked
  ok('child tokens are read-only (profile/enrol/regenerate blocked); e-mailing a report card is allowed');

  // 6. cannot open a child that is not linked (stranger in the same school, or other parent's)
  r = await call('POST', '/api/parents/children/4/token', P); assert.strictEqual(r.status, 404);
  r = await call('GET', '/api/parents/children/4/overview', P); assert.strictEqual(r.status, 404);
  ok('unlinked children cannot be opened');

  // 7. overview + attendance
  r = await call('GET', `/api/parents/children/${ada.studentId}/overview`, P);
  assert.strictEqual(r.status, 200, JSON.stringify(r)); assert.strictEqual(r.data.school.name, 'Alpha School');
  assert.strictEqual(r.data.reportTerms.length, 1); assert.strictEqual(r.data.reportTerms[0].subjects, 2);
  await pool.query(`CREATE TABLE IF NOT EXISTS attendance_records (id SERIAL PRIMARY KEY, school_id INT, class_id INT, enrollment_id INT, student_id INT, session_id INT, term INT, attendance_date DATE, period VARCHAR(10) DEFAULT 'full_day', status VARCHAR(10), remarks TEXT)`);
  await pool.query(`TRUNCATE attendance_records`);
  await pool.query(`INSERT INTO attendance_records(school_id,class_id,enrollment_id,student_id,session_id,term,attendance_date,status) VALUES
     (1,1,1,1,1,1,'2026-09-14','present'),(1,1,1,1,1,1,'2026-09-15','late'),(1,1,1,1,1,1,'2026-09-16','absent'),
     (1,1,4,4,1,1,'2026-09-14','present'),(1,1,4,4,1,1,'2026-09-15','present'),(1,1,4,4,1,1,'2026-09-16','present'),(1,1,4,4,1,1,'2026-09-17','present')`);
  r = await call('GET', `/api/parents/children/${ada.studentId}/attendance`, P);
  assert.strictEqual(r.status, 200, JSON.stringify(r)); assert.strictEqual(r.data.terms[0].present, 1); assert.strictEqual(r.data.terms[0].late, 1); assert.strictEqual(r.data.terms[0].absent, 1);
  assert.strictEqual(r.data.terms[0].sessions_held, 4); assert.strictEqual(r.data.terms[0].percentage, 50); // (1 present + 1 late) / 4 days the class met
  assert.strictEqual(r.data.recent.length, 3);
  ok('overview and attendance (only that child)');

  // 8. second parent (the father) sees only what he is linked to; removal works
  r = await call('POST', '/api/parents/otp', null, { email: 'dad@x.com' });
  await call('POST', '/api/parents/verify-otp', null, { email: 'dad@x.com', otp: otpFrom() });
  r = await call('POST', '/api/parents/register', null, { fullName: 'Mr Obi', email: 'dad@x.com', password: 'Str0ng!Passw0rd#1' }); const D = r.data.token;
  assert.strictEqual((await call('POST', `/api/parents/children/${ada.studentId}/token`, D)).status, 404);
  r = await call('POST', '/api/parents/children/link', D, { registrationNumber: 'STU-A1', linkCode: code(1) }); assert.strictEqual(r.status, 201);
  r = await call('DELETE', `/api/parents/children/${ada.studentId}`, D); assert.strictEqual(r.status, 200);
  assert.strictEqual((await call('POST', `/api/parents/children/${ada.studentId}/token`, D)).status, 404);
  assert.strictEqual((await call('GET', '/api/parents/children', P)).count, 3); // mum unaffected
  ok('second parent: isolated; self-unlink works and does not affect the other parent');

  // 9. school side: settings, guardian email, auto-link (off by default), regenerate, revoke
  r = await call('GET', '/api/parents/school/settings', school1); assert.strictEqual(r.data.autoLink, false); assert.strictEqual(r.data.parents, 1);
  r = await call('PUT', '/api/parents/school/students/4/guardian', school1, { guardianName: 'Mr Stranger', guardianEmail: 'dad@x.com', guardianPhone: '08' });
  assert.strictEqual(r.status, 200);
  assert.strictEqual((await call('GET', '/api/parents/children', D)).count, 0, 'auto-link is off, so nothing links');
  await call('PUT', '/api/parents/school/settings', school1, { autoLink: true });
  assert.strictEqual((await call('GET', '/api/parents/children', D)).count, 1, 'auto-link on: the guardian e-mail matches');
  r = await call('PUT', '/api/parents/school/students/3/guardian', school1, { guardianEmail: 'dad@x.com' }); assert.strictEqual(r.status, 404); // other school's student
  r = await call('GET', '/api/parents/school/students?search=Obi', school1); assert.strictEqual(r.data.length, 2); assert.ok(r.data[0].parent_link_code);
  r = await call('GET', '/api/parents/school/students?search=Obi', school2); assert.strictEqual(r.data.length, 1);
  r = await call('GET', '/api/parents/school/students/1/links', school1); assert.strictEqual(r.data.length, 1); assert.strictEqual(r.data[0].email, 'mum@x.com');
  await call('DELETE', `/api/parents/school/links/${r.data[0].link_id}`, school1);
  assert.strictEqual((await call('POST', `/api/parents/children/1/token`, P)).status, 404);
  assert.strictEqual((await call('GET', '/api/parents/children', P)).count, 2);
  r = await call('POST', '/api/parents/school/students/1/regenerate-code', school1, { revokeLinks: true }); assert.strictEqual(r.status, 200);
  const newCode = r.data.parentLinkCode; assert.notStrictEqual(newCode, code(1));
  r = await call('POST', '/api/parents/children/link', P, { registrationNumber: 'STU-A1', linkCode: code(1) }); assert.strictEqual(r.status, 404); // old code dead
  r = await call('POST', '/api/parents/children/link', P, { registrationNumber: 'STU-A1', linkCode: newCode }); assert.strictEqual(r.status, 201); // re-link after revoke works with the new code
  r = await call('POST', '/api/parents/school/students/2/regenerate-code', school2, {}); assert.strictEqual(r.status, 404); // not their student
  ok('school side: auto-link switch, guardian e-mail, revoke, regenerate code (old code stops working)');

  // 10. a school whose subscription lapsed: only that child is locked
  await pool.query(`UPDATE schools SET subscription_expiry = now() - interval '1 day' WHERE id = 2`);
  r = await call('GET', '/api/parents/children', P);
  assert.strictEqual(r.data.find((c) => c.firstName === 'Chi').school.active, false);
  assert.strictEqual(r.data.find((c) => c.firstName === 'Ada').school.active, true);
  r = await call('POST', `/api/parents/children/3/token`, P);
  assert.strictEqual(r.data.schoolActive, false);
  assert.strictEqual((await call('GET', '/api/scores/my-grades?term=1&sessionId=2', r.data.token)).status, 402);
  ok('expired school locks only its own child (402); other children unaffected');

  // 11. password reset
  r = await call('POST', '/api/parents/forgot-password', null, { email: 'nobody@x.com' }); assert.strictEqual(r.status, 200);
  const before = sent.length;
  await call('POST', '/api/parents/forgot-password', null, { email: 'mum@x.com' }); assert.strictEqual(sent.length, before + 1);
  r = await call('POST', '/api/parents/reset-password', null, { email: 'mum@x.com', otp: otpFrom(), newPassword: 'N3w!Passw0rd#22' }); assert.strictEqual(r.status, 200, JSON.stringify(r));
  assert.strictEqual((await call('POST', '/api/parents/login', null, { email: 'mum@x.com', password: 'N3w!Passw0rd#22' })).status, 200);
  ok('forgot / reset password (no account enumeration)');

  server.close(); await pool.end();
  console.log('\nPARENT ACCESS TESTS PASSED');
})().catch((e) => { console.error('\nFAILED:', e); process.exit(1); });

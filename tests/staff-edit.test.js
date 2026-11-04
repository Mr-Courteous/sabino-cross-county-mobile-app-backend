/* Owner edits staff details (name / email / phone). Real route + Postgres, e-mail captured.
 *   DATABASE_URL=... JWT_SECRET=x node tests/staff-edit.test.js */
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
const assert = require('assert');
const Module = require('module');
const sent = [];
const realLoad = Module._load;
Module._load = function (request, ...rest) {
  const mod = realLoad.call(this, request, ...rest);
  if (request === 'nodemailer') return { ...mod, createTransport: () => ({ sendMail: async (m) => { sent.push(m); } }) };
  return mod;
};
const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const pool = require('../database/db');

(async () => {
  const { managementRouter } = require('../routes/staff-onboarding');
  const app = express(); app.use(express.json()); app.use('/api/staff', managementRouter);
  const server = app.listen(0); const base = `http://127.0.0.1:${server.address().port}`;
  const patch = async (id, token, body) => {
    const r = await fetch(`${base}/api/staff/admins/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
    return { status: r.status, ...(await r.json()) };
  };
  const ok = (m) => console.log('  ✓', m);
  const sign = (p) => jwt.sign(p, process.env.JWT_SECRET);
  const owner = sign({ id: 1, schoolId: 1, type: 'school', countryId: 1 });
  const owner2 = sign({ id: 2, schoolId: 2, type: 'school', countryId: 1 });
  const admin = sign({ id: 5, schoolId: 1, type: 'school', countryId: 1, role: 'admin', staffId: 5, staffRole: 'admin' });

  await require('../routes/staff-onboarding/db').ensureStaffTables();
  await pool.query(`TRUNCATE staff, staff_invite_codes, staff_audit_logs, schools RESTART IDENTITY CASCADE`);
  await pool.query(`INSERT INTO schools(name,email) VALUES ('Alpha School','owner@alpha.com'),('Beta School','owner@beta.com')`);
  const oldHash = await bcrypt.hash('OldTemp#123', 10);
  const ins = (school, name, email, status, role = 'class_teacher') =>
    pool.query(`INSERT INTO staff(school_id, full_name, email, phone, role, password_hash, status) VALUES ($1,$2,$3,'0801',$4,$5,$6) RETURNING id`, [school, name, email, role, oldHash, status]).then((r) => r.rows[0].id);
  const fresh = await ins(1, 'New Teacher', 'new@alpha.com', 'password_reset_required');
  const active = await ins(1, 'Active Teacher', 'active@alpha.com', 'active');
  const other = await ins(1, 'Other Teacher', 'other@alpha.com', 'active');
  const foreign = await ins(2, 'Beta Teacher', 'teacher@beta.com', 'active');
  await pool.query(`INSERT INTO staff_invite_codes(school_id, code, email, role, status, expires_at) VALUES (1,'ABCD2345','invited@alpha.com','admin','pending', now()+interval '1 day')`);
  const row = async (id) => (await pool.query(`SELECT * FROM staff WHERE id=$1`, [id])).rows[0];

  // name + phone only: no e-mail, no password change
  let r = await patch(active, owner, { fullName: '  Mrs   Grace  Eze ', phone: '08099990000' });
  assert.strictEqual(r.status, 200, JSON.stringify(r));
  let a = await row(active);
  assert.strictEqual(a.full_name, 'Mrs Grace Eze'); assert.strictEqual(a.phone, '08099990000'); assert.strictEqual(a.password_hash, oldHash);
  assert.strictEqual(sent.length, 0);
  ok('name and phone can be edited (spaces tidied), nothing is e-mailed');

  r = await patch(active, owner, { phone: '' }); assert.strictEqual((await row(active)).phone, null);
  r = await patch(active, owner, { fullName: 'Mrs Grace Eze' }); assert.strictEqual(r.message, 'Nothing changed.');
  ok('phone can be cleared; re-sending the same values changes nothing');

  // e-mail change for someone already using the account: both addresses are told, password untouched
  r = await patch(active, owner, { email: 'Grace.New@Alpha.com' });
  assert.strictEqual(r.status, 200, JSON.stringify(r));
  a = await row(active);
  assert.strictEqual(a.email, 'grace.new@alpha.com'); assert.strictEqual(a.password_hash, oldHash);
  assert.deepStrictEqual(sent.map((m) => m.to).sort(), ['active@alpha.com', 'grace.new@alpha.com']);
  assert.strictEqual(r.data.temporaryPassword, undefined);
  ok('active staff: login email changed, old + new address notified, password unchanged');

  // never logged in: the temp password went to the old address, so a new one goes to the new address
  sent.length = 0;
  r = await patch(fresh, owner, { email: 'corrected@alpha.com' });
  assert.strictEqual(r.status, 200, JSON.stringify(r));
  const f = await row(fresh);
  assert.notStrictEqual(f.password_hash, oldHash); assert.strictEqual(f.force_password_change, true); assert.strictEqual(f.status, 'password_reset_required');
  assert.strictEqual(sent.length, 1); assert.strictEqual(sent[0].to, 'corrected@alpha.com'); assert.ok(sent[0].html.includes(r.data.temporaryPassword));
  assert.ok(await bcrypt.compare(r.data.temporaryPassword, f.password_hash));
  ok('never-logged-in staff: fixing a mistyped email issues a new temporary password to the new address');

  // refusals
  assert.strictEqual((await patch(other, owner, { email: 'corrected@alpha.com' })).status, 409);
  assert.strictEqual((await patch(other, owner, { email: 'OWNER@alpha.com' })).status, 409);
  assert.strictEqual((await patch(other, owner, { email: 'owner@beta.com' })).status, 409);
  assert.strictEqual((await patch(other, owner, { email: 'invited@alpha.com' })).status, 409);
  assert.strictEqual((await patch(other, owner, { email: 'not-an-email' })).status, 400);
  assert.strictEqual((await patch(other, owner, { fullName: 'A' })).status, 400);
  assert.strictEqual((await patch(other, owner, {})).status, 400);
  assert.strictEqual((await row(other)).email, 'other@alpha.com');
  ok('duplicate staff / school owner / pending invite emails, bad emails, bad names and empty requests are refused');

  // who may do it: owner = anyone; full admin = class teachers only; class teacher = nobody
  const teacherTok = sign({ id: 6, schoolId: 1, type: 'school', countryId: 1, role: 'admin', staffId: 6, staffRole: 'class_teacher' });
  const otherAdminId = await ins(1, 'Second Admin', 'admin2@alpha.com', 'active', 'admin');
  assert.strictEqual((await patch(other, admin, { fullName: 'Edited By Admin', phone: '0700' })).status, 200);
  assert.strictEqual((await row(other)).full_name, 'Edited By Admin');
  assert.strictEqual((await patch(otherAdminId, admin, { fullName: 'Hacked Name' })).status, 403);
  assert.strictEqual((await patch(other, admin, { role: 'admin' })).status, 403);
  assert.strictEqual((await row(other)).role, 'class_teacher');
  assert.strictEqual((await patch(other, teacherTok, { fullName: 'Nope' })).status, 403);
  assert.strictEqual((await patch(foreign, admin, { fullName: 'Cross School' })).status, 404);
  assert.strictEqual((await patch(foreign, owner, { fullName: 'Cross School' })).status, 404);
  assert.strictEqual((await row(foreign)).full_name, 'Beta Teacher');
  assert.strictEqual((await patch(foreign, owner2, { fullName: 'Beta Edited' })).status, 200);
  ok('only the owner can edit; nobody can edit another school\'s staff');

  // owner can change a role (applies from next login); an admin is not tied to a class
  await pool.query(`UPDATE staff SET class_id = NULL WHERE id = $1`, [other]);
  r = await patch(other, owner, { role: 'admin' }); assert.strictEqual(r.status, 200, JSON.stringify(r)); assert.strictEqual((await row(other)).role, 'admin');
  assert.strictEqual((await patch(other, owner, { role: 'superuser' })).status, 400);
  ok('full admin edits teachers but not other admins; only the owner changes roles');

  // the DATABASE refuses duplicate login emails even if some code path forgets to check
  const dbRefuses = async (sql, params) => { try { await pool.query(sql, params); return false; } catch (e) { return e.code === '23505'; } };
  assert.ok(await dbRefuses(`INSERT INTO staff(school_id, full_name, email, role, password_hash, status) VALUES (1,'Dup','ADMIN2@alpha.com','class_teacher','x','active')`), 'same email, different case');
  assert.ok(await dbRefuses(`INSERT INTO staff(school_id, full_name, email, role, password_hash, status) VALUES (2,'Dup','admin2@alpha.com','class_teacher','x','active')`), 'same email in another school');
  assert.ok(await dbRefuses(`INSERT INTO staff(school_id, full_name, email, role, password_hash, status) VALUES (1,'Dup','Owner@Alpha.com','class_teacher','x','active')`), 'a school owner email');
  assert.ok(await dbRefuses(`UPDATE staff SET email = 'Grace.New@alpha.com' WHERE id = $1`, [other]), 'update to someone else\'s email');
  assert.ok(await dbRefuses(`INSERT INTO schools(name,email) VALUES ('Gamma','GRACE.NEW@alpha.com')`), 'a school registering with a staff email');
  assert.strictEqual((await pool.query(`INSERT INTO schools(name,email) VALUES ('Gamma','owner@gamma.com') RETURNING id`)).rows.length, 1);
  assert.strictEqual((await pool.query(`UPDATE staff SET full_name = 'Same Email Ok' WHERE id = $1 RETURNING id`, [other])).rows.length, 1);
  ok('database refuses duplicate emails (any letter case, any school, staff vs school owner, both directions)');

  // audit trail
  const log = (await pool.query(`SELECT action, details FROM staff_audit_logs WHERE action = 'staff.updated' ORDER BY id`)).rows;
  assert.ok(log.length >= 4);
  assert.ok(log.some((l) => l.details && JSON.parse(JSON.stringify(l.details)).credentialsReissued === true));
  ok('every edit is written to the staff audit log');

  server.close(); await pool.end();
  console.log('\nSTAFF EDIT TESTS PASSED');
})().catch((e) => { console.error('\nFAILED:', e); process.exit(1); });

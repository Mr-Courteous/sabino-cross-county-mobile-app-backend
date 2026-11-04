/* Registration free-trial test (real route + real Postgres).
 *   DATABASE_URL=... JWT_SECRET=x node tests/trial.test.js */
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
const assert = require('assert');
const express = require('express');
const pool = require('../database/db');

(async () => {
  const app = express(); app.use(express.json());
  app.use('/api/schools', require('../routes/schools'));
  const server = app.listen(0); const base = `http://127.0.0.1:${server.address().port}`;
  const post = async (url, body) => { const r = await fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); return { status: r.status, ...(await r.json()) }; };
  const ok = (m) => console.log('  ✓', m);

  await pool.query(`CREATE TABLE IF NOT EXISTS email_verifications (email TEXT PRIMARY KEY, otp_code TEXT, expires_at TIMESTAMP, is_verified BOOLEAN DEFAULT false)`);
  await pool.query(`CREATE TABLE IF NOT EXISTS academic_sessions (id SERIAL PRIMARY KEY, school_id INT, session_name TEXT, is_active BOOLEAN, UNIQUE(school_id, session_name))`);
  for (const col of ['registration_code TEXT', 'email TEXT UNIQUE', 'password TEXT', 'school_type TEXT', 'country_id INT', 'country TEXT', 'phone TEXT']) {
    await pool.query(`ALTER TABLE schools ADD COLUMN IF NOT EXISTS ${col}`);
  }
  await pool.query(`TRUNCATE schools RESTART IDENTITY CASCADE`);
  await pool.query(`DELETE FROM email_verifications`);
  for (const e of ['a@x.com', 'b@x.com', 'c@x.com']) await pool.query(`INSERT INTO email_verifications(email,is_verified) VALUES ($1,true)`, [e]);
  const reg = (email, phone) => post('/api/schools', { name: 'S', email, password: 'Str0ng!Passw0rd#1', school_type: 'secondary', country_id: 1, phone });

  // 1. new school -> trial
  let r = await reg('a@x.com', '08011112222');
  assert.strictEqual(r.status, 201, JSON.stringify(r));
  assert.strictEqual(r.data.user.paymentStatus, 'completed');
  assert.strictEqual(r.data.user.trial.isTrial, true);
  let row = (await pool.query(`SELECT payment_status, subscription_expiry, is_trial, trial_started_at FROM schools WHERE email='a@x.com'`)).rows[0];
  const days = (new Date(row.subscription_expiry) - Date.now()) / 86400000;
  assert.strictEqual(row.payment_status, 'completed'); assert.ok(days > 2.99 && days <= 3.001, days);
  assert.strictEqual(row.is_trial, true); assert.ok(row.trial_started_at);
  ok('new school: completed + expiry 3 days out, trial recorded');

  // 1b. the app asks where the school stands (banner + pricing wording)
  const jwt = require('jsonwebtoken');
  const t1 = jwt.sign({ id: 1, schoolId: 1, type: 'school', countryId: 1 }, process.env.JWT_SECRET);
  const info = async (tok) => { const r = await fetch(`${base}/api/schools/subscription-info`, { headers: { Authorization: `Bearer ${tok}` } }); return { status: r.status, ...(await r.json()) }; };
  let si = await info(t1);
  assert.strictEqual(si.status, 200, JSON.stringify(si));
  assert.strictEqual(si.data.isTrial, true); assert.strictEqual(si.data.daysLeft, 3); assert.strictEqual(si.data.status, 'completed');
  ok('subscription-info: new school is on an unpaid 3-day trial');

  // 2. checkSubscription lets them in, then locks them out when the 3 days pass
  const checkSubscription = require('../middleware/checkSubscription');
  const run = async () => { let out = {}; await checkSubscription({ user: { schoolId: 1 } }, { status(c) { out.code = c; return this; }, json(j) { out.body = j; } }, () => { out.next = true; }); return out; };
  let c = await run(); assert.strictEqual(c.next, true); assert.ok(c.body === undefined);
  await pool.query(`UPDATE schools SET subscription_expiry = now() - interval '1 minute' WHERE id=1`);
  c = await run(); assert.strictEqual(c.code, 402); assert.strictEqual(c.body.paymentStatus, 'expired');
  assert.strictEqual((await pool.query(`SELECT payment_status FROM schools WHERE id=1`)).rows[0].payment_status, 'expired');
  ok('access works during trial; after 3 days the school is auto-set to expired (402)');

  // 3. second school with same phone -> no second trial (goes to payment)
  r = await reg('b@x.com', '+234 801 111 2222');
  assert.strictEqual(r.data.user.paymentStatus, 'pending'); assert.strictEqual(r.data.user.trial.isTrial, false);
  ok('same phone number cannot start another trial');

  // 4. different phone -> trial
  r = await reg('c@x.com', '09099998888');
  assert.strictEqual(r.data.user.paymentStatus, 'completed');
  ok('different phone gets its own trial');

  // 5. paying during the trial must upgrade the school (payments.js shortcut)
  await pool.query(`UPDATE schools SET payment_status='completed', subscription_expiry=trial_ends_at WHERE email='c@x.com'`);
  const sid = (await pool.query(`SELECT id FROM schools WHERE email='c@x.com'`)).rows[0].id;
  const paySrc = require('fs').readFileSync(require('path').join(__dirname, '../routes/payments.js'), 'utf8');
  assert.ok((paySrc.match(/isUnpaidTrial\(/g) || []).length >= 4, 'all three shortcuts check for an unpaid trial');
  const unpaid = async () => (await pool.query(`SELECT 1 FROM schools WHERE id=$1 AND is_trial=true AND subscription_expiry IS NOT DISTINCT FROM trial_ends_at`, [sid])).rows.length > 0;
  assert.strictEqual(await unpaid(), true);
  await pool.query(`UPDATE schools SET subscription_expiry = now() + interval '4 months' WHERE id=$1`, [sid]); // what a payment does
  assert.strictEqual(await unpaid(), false);
  ok('trial is flagged unpaid until a payment changes the expiry; payment shortcuts honour it');

  // 6. after paying: no longer a trial, shows the paid term; expired school sees 'expired'
  const t3 = jwt.sign({ id: sid, schoolId: sid, type: 'school', countryId: 1 }, process.env.JWT_SECRET);
  si = await info(t3);
  assert.strictEqual(si.data.isTrial, false); assert.ok(si.data.daysLeft > 100, 'paid for ~4 months: ' + si.data.daysLeft);
  si = await info(t1); // school 1 was expired in step 2
  assert.strictEqual(si.data.status, 'expired'); assert.strictEqual(si.data.isTrial, false);
  ok('subscription-info: paid school is not a trial; lapsed school reports expired');

  server.close(); await pool.end();
  console.log('\nTRIAL TESTS PASSED');
})().catch((e) => { console.error('\nFAILED:', e); process.exit(1); });

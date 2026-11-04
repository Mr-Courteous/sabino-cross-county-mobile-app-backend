/* A school pays WHILE on its free trial (Flutterwave mocked).
 *   DATABASE_URL=... JWT_SECRET=x node tests/pay-during-trial.test.js */
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
const assert = require('assert');
const Module = require('module');

let flwStatus = 'successful';
let flwMeta = {};
const realLoad = Module._load;
Module._load = function (request, ...rest) {
  const mod = realLoad.call(this, request, ...rest);
  if (request === 'axios') {
    return { ...mod, get: async () => ({ data: { data: { status: flwStatus, amount: 7320, currency: 'NGN', meta: flwMeta } } }), post: mod.post };
  }
  if (request === 'nodemailer') return { ...mod, createTransport: () => ({ sendMail: async () => {} }) };
  return mod;
};

const express = require('express');
const jwt = require('jsonwebtoken');
const pool = require('../database/db');

(async () => {
  const app = express(); app.use(express.json());
  app.use('/api/payments', require('../routes/payments'));
  app.use('/api/schools', require('../routes/schools'));
  const server = app.listen(0); const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, url, token, body) => {
    const r = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, ...(await r.json().catch(() => ({}))) };
  };
  const ok = (m) => console.log('  ✓', m);

  await pool.query(`TRUNCATE schools RESTART IDENTITY CASCADE`);
  // school 1: on the free trial (2 days left, unpaid) / school 2: already paid for 3 months
  await pool.query(`INSERT INTO schools(name,payment_status,subscription_expiry,is_trial,trial_started_at,trial_ends_at)
                    VALUES ('Trial School','completed', now()+interval '2 days', true, now()-interval '1 day', now()+interval '2 days')`);
  await pool.query(`UPDATE schools SET trial_ends_at = subscription_expiry WHERE id = 1`);
  await pool.query(`INSERT INTO schools(name,payment_status,subscription_expiry) VALUES ('Paid School','completed', now()+interval '3 months')`);
  const tok = (id) => jwt.sign({ id, schoolId: id, type: 'school', countryId: 1 }, process.env.JWT_SECRET);
  const expiryOf = async (id) => (await pool.query(`SELECT subscription_expiry FROM schools WHERE id=$1`, [id])).rows[0].subscription_expiry;
  const monthsAhead = (d) => (new Date(d) - Date.now()) / (86400000 * 30.44);

  let r = await call('GET', '/api/schools/subscription-info', tok(1));
  assert.strictEqual(r.data.isTrial, true);

  // a failed / pending payment changes nothing
  flwStatus = 'pending'; flwMeta = { school_id: 1 };
  r = await call('POST', '/api/payments/verify', tok(1), { tx_ref: 'SAB-1-x' }); assert.strictEqual(r.status, 402);
  flwStatus = 'failed';
  r = await call('POST', '/api/payments/verify', tok(1), { tx_ref: 'SAB-1-x' }); assert.strictEqual(r.status, 402);
  assert.ok(monthsAhead(await expiryOf(1)) < 0.1);
  ok('a pending/failed payment leaves the trial alone');

  // someone else's transaction cannot be claimed
  flwStatus = 'successful'; flwMeta = { school_id: 2 };
  r = await call('POST', '/api/payments/verify', tok(1), { tx_ref: 'SAB-2-x' }); assert.strictEqual(r.status, 403);
  ok("a school cannot claim another school's payment");

  // the real thing: pay on day 1 of the trial
  flwMeta = { school_id: 1 };
  r = await call('POST', '/api/payments/verify', tok(1), { tx_ref: 'SAB-1-ok' });
  assert.strictEqual(r.status, 200, JSON.stringify(r)); assert.strictEqual(r.message, 'Subscription activated successfully');
  const m = monthsAhead(await expiryOf(1));
  assert.ok(m > 3.9 && m < 4.1, `expiry should be ~4 months out, got ${m}`);
  r = await call('GET', '/api/schools/subscription-info', tok(1));
  assert.strictEqual(r.data.isTrial, false); assert.strictEqual(r.data.status, 'completed'); assert.ok(r.data.daysLeft > 115);
  ok('paying during the trial upgrades the school at once (4 months from today, no longer a trial)');

  // replaying the same confirmation does not stack time
  const before = await expiryOf(1);
  r = await call('POST', '/api/payments/verify', tok(1), { tx_ref: 'SAB-1-ok' });
  assert.strictEqual(r.status, 200); assert.strictEqual(r.message, 'Subscription already active');
  assert.strictEqual(String(await expiryOf(1)), String(before));
  ok('confirming again does not extend the plan a second time');

  // an already-paid (non-trial) school is untouched, as before
  flwMeta = { school_id: 2 };
  const paidBefore = await expiryOf(2);
  r = await call('POST', '/api/payments/verify', tok(2), { tx_ref: 'SAB-2-ok' });
  assert.strictEqual(r.message, 'Subscription already active'); assert.strictEqual(String(await expiryOf(2)), String(paidBefore));
  ok('an already-paid school behaves exactly as before');

  server.close(); await pool.end();
  console.log('\nPAY-DURING-TRIAL TESTS PASSED');
})().catch((e) => { console.error('\nFAILED:', e); process.exit(1); });

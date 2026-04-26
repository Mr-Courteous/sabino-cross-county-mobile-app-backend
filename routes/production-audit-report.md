# Production Readiness & Scalability Audit
**Project:** Sabino Academy Backend API  
**Files Reviewed:** auth.js, schools.js, students.js, classes.js, subjects.js, scores.js, reports.js, preferences.js, payments.js, subscriptions.js, academicYears.js  
**Date:** April 2026

---

## 🔴 CRITICAL — Fix Before Production

### 1. Hardcoded Email Credentials (schools.js, students.js, reports.js)
**Severity: CRITICAL — Security Breach Risk**

Plaintext Gmail credentials appear directly in source code across multiple files:

```js
// schools.js, students.js, reports.js
auth: {
  user: 'inumiduncourteous@gmail.com',
  pass: 'vvcx njbg cwac kuao',  // ← App password in source
}
```

**Problems:**
- Anyone with repo access can read your email credentials
- Google can revoke app passwords without notice, breaking all email flows
- Git history retains these even after deletion

**Fix:**
```js
auth: {
  user: process.env.EMAIL_USER,
  pass: process.env.EMAIL_APP_PASSWORD,
}
```
Add `EMAIL_USER` and `EMAIL_APP_PASSWORD` to `.env` and your deployment environment (Vercel/Railway/etc).

---

### 2. Undefined Variable `effectiveCountryId` in classes.js (POST /initialize-from-templates)
**Severity: CRITICAL — Runtime Crash**

```js
// classes.js — POST /initialize-from-templates
const countryId = req.user?.countryId;
// effectiveCountryId is NEVER defined here ← crashes at runtime
const templates = await client.query(
  `SELECT ... FROM global_class_templates WHERE country_id = $1`,
  [effectiveCountryId]  // ReferenceError!
);

// Also in the same route:
console.log(`... (effective: ${effectiveCountryId})`);  // same crash
```

The `/initialize` (legacy) endpoint correctly defines it; `/initialize-from-templates` does not.

**Fix:**
```js
const effectiveCountryId = (countryId === 22 ? 1 : countryId);
```
Add this line after `const countryId = req.user?.countryId;`.

---

### 3. Broken Email `from` Field (schools.js)
**Severity: CRITICAL — All Emails Will Fail**

```js
// schools.js
from: '"Sabino School" Sabinoschool1@gmail.com <',  // ← Malformed, missing closing >
```

This will throw an SMTP error on every registration attempt.

**Fix:**
```js
from: '"Sabino School" <Sabinoschool1@gmail.com>',
```

---

### 4. Payment Amount Verification Not Performed (payments.js, subscriptions.js)
**Severity: CRITICAL — Revenue Fraud Risk**

Both the payments and subscriptions verify routes confirm that a Flutterwave transaction is `successful`, but neither verifies that `flwData.amount` matches the expected plan price:

```js
// payments.js — verify route
if (flwData.status !== 'successful') { ... }
// No check: flwData.amount >= plan.price ← attacker can pay ₦1 for a ₦50,000 plan
```

**Fix — add after status check:**
```js
const expectedAmount = Number(plan.price);
const paidAmount = Number(flwData.amount);
if (paidAmount < expectedAmount) {
  return res.status(400).json({
    success: false,
    message: `Payment amount mismatch. Expected ₦${expectedAmount}, received ₦${paidAmount}.`
  });
}
```

---

## 🟠 HIGH — Address Before Launch

### 5. No Rate Limiting on OTP / Auth Endpoints (schools.js, students.js)
OTP generation (`/otp`) and login (`/login`) have no rate limiting. An attacker can:
- Spam OTP requests to exhaust your email quota
- Brute-force login credentials

**Fix:**
```bash
npm install express-rate-limit
```
```js
const rateLimit = require('express-rate-limit');

const otpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,  // 15 min
  max: 5,
  message: { error: 'Too many OTP requests. Please try again in 15 minutes.' }
});

const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10 });

router.post('/otp', otpLimiter, async (req, res) => { ... });
router.post('/login', loginLimiter, async (req, res) => { ... });
```

---

### 6. OTP Stored as Plain Text (schools.js, students.js)
```js
const otp = Math.floor(100000 + Math.random() * 900000).toString();
// Stored directly in DB — readable by any DB admin or via SQL injection
await pool.query(`INSERT INTO email_verifications (email, otp_code, ...) VALUES ($1, $2, ...)`, [email, otp]);
```

**Fix — hash OTP before storage:**
```js
const bcrypt = require('bcrypt');
const otpHash = await bcrypt.hash(otp, 10);
// Store otpHash; compare at verification with bcrypt.compare()
```

---

### 7. Crypto-Weak OTP Generation (schools.js, students.js)
`Math.random()` is not cryptographically secure.

**Fix:**
```js
const crypto = require('crypto');
const otp = (crypto.randomInt(100000, 999999)).toString();
```

---

### 8. Inconsistent Subscription Check Logic (schools.js vs subscriptions.js)
`schools.js` has its own inline `checkSubscription` middleware that reads from `schools.payment_status`, while `students.js` imports `checkSubscription` from `../middleware/checkSubscription`. These may check different data sources, causing inconsistent subscription enforcement.

**Fix:** Consolidate into a single shared middleware in `/middleware/checkSubscription.js` and use it everywhere.

---

### 9. Missing Input Validation on Score Routes (scores.js)
CA scores are described as 0–10 and exam scores as 0–60 in the comments, but no server-side validation enforces these bounds:

```js
// No validation — a teacher could submit ca1: 999
```

**Fix — add range validation:**
```js
const { ca1, ca2, ca3, ca4, exam } = req.body;
if ([ca1, ca2, ca3, ca4].some(v => v !== undefined && (v < 0 || v > 10))) {
  return res.status(400).json({ error: 'CA scores must be between 0 and 10' });
}
if (exam !== undefined && (exam < 0 || exam > 60)) {
  return res.status(400).json({ error: 'Exam score must be between 0 and 60' });
}
```

---

### 10. No File Type Verification Beyond MIME (preferences.js)
`preferences.js` checks `mimetype` (easily spoofed by a client), but does not inspect the actual file magic bytes to confirm the upload is truly an image.

**Fix:**
```bash
npm install file-type
```
```js
const { fileTypeFromBuffer } = require('file-type');
const detected = await fileTypeFromBuffer(logoFile.buffer);
if (!detected || !['image/png', 'image/jpeg', 'image/webp'].includes(detected.mime)) {
  return res.status(400).json({ error: 'Invalid file. Upload a real PNG, JPEG, or WebP image.' });
}
```

---

## 🟡 MEDIUM — Scalability & Reliability

### 11. No Database Connection Pooling Health Check
Your `pool` is shared across all files, but there's no error boundary or reconnect strategy visible. Under heavy load, exhausted connections will cause all routes to hang.

**Recommendation:** Configure `pg` pool limits explicitly and add a health check endpoint:
```js
// db.js
const pool = new Pool({
  max: 20,               // max connections in pool
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => {
  console.error('Unexpected pool error:', err);
});
```

---

### 12. N+1 Query Pattern in classes.js (initialize-from-templates)
Each class template is inserted in a separate query inside a loop:

```js
for (const template of templates.rows) {
  await client.query(`INSERT INTO classes ...`, [...]);
}
```

With 40+ class templates, this is 40 sequential round-trips to Postgres.

**Fix — bulk insert:**
```js
const values = templates.rows.map((t, i) => `($1, $${i*2+2}, $${i*2+3})`).join(',');
const params = [schoolId, ...templates.rows.flatMap(t => [t.display_name, t.capacity || 50])];
await client.query(
  `INSERT INTO classes (school_id, class_name, capacity) VALUES ${values} ON CONFLICT DO NOTHING RETURNING *`,
  params
);
```

---

### 13. `reports.js` Downloads Images at Request Time (Scalability Risk)
```js
// reports.js
const response = await axios.get(trimmedSource, {
  responseType: 'arraybuffer',
  timeout: 5000
});
```

For a school generating 200 student reports simultaneously, this causes 200 concurrent HTTP fetches of the same logo/stamp. The 5-second timeout means slow Vercel Blob responses will block all report generation.

**Fix:** Cache images in memory (or Redis) keyed by URL after first fetch:
```js
const imageCache = new Map();

async function fetchImageCached(url) {
  if (imageCache.has(url)) return imageCache.get(url);
  const res = await axios.get(url, { responseType: 'arraybuffer', timeout: 8000 });
  const buf = Buffer.from(res.data, 'binary');
  imageCache.set(url, buf);  // Simple in-memory cache
  return buf;
}
```

---

### 14. Missing `await` Error Handling in Webhook (subscriptions.js)
The webhook handler does not use a database transaction. If the `INSERT INTO school_subscriptions` succeeds but a subsequent step fails, the subscription state could be inconsistent.

**Fix:** Wrap the webhook DB logic in `BEGIN / COMMIT / ROLLBACK` as done in `classes.js`.

---

### 15. Flutterwave Config Validated at Module Load — Will Crash on Cold Start If Keys Missing (subscriptions.js)
```js
// subscriptions.js
if (process.env.NODE_ENV === 'production') {
  throw new Error('Flutterwave configuration incomplete');
}
```

This throws during module import, crashing the whole Express server, not just the subscription routes.

**Fix:** Log a warning instead of throwing, or move validation to a startup health check route, and use graceful degradation per-route.

---

### 16. `savePaymentTransaction` Silently Fails (payments.js)
```js
// Don't fail if we can't save audit log - subscription should still activate
return null;
```

While the intention is defensible, silent failures in audit logging mean you have **no record of successful payments** if the DB is under strain. At minimum, emit a structured error log that can be alerted on.

---

## 🔵 LOW — Code Quality & Maintainability

### 17. Duplicate Flutterwave Boilerplate (payments.js vs subscriptions.js)
`verifyFlutterwaveTransaction`, `calculateEndDate`, `isTransactionProcessed`, and `FLUTTERWAVE_BASE_URL` are all defined in both files independently.

**Fix:** Extract to `/utils/flutterwave.js` and import from both routes.

---

### 18. `bcrypt` vs `bcryptjs` Mismatch (schools.js vs auth.js)
`schools.js` imports `bcrypt` (native C++ bindings); `auth.js` imports `bcryptjs` (pure JS). These are compatible for hashing but inconsistent.

**Fix:** Pick one — `bcryptjs` is recommended for Vercel/serverless environments due to native binding issues. Update `schools.js` to use `bcryptjs`.

---

### 19. `subjects.js` Imports Unused Modules
```js
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
```
None of these are used in `subjects.js`. Remove them to reduce cold-start time and bundle size.

---

### 20. No Pagination on List Endpoints (students.js, scores.js)
Routes returning student lists or score sheets have no `LIMIT`/`OFFSET` or cursor-based pagination. A school with 2,000 students will return all rows in a single response, causing memory pressure and slow API responses.

**Fix — add pagination:**
```js
const page = parseInt(req.query.page) || 1;
const limit = Math.min(parseInt(req.query.limit) || 50, 200);
const offset = (page - 1) * limit;
// Add LIMIT $n OFFSET $m to queries
```

---

## Summary Table

| # | Issue | Severity | File(s) |
|---|-------|----------|---------|
| 1 | Hardcoded email credentials | 🔴 Critical | schools.js, students.js, reports.js |
| 2 | Undefined `effectiveCountryId` variable | 🔴 Critical | classes.js |
| 3 | Broken `from` field in email | 🔴 Critical | schools.js |
| 4 | No payment amount verification | 🔴 Critical | payments.js, subscriptions.js |
| 5 | No rate limiting on OTP/login | 🟠 High | schools.js, students.js |
| 6 | OTP stored as plain text | 🟠 High | schools.js, students.js |
| 7 | Weak OTP generation (Math.random) | 🟠 High | schools.js, students.js |
| 8 | Inconsistent subscription middleware | 🟠 High | schools.js, students.js |
| 9 | No score range validation | 🟠 High | scores.js |
| 10 | File type not verified by magic bytes | 🟠 High | preferences.js |
| 11 | No DB pool health/config limits | 🟡 Medium | db.js (implied) |
| 12 | N+1 queries in class initialization | 🟡 Medium | classes.js |
| 13 | Logo images fetched per-request | 🟡 Medium | reports.js |
| 14 | Webhook DB logic not transactional | 🟡 Medium | subscriptions.js |
| 15 | Flutterwave config throws on cold start | 🟡 Medium | subscriptions.js |
| 16 | Audit log failures are fully silent | 🟡 Medium | payments.js |
| 17 | Duplicate Flutterwave utilities | 🔵 Low | payments.js, subscriptions.js |
| 18 | bcrypt vs bcryptjs mismatch | 🔵 Low | schools.js, auth.js |
| 19 | Unused imports in subjects.js | 🔵 Low | subjects.js |
| 20 | No pagination on list endpoints | 🔵 Low | students.js, scores.js |

---

## Recommended Fix Priority

**Week 1 (Before any live users):**
- Items 1, 2, 3, 4 — prevent data loss, crashes, and fraud

**Week 2 (Before marketing/launch):**
- Items 5, 6, 7, 9, 10 — security hardening

**Week 3 (Scalability sprint):**
- Items 11, 12, 13, 20 — performance at scale

**Ongoing:**
- Items 14–19 — code quality and maintainability

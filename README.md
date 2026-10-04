# Backend additions: superadmin API

Drop these into the Sabino Edu Express backend (same folder layout):

```
routes/superadmin/index.js
routes/superadmin/db.js
routes/superadmin/middleware.js
scripts/create-superadmin.js
```

## 1. Mount it
In your server entry file, next to the other routes:

```js
app.set('trust proxy', 1); // needed behind Vercel/Render/Nginx, otherwise every request shares one IP
app.use('/api/superadmin', require('./routes/superadmin'));
```
Allow the console's origin in your CORS config (e.g. `http://localhost:5174` and your deployed console URL).

## 2. Add one env var
```
SUPERADMIN_JWT_SECRET=<long random string, different from JWT_SECRET>
```
Generate one: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`

## 3. Create the first owner
```
node scripts/create-superadmin.js you@example.com "Your Name"
```
It prints a one-time password. You'll be asked to change it at first sign-in.
Tables (`superadmins`, `superadmin_audit_logs`) are created automatically on first request.

## Roles
| Role   | Can do |
|--------|--------|
| owner  | everything, including adding/deactivating admins |
| admin  | schools, payment status, students, audit log |
| viewer | read-only: schools, students, overview |

## Notes
- Superadmin tokens use their own secret and `type: 'superadmin'`, so they are useless on school/student routes and vice versa. Deactivating an admin takes effect on their very next request.
- Payment-status changes need a reason and write their audit entry in the same transaction as the update.
- Manual statuses can be overwritten later by your payment webhooks (Flutterwave / RevenueCat) and by `routes/cron.js` expiring lapsed schools. That is expected.
- The old `routes/admin..js` (shared `x-admin-secret`) still works and leaves no audit trail. Once you're on this console, remove it.
- School deletion is intentionally not included (it cascades through every table). Add it as owner-only with a typed confirmation if you need it.

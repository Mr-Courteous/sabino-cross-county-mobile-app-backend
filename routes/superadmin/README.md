# Superadmin API (drop-in)

New files only: `routes/superadmin/` and `scripts/create-superadmin.js`.
No existing file of yours is modified. No new npm packages: it uses express, pg, bcryptjs,
jsonwebtoken, express-rate-limit and axios, which your backend already uses.

## First install
1. In your server entry file, next to your other routes, add:

       app.set('trust proxy', 1);   // only if not already set and you're behind a proxy
       app.use('/api/superadmin', require('./routes/superadmin'));

   and allow the console's URL in your CORS config.
2. Add to your env (different from JWT_SECRET):

       SUPERADMIN_JWT_SECRET=<long random string>

3. Create the first owner:

       node scripts/create-superadmin.js you@example.com "Your Name"

## Updating from an earlier version of this folder
Unzip over your backend and choose Replace for the files in `routes/superadmin/`
(they are all ours; do NOT choose Skip). Then redeploy/restart the backend.
Your server entry line stays as it is.

## Payment status rules
- completed: expiry is the date the admin chooses (must be in the future).
- grace_period: always exactly 3 days from the moment it is set (enforced here, not in the console).
- expired: expiry kept for reference. pending: expiry cleared.

## What the tables and trigger are
Created automatically on first request:
- `superadmins`, `superadmin_audit_logs`: admins and the append-only audit trail.
- `school_status_history` plus a trigger `sa_school_status_history` on `schools`:
  records every payment_status change (Flutterwave, store webhooks, cron, this console).
  It only inserts into our table and swallows its own errors, so it can never block a school update.

## Notifications
`/api/superadmin/notifications` replaces `routes/adminNotifications.js` (shared secret) with
logged-in owners/admins, a recipient count before sending, and an audit entry per send.

## Removing it all
Delete these files and the one `app.use` line, then:

    DROP TRIGGER IF EXISTS sa_school_status_history ON schools;
    DROP FUNCTION IF EXISTS sa_log_school_status();
    DROP TABLE IF EXISTS school_status_history, superadmin_audit_logs, superadmins;

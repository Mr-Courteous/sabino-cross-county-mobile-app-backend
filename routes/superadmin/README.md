# Superadmin API (drop-in)

Everything lives in new files: `routes/superadmin/` and `scripts/create-superadmin.js`.
No existing file is modified or overwritten. No new npm packages are needed
(it uses express, pg, bcryptjs, jsonwebtoken and express-rate-limit, which you already use).

## Finish in 3 steps
1. In your server entry file (where your other `app.use('/api/...')` lines are), add:

       app.set('trust proxy', 1);   // only if not already set and you're behind a proxy
       app.use('/api/superadmin', require('./routes/superadmin'));

   and allow the console's URL in your CORS config.

2. Add to your env (.env.local / hosting dashboard), different from JWT_SECRET:

       SUPERADMIN_JWT_SECRET=<long random string>

   Generate one: node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"

3. Create the first owner:

       node scripts/create-superadmin.js you@example.com "Your Name"

Tables (`superadmins`, `superadmin_audit_logs`) are created automatically on first request.
To remove everything later: delete these files, the one `app.use` line, and drop those two tables.

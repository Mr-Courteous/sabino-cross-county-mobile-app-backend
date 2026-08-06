# Staff Onboarding + Admin Hierarchy — what changed

Phase 1 of 3 (Part 3 of the docx: Staff Onboarding, plus the owner/admin
hierarchy you described). Teacher AI and Attendance are separate follow-up
phases — they depend on staff accounts existing, which is what this phase adds.

## New folder: `routes/staff-onboarding/`

- **`db.js`** — creates 3 new tables the first time any route in this module
  runs (`staff`, `staff_invite_codes`, `staff_audit_logs`), same
  "CREATE TABLE IF NOT EXISTS" pattern your `student_push_tokens` table uses.
  No separate migration step needed.
- **`auth.js`** → mounted at **`/api/staff-auth`**
  - `POST /login` — admin login
  - `GET /me` — identity check (works for owner or admin tokens)
  - `POST /change-password` — self-service change, also used for the forced
    "change your temp password" step on first login
  - `POST /forgot-password`, `POST /verify-otp`, `POST /reset-password` —
    same 3-step OTP flow as students, reusing the existing
    `email_verifications` table
  - `POST /redeem-code` — self-registration: someone with an invite code
    sets their own password and the account goes live
- **`management.js`** → mounted at **`/api/staff`** (all routes require login)
  - `GET /admins` — list admins + pending invites for the school
  - `GET /admins/:staffId`
  - `POST /admins` — Path A: owner (or an existing admin) creates an admin
    directly; a temp password is generated, emailed, and must be changed on
    first login
  - `POST /admins/invite` — Path B: generates an 8-character invite code,
    emailed to the invitee, redeemed via `/api/staff-auth/redeem-code`
  - `DELETE /admins/invite/:inviteId` — revoke a pending invite
  - `PATCH /admins/:staffId/deactivate` / `.../reactivate` — **owner only**
  - `DELETE /admins/:staffId` — **owner only**
  - `GET /audit-log` — who did what, when

## The hierarchy, mechanically

Admin tokens are shaped exactly like owner tokens (`type: 'school'`,
same `schoolId`), just with `role: 'admin'` and a `staffId` added. That means
**every existing route protected by `requireSchool` already works for
admins with zero changes** — which is what "no role-based restriction for
now, just another admin" needed.

The one new middleware, `authMiddleware.requireOwner` (in `middleware/auth.js`),
blocks any token with `role: 'admin'`. I added it to the delete routes:

- `routes/schools.js` → `DELETE /:schoolId`
- `routes/students.js` → both `DELETE /:studentId` routes, `DELETE /enrollments/:enrollmentId`, `DELETE /:studentId/enrollment`
- `routes/scores.js` → `DELETE /:scoreId` (this one had **no auth middleware
  at all** before — `req.user` was never set, so it always 401'd. Fixed as
  part of hardening, and locked to owner-only.)
- `routes/staff-onboarding/management.js` → deactivate/reactivate/delete an admin

I left `routes/reports.js` → `DELETE /remark/:enrollmentId` alone — that just
clears a cached AI remark for regeneration, not school/student data.

Also added `role: 'owner'` to the school owner's own login token
(`routes/auth.js`) so both account types carry the field consistently.

## No new dependencies

Everything reuses packages already in your `package.json`: `bcryptjs`,
`jsonwebtoken`, `nodemailer`, `express-rate-limit`. No new env vars either —
reuses `JWT_SECRET`, `EMAIL_USER`, `EMAIL_APP_PASSWORD`.

## What I couldn't verify

The zip didn't include `database/db.js` or `package.json`, so I could only
`node --check` (syntax) each file, not actually boot the server against your
Postgres instance. Worth a smoke test on your end before deploying —
especially `POST /api/staff/admins` (owner creates admin) and
`POST /api/staff-auth/redeem-code` (invite flow) end to end.

## Not in this phase

Teacher AI (lesson plans/notes/scheme of work + AI chat) and Attendance
(coverage grants, access requests) — say the word when you're ready for
either and I'll build it in `routes/teacher-ai/` and `routes/attendance/`
the same way, reusing the `staff` table and auth this phase just added.

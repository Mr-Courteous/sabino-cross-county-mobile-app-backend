# Flexible academic structure & results — what changed and how to deploy

## Deploy order (important)
1. **Back up the database.**
2. `node scripts/run-flexible-assessment-migration.js` (idempotent; PostgreSQL 13+).
3. Mount the two new routers in your server entry file (it wasn't in the zip):
   ```js
   app.use('/api/assessment',         require('./routes/assessment'));
   app.use('/api/academic-structure', require('./routes/academic-structure'));
   ```
4. Deploy the backend, then the app.
   (Run the migration BEFORE the new backend: `scores.js` now selects the new columns.)

## What a school can now do
| Request | Where |
|---|---|
| Add / rename / archive classes | `POST/PUT/DELETE /api/classes/school` · app: **Academic Setup → Classes** |
| Class arms (JSS1 A, B …) | `/api/academic-structure/arms` · **Academic Setup → Arms** |
| Teacher ↔ subject ↔ class/arm assignments | `/api/academic-structure/assignments` · **Academic Setup → Teachers** |
| Their own subjects | `/api/subjects/school` · **Academic Setup → Subjects** |
| Any columns (CA1, CA2, Exam, MIN, comments…), any max marks (10/10/80, 20/20/60…), numeric or text, reorder/rename/remove | `/api/assessment/config` · **Result Template** |
| Own grading scale | same screen |
| Calculations, grading, PDFs follow the school's config | scores / reports routes |

## How "existing code keeps working" is guaranteed
* A school that never touches **Result Template** has **no config row** → the original code path runs
  (CA1–CA4 /10, Exam /60, A–F at 70/60/50/40/30). Verified by tests.
* `scores.total_score` stops being a GENERATED column and is kept by a trigger. Old rows compute the
  same total as before; every existing query that reads `total_score` is unchanged.
* **Changing the template never changes existing report cards.** Each score row stores a frozen copy
  of the template + grading scale it was saved under (`template_snapshot`, `grading_snapshot`).
  A record adopts the new template only when someone actually changes one of its values, or when the
  school explicitly taps **Apply template…** (scoped by session/term, with confirmation).
  Re-saving unchanged values (e.g. "Save All" on a sheet) does **not** re-stamp records.
* Report PDFs: built-in schools keep the original hard-coded tables; custom ones use
  `utils/reportTable.js` (dynamic columns, shrink-to-fit headings, page breaks).

## Behaviour notes / decisions you may want to revisit
* **MIN** = the class's lowest total in that subject (computed). Also available: Class Avg, Max, Grade, Remark, Total.
* A record can't be cleared back to blank through the API (same as before: empty = "no change").
* If a class's records were saved under different template versions (partial edits), the report shows
  the newest template's columns **plus** any older columns that still hold data, so nothing disappears.
* `PUT /api/scores/:id` used CA ≤ 20 / Exam ≤ 40 while `POST /record` used CA ≤ 10 / Exam ≤ 60.
  Both now validate against the school's template (built-in: 10/60).
* Teacher assignments are **recorded, not enforced** (score entry is not restricted by them yet) —
  enforcing would change what existing teachers can do.
* Archiving a class instead of deleting it is deliberate: `GET /api/classes/school` re-seeds missing
  template classes, so a hard delete / rename would have been undone. Renames remember the original
  template name (`classes.origin_name`) for the same reason.
* Not changed: `class-summary` / `analytics` score endpoints in `scores.js` and the legacy
  `/bulk-upsert`, `/class-sheet` routes (they reference an `academic_session` column the code elsewhere
  no longer uses and the app doesn't call them). Analytics bands still use 70/60/50 — say if you want these moved too.
* `GET /api/reports/data/class` already averaged `subject_class_average` across the whole school
  (its join has no class filter) — pre-existing, left as is.
* Shared-library uniqueness: the migration drops a single-column UNIQUE(subject_name) on
  `global_subjects` (if present) and replaces it with uniqueness per school scope.
* The `app/` and `components/` folders inside the backend zip are a stale copy of the frontend; only
  `sabino_frontend` was edited.

## Tests (need a Postgres; they were run against PostgreSQL 16)
```
psql -f tests/baseline_schema.sql -f tests/e2e_extra.sql -f database/migrations/2026_10_flexible_assessment.sql <testdb>
PGURL=... node tests/assessment.test.js
GROQ_API_KEY=x DATABASE_URL=... node tests/e2e.test.js     # real routes + real DB
```
`tests/baseline_schema.sql` is a reduced copy of the live schema as the code uses it — compare it with
your real `\d scores`, `\d classes`, `\d enrollments`, `\d global_subjects` before running the migration.
App screens were syntax-checked but **not run on a device** — please smoke-test Score Entry,
Result Template, Academic Setup and the student Grades screen.


---
# Free trial on registration
New schools get **3 days of full access** straight after registration, with no payment step.

How it works: on `POST /api/schools` a brand-new school is created with `payment_status = 'completed'`
and `subscription_expiry = now + 3 days`. `checkSubscription` (every request) and the daily cron
already expire anything past its date, so after 3 days the school becomes `expired` and the app's
existing 402 -> /pricing flow asks it to subscribe. A real purchase (Google Play / Flutterwave) overwrites
status + expiry exactly as before.

Setup
1. `node scripts/run-free-trial-migration.js`  (adds `is_trial`, `trial_started_at`, `trial_ends_at`; safe to repeat)
2. Deploy the backend + the app.
3. Optional env vars on the backend: `TRIAL_DAYS` (default 3, `0` turns the trial off),
   `TRIAL_ONE_PER_PHONE` (`false` allows several trials per phone number; default: one per phone).

Notes
* Existing schools are untouched (a school that is still `pending` keeps going to payment).
* One trial per email (emails are unique) and, by default, per phone number.
* `routes/payments.js`: the three "already active" shortcuts now ignore an **unpaid trial**, so a school
  that pays during its trial is upgraded. (Without this a trial looked like a paid plan.)
* `index.js`: `CLIENT_URL` may hold several comma-separated website addresses (for the web version).
* Optional - give a trial to schools stuck on `pending`:
  `UPDATE schools SET payment_status='completed', subscription_expiry=now()+interval '3 days',
   is_trial=true, trial_started_at=now(), trial_ends_at=now()+interval '3 days' WHERE payment_status='pending';`
  (run only if you really want that).
* Tests: `tests/trial.test.js`.


---
# Parent accounts (one login, many children)
A parent registers once (email OTP), then adds each child with the child's **registration number + the
school-issued parent link code**. All children show on one dashboard (scores, report cards, attendance, profile).

Setup
1. Back up, then `node scripts/run-parent-access-migration.js` (adds `parents`, `parent_students`, student
   `parent_link_code` + guardian columns, `schools.parent_auto_link`; gives every existing student a code;
   a trigger gives new students one automatically). Safe to repeat.
2. Deploy backend (`routes/parents.js` is mounted in `index.js` as `/api/parents`) and the app.
3. Schools: Dashboard -> **Parent Access** shows each student's link code (Share button), lets the school record the
   guardian's email/phone, switch **auto-link by guardian email** on/off, see who is linked, remove access or make
   a new code.

How it is kept safe
* A parent token is its own type; the shared `authenticateToken` rejects it, so it cannot reach any school or student route.
* To look at a child the app asks for a **child token** (a normal student token carrying `viaParent`, valid 1 hour).
  Every existing student endpoint then works unchanged and only returns that child. `middleware/auth.js` makes
  `viaParent` tokens **read-only** (only e-mailing a report card is allowed).
* Linking needs registration number AND code (15 attempts/hour per parent). A wrong code and an unknown student give the same message.
* Auto-link by email is OFF until a school turns it on. A link the school/parent removed is kept as `revoked` and is not
  re-created by auto-link. Regenerating a code kills the old one.
* If one child's school subscription lapses, only that child is locked (402); the other children still show.
* Parents never see school pricing/payment screens.

Notes
* Parent sessions last 1 hour (same as students), then log in again.
* Report cards: web = Download PDF + e-mail; phone app = e-mail to the parent's address (same as the student screen does).
* Not changed: students' own logins, school/teacher logins.
* Tests: `tests/parents.test.js` (register/OTP, linking, isolation between parents, read-only, expiry, school controls).


---
# Paying during the free trial
A school can subscribe at ANY point of its 3-day trial; it does not have to wait.

* Dashboard (owner/admin): a banner shows **"Free trial - N days left - SUBSCRIBE"** (turns red on the last day).
  It opens the pricing screen, which now says "Subscribe Now / Free trial - N days left" and has a
  "Continue my free trial" link. Phone: Google Play (RevenueCat); web / institutional: Flutterwave billing portal.
* The paid plan starts the moment payment is confirmed (Flutterwave: 4 months from that day). The unused part of the
  trial is NOT added on top - tell me if you'd rather add it (easy for Flutterwave; Google Play sets its own dates).
* `GET /api/schools/subscription-info` -> `{ status, expiresAt, daysLeft, hoursLeft, isTrial }` (works for expired schools too).
* `routes/payments.js` (done earlier): the "already active" shortcuts ignore an UNPAID trial, so the payment is never skipped.
  Confirming the same payment twice does not extend the plan twice.
* Tests: `tests/pay-during-trial.test.js` (Flutterwave mocked) and `tests/trial.test.js`.


---
# Editing staff details (owner only)
`PATCH /api/staff/admins/:staffId`  body `{ fullName?, email?, phone? }` (phone `""` clears it).
App: Dashboard -> Manage Staff -> the pencil on a staff card -> **Edit Staff Details**.

* **Owner:** can edit any staff account, including changing a role (admin <-> class teacher; applies from
  their next login, and an admin has no class). **Full admin:** can edit class teachers (name, email, phone,
  class) but not other admins and not roles. Class teachers cannot edit anyone.
* The email is the staff member's login, so:
  - it cannot clash with another staff account, any school owner account, or a pending invite;
  - **never logged in yet** -> their temporary password went to the old address, so a NEW temporary password is
    created and e-mailed to the new address (also shown once to the owner in case the mail doesn't arrive);
  - **already using the account** -> password unchanged; both the old and the new address get a notice.
* Every edit is recorded in the staff audit log ("edited a staff member's details").
* Not covered: pending *invites* (revoke and re-invite to change those). Staff already logged in keep their current
  session until it expires; the new email applies from their next login.
* Test: `tests/staff-edit.test.js`.


---
# Subscription entry + no duplicate emails
**Where schools pay now:** the payment page no longer appears on its own. Dashboard -> **Subscription**
(owner only) shows "Free trial - N days left - tap to pay" / "Active until <date>" / "Expired - tap to renew".
Tapping it opens the pricing screen only when there is something to pay for (trial or expired). A paid, active plan
just shows its end date, because the backend does not apply a second payment while a paid plan is still running.
The plan is always exactly 4 months from the payment date; unused trial days are NOT added.
(After the trial the usual "expired -> pricing" redirect still applies.)

**One login email = one account, enforced by the database:**
1. `node scripts/run-unique-emails-migration.js` (repeatable; also installs itself when the staff tables are created)
2. staff vs staff: unique index on `LOWER(email)` (any letter case); staff vs school owner: triggers in both directions.
   Pending-invite and school checks also exist in the API for friendly messages.
3. If old data already has case-only duplicate staff emails the index is skipped with a notice (nothing is deleted);
   the triggers still block every new or changed email. Fix those rows, then run the script again.
4. Parent accounts are a separate login area and are not included (one person can be a teacher and a parent).

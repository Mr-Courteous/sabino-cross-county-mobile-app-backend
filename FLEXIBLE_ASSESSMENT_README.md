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

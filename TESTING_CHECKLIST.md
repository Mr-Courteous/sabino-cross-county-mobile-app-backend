# Pre-Prod Testing Checklist — Admin Hierarchy + Payment Fix

Goal: confirm (1) the owner-only flow behaves exactly as before, and
(2) the RevenueCat sync-retry fix actually closes the "stuck on pricing
page" bug — before this goes to prod.

Run this against **staging**, not prod. Where a step says "curl", the
companion `smoke-test.sh` script automates it — see the bottom of this
file.

---

## Part 1 — Owner flow regression (should be 100% unchanged)

These are things that worked before and must keep working exactly the
same way. If any of these behave differently, something in the
hierarchy change leaked into the owner path — stop and flag it.

- [ ] **Existing session survives the deploy.** Before deploying, stay
  logged in on a test device/simulator with a real owner account
  (don't log out). Deploy the server. Without logging out or
  reinstalling, do something that requires auth (open the dashboard,
  view students). It should work — old tokens have no `role` field,
  and `requireOwner` treats that as owner, so nothing should reject
  them.
- [ ] **Fresh owner login** (`POST /api/auth/login`) still returns
  `token` + `user.schoolId/email/name/type/countryId` — the shape
  didn't change (only one new harmless field, `role: "owner"`, was
  added).
- [ ] **Register a brand-new school** end to end (registration →
  complete-registration → payment) exactly like a real user would.
  Confirm the school row is created with `payment_status = 'pending'`
  and updates to `'completed'` after payment (see Part 2).
- [ ] **Owner can still create/edit/view students, scores, subjects,
  classes** — no permission changes were made to any read/write route,
  only to deletes.
- [ ] **Owner can still delete a student** (`DELETE /api/students/:id`)
  — should succeed exactly as before.
- [ ] **Owner can still delete an enrollment**
  (`DELETE /api/students/enrollments/:id`) — should succeed.
- [ ] **Owner can still delete a score** (`DELETE /api/scores/:scoreId`)
  — **this one used to be silently broken** (no auth middleware at
  all, always 401'd). It should now actually work for the owner. If it
  doesn't, that's a real bug to fix before shipping — not a
  regression, but worth catching now rather than after deploy.
- [ ] **Owner can still delete their school account**
  (`DELETE /api/schools/:schoolId`, the "delete my account" flow) —
  should succeed exactly as before.

## Part 2 — Payment fix verification

### 2a. Google Play (RevenueCat) — the actual bug being fixed

- [ ] Use a **fresh Google test account** (Play Console → License
  Testing) that has never purchased before — this is the scenario most
  likely to hit the eventual-consistency race.
- [ ] Go through registration → payment on a real device/emulator with
  Play Store signed in as the test account.
- [ ] Complete the purchase. Watch the app: it should show
  "Confirming your payment..." (possibly counting up "(2/4)",
  "(3/4)") instead of immediately erroring out.
- [ ] Confirm it lands on the dashboard, not back on the pricing
  screen.
- [ ] In the DB, confirm `schools.payment_status = 'completed'` and
  `subscription_expiry` is set for that school.
- [ ] Check the server logs for `[RC Sync]` lines — you should see
  `attempt 1/4`, and ideally it resolves within 1–2 attempts. If it's
  regularly needing all 4 attempts, RevenueCat propagation is slower
  than expected and the retry count/delay might need tuning.
- [ ] **Regression check:** repeat with an account that already has an
  active subscription (renewal path via `/pricing`, not
  `/complete-registration`) — same expectation, lands on dashboard,
  no stuck loop.
- [ ] **Restore path:** on a device where the purchase already exists
  in RevenueCat, tap "Restore Purchases" and confirm it still works
  and also benefits from the retry logic.

### 2b. Flutterwave (untouched, but confirm no accidental breakage)

- [ ] Go through registration → choose Flutterwave → complete a test
  payment (Flutterwave test cards) → confirm redirect back to the app
  activates the subscription (`payment_status = 'completed'`).
- [ ] Confirm the Flutterwave webhook still fires and is idempotent
  (check server logs for the webhook hit — shouldn't double-charge or
  error on a second delivery).

## Part 3 — New admin hierarchy, server-side only (no client UI yet)

You said not to build the client screens yet, but the API is live, so
it's worth confirming it behaves correctly in isolation — it just
shouldn't be reachable from the app until the UI exists.

- [ ] `POST /api/staff/admins` (as the owner) creates an admin, emails
  temp credentials, returns `temporaryPassword` once in the response.
- [ ] `POST /api/staff-auth/login` with those credentials succeeds and
  returns `forcePasswordChange: true`.
- [ ] As that admin, try `DELETE /api/students/:id` → expect **403**
  with `code: "OWNER_ONLY"`.
- [ ] As that admin, try a normal write (e.g. create a student) →
  expect it to **succeed** (no role restriction on non-delete actions,
  by design).
- [ ] As the owner, `DELETE /api/staff/admins/:staffId` removes the
  test admin cleanly. Confirm they can no longer log in afterward.
- [ ] Confirm none of this is reachable from the mobile app UI yet
  (expected — that's the deferred work).

---

## `smoke-test.sh`

A curl-based script that automates the repeatable parts of Part 1 and
Part 3 against a given `BASE_URL`. It logs in as an existing owner,
hits a lightweight authenticated GET, exercises the score-delete fix
against a disposable/nonexistent ID (safe — just checks the auth gate,
not real data loss), then walks through the admin-hierarchy checks
end-to-end using a throwaway test admin it creates and deletes itself.

Usage:
```bash
chmod +x smoke-test.sh
BASE_URL="https://staging.api.yoursite.com" \
OWNER_EMAIL="owner@test.com" \
OWNER_PASSWORD="yourpassword" \
./smoke-test.sh
```

It does **not** touch real student/score data — the delete calls it
makes are against IDs that don't exist (or against a disposable admin
it created itself), specifically to test the auth gate without risking
anything real. Read it before running against anything other than
staging.

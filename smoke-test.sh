#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# smoke-test.sh
#
# Curl-based smoke test for:
#   1. Owner login + a lightweight authenticated read (regression)
#   2. The scores.js delete route's auth gate (used to always 401 —
#      confirms it now recognizes a valid owner token)
#   3. The new admin hierarchy, end to end, using a disposable test
#      admin this script creates and deletes itself
#
# Does NOT touch real student/score/school data.
#
# Usage:
#   BASE_URL="https://staging.api.yoursite.com" \
#   OWNER_EMAIL="owner@test.com" \
#   OWNER_PASSWORD="yourpassword" \
#   ./smoke-test.sh
# ─────────────────────────────────────────────────────────────
set -uo pipefail

BASE_URL="${BASE_URL:?Set BASE_URL, e.g. https://staging.api.yoursite.com}"
OWNER_EMAIL="${OWNER_EMAIL:?Set OWNER_EMAIL}"
OWNER_PASSWORD="${OWNER_PASSWORD:?Set OWNER_PASSWORD}"

PASS=0
FAIL=0

pass() { echo "  ✅ $1"; PASS=$((PASS+1)); }
fail() { echo "  ❌ $1"; FAIL=$((FAIL+1)); }

json_get() { # json_get <json> <key>
  echo "$1" | grep -o "\"$2\"[[:space:]]*:[[:space:]]*\"[^\"]*\"" | head -1 | sed -E "s/.*: *\"([^\"]*)\"/\1/"
}
http_code() { echo "$1" | tail -1; }
http_body() { echo "$1" | sed '$d'; }

curl_json() { # curl_json METHOD path token(optional) data(optional)
  local method="$1" path="$2" token="${3:-}" data="${4:-}"
  local args=(-s -w '\n%{http_code}' -X "$method" "${BASE_URL}${path}" -H 'Content-Type: application/json')
  [ -n "$token" ] && args+=(-H "Authorization: Bearer ${token}")
  [ -n "$data" ] && args+=(-d "$data")
  curl "${args[@]}"
}

echo "═══════════════════════════════════════════════════════"
echo "1) Owner login (regression)"
echo "═══════════════════════════════════════════════════════"
resp=$(curl_json POST /api/auth/login "" "{\"email\":\"${OWNER_EMAIL}\",\"password\":\"${OWNER_PASSWORD}\"}")
code=$(http_code "$resp"); body=$(http_body "$resp")
OWNER_TOKEN=$(json_get "$body" token)

if [ "$code" = "200" ] && [ -n "$OWNER_TOKEN" ]; then
  pass "Owner login succeeded (200), token received"
else
  fail "Owner login failed (HTTP $code): $body"
  echo "Cannot continue without a valid owner token. Exiting."
  exit 1
fi

echo
echo "═══════════════════════════════════════════════════════"
echo "2) Authenticated read as owner (GET /api/schools)"
echo "═══════════════════════════════════════════════════════"
resp=$(curl_json GET /api/schools "$OWNER_TOKEN")
code=$(http_code "$resp")
[ "$code" = "200" ] && pass "Owner profile read succeeded (200)" || fail "Owner profile read failed (HTTP $code)"

echo
echo "═══════════════════════════════════════════════════════"
echo "3) Scores delete auth gate (was broken before the fix —"
echo "   used to 401 for everyone, including the owner)"
echo "═══════════════════════════════════════════════════════"
resp=$(curl_json DELETE /api/scores/999999999 "$OWNER_TOKEN")
code=$(http_code "$resp")
# We expect 404 (not found — correctly authenticated, ID doesn't exist)
# NOT 401 (would mean the auth gate is still broken)
if [ "$code" = "404" ]; then
  pass "Owner reaches the handler and gets a clean 404 for a nonexistent score (auth gate is fixed)"
elif [ "$code" = "401" ]; then
  fail "Still getting 401 — the auth middleware fix didn't take (HTTP $code)"
else
  echo "  ⚠️  Unexpected status $code — inspect manually: $(http_body "$resp")"
fi

echo
echo "═══════════════════════════════════════════════════════"
echo "4) Admin hierarchy — create, login, permission check, cleanup"
echo "═══════════════════════════════════════════════════════"
TEST_EMAIL="smoketest.admin.$(date +%s)@example.invalid"
resp=$(curl_json POST /api/staff/admins "$OWNER_TOKEN" "{\"fullName\":\"Smoke Test Admin\",\"email\":\"${TEST_EMAIL}\"}")
code=$(http_code "$resp"); body=$(http_body "$resp")
STAFF_ID=$(json_get "$body" id)
TEMP_PASSWORD=$(json_get "$body" temporaryPassword)

if [ "$code" = "201" ] && [ -n "$TEMP_PASSWORD" ]; then
  pass "Created disposable test admin ($TEST_EMAIL)"
else
  fail "Could not create test admin (HTTP $code): $body"
  echo "Skipping remaining admin-hierarchy checks."
  echo
  echo "═══════════════════════════════════════════════════════"
  echo "SUMMARY: $PASS passed, $FAIL failed"
  echo "═══════════════════════════════════════════════════════"
  exit 1
fi

resp=$(curl_json POST /api/staff-auth/login "" "{\"email\":\"${TEST_EMAIL}\",\"password\":\"${TEMP_PASSWORD}\"}")
code=$(http_code "$resp"); body=$(http_body "$resp")
ADMIN_TOKEN=$(json_get "$body" token)
FORCE_CHANGE=$(echo "$body" | grep -o '"forcePasswordChange"[[:space:]]*:[[:space:]]*true')

if [ "$code" = "200" ] && [ -n "$ADMIN_TOKEN" ]; then
  pass "Test admin can log in with temp credentials"
else
  fail "Test admin login failed (HTTP $code): $body"
fi

if [ -n "$FORCE_CHANGE" ]; then
  pass "forcePasswordChange: true is correctly returned"
else
  fail "Expected forcePasswordChange: true in the login response"
fi

if [ -n "$ADMIN_TOKEN" ]; then
  resp=$(curl_json DELETE /api/students/999999999 "$ADMIN_TOKEN")
  code=$(http_code "$resp")
  if [ "$code" = "403" ]; then
    pass "Admin correctly BLOCKED from deleting (403 OWNER_ONLY)"
  else
    fail "Expected 403 for admin delete attempt, got $code"
  fi
fi

if [ -n "$STAFF_ID" ]; then
  resp=$(curl_json DELETE "/api/staff/admins/${STAFF_ID}" "$OWNER_TOKEN")
  code=$(http_code "$resp")
  [ "$code" = "200" ] && pass "Cleaned up disposable test admin" || fail "Failed to delete test admin (HTTP $code) — clean this up manually: staff id ${STAFF_ID}"
fi

if [ -n "$ADMIN_TOKEN" ]; then
  resp=$(curl_json POST /api/staff-auth/login "" "{\"email\":\"${TEST_EMAIL}\",\"password\":\"${TEMP_PASSWORD}\"}")
  code=$(http_code "$resp")
  [ "$code" != "200" ] && pass "Deleted admin can no longer log in" || fail "Deleted admin can STILL log in — cleanup did not take effect"
fi

echo
echo "═══════════════════════════════════════════════════════"
echo "SUMMARY: $PASS passed, $FAIL failed"
echo "═══════════════════════════════════════════════════════"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1

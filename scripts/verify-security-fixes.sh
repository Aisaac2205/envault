#!/usr/bin/env bash
# ==============================================================================
# EnVault Management: security fixes verification
#
# Black-box checks, against a running stack, for the four fixes from the
# security audit of October 2026:
#   H-01  PROD connections are immutable and nothing is reclassified as PROD
#   H-05  a banned user's session stops working on the very next request
#   H-06  audit_logs cannot be emptied with TRUNCATE
#   H-07  the SPA's Content-Security-Policy is enforced, with no unsafe-inline
#         script source
#
# Run it ONLY against a disposable stack with fictitious data, such as the e2e
# stack (pnpm docker:e2e). It creates connections and a user; the PROD
# connection it creates stays behind, because the API correctly refuses to
# delete it.
#
# Usage:
#   ADMIN_EMAIL=... ADMIN_PASSWORD=... ./scripts/verify-security-fixes.sh
#
# Optional variables (defaults match docker-compose.e2e.yml):
#   API_URL              http://localhost:3000
#   WEB_URL              http://localhost:5173   (also sent as Origin)
#   PROD_DB_HOST         db-test-pg               (as the API reaches it)
#   PROD_DB_PORT         5432
#   PROD_DB_NAME         testdb
#   PROD_DB_USER         test_user
#   PROD_DB_PASSWORD     test_pass123
#   CONTROL_DB_PSQL      command that opens psql on the control database as
#                        the API's own role; H-06 is skipped when it is empty.
#                        e2e example:
#                        "docker compose -p envault-e2e exec -T db psql -U envault -d envault"
#
# Exit code: 0 when every executed check passes, 1 otherwise.
# Requires: bash, curl, node.
# ==============================================================================

set -uo pipefail

API_URL="${API_URL:-http://localhost:3000}"
WEB_URL="${WEB_URL:-http://localhost:5173}"
ADMIN_EMAIL="${ADMIN_EMAIL:?ADMIN_EMAIL is required}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:?ADMIN_PASSWORD is required}"
PROD_DB_HOST="${PROD_DB_HOST:-db-test-pg}"
PROD_DB_PORT="${PROD_DB_PORT:-5432}"
PROD_DB_NAME="${PROD_DB_NAME:-testdb}"
PROD_DB_USER="${PROD_DB_USER:-test_user}"
PROD_DB_PASSWORD="${PROD_DB_PASSWORD:-test_pass123}"
CONTROL_DB_PSQL="${CONTROL_DB_PSQL:-}"

RUN_ID="$(date +%s)"
PASSED=0
FAILED=0
SKIPPED=0

green() { printf '\033[32m%s\033[0m' "$1"; }
red() { printf '\033[31m%s\033[0m' "$1"; }
yellow() { printf '\033[33m%s\033[0m' "$1"; }

# check <id> <description> <expected> <observed>
check() {
  if [[ "$4" == "$3" ]]; then
    PASSED=$((PASSED + 1))
    printf '  %s  %-8s %-58s expected %-5s got %s\n' "$(green PASS)" "$1" "$2" "$3" "$4"
  else
    FAILED=$((FAILED + 1))
    printf '  %s  %-8s %-58s expected %-5s got %s\n' "$(red FAIL)" "$1" "$2" "$3" "$4"
  fi
}

skip() {
  SKIPPED=$((SKIPPED + 1))
  printf '  %s  %-8s %s\n' "$(yellow SKIP)" "$1" "$2"
}

json_field() {
  node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const v=process.argv[1].split(".").reduce((o,k)=>o?.[k],JSON.parse(s));process.stdout.write(v==null?"":String(v))}catch{}})' "$1"
}

# sign_in <email> <password> -> prints a Cookie header value
sign_in() {
  curl -s -D - -o /dev/null -X POST "$API_URL/api/auth/sign-in/email" \
    -H 'Content-Type: application/json' -H "Origin: $WEB_URL" \
    -d "{\"email\":\"$1\",\"password\":\"$2\"}" |
    sed -n 's/^[Ss]et-[Cc]ookie: \([^;]*\);.*/\1/p' | paste -sd ';' -
}

status() { curl -s -o /dev/null -w '%{http_code}' "$@"; }

echo "EnVault security fixes verification"
echo "API: $API_URL   WEB: $WEB_URL   run: $RUN_ID"
echo

ADMIN_COOKIE="$(sign_in "$ADMIN_EMAIL" "$ADMIN_PASSWORD")"
if [[ -z "$ADMIN_COOKIE" ]]; then
  echo "$(red ERROR) could not sign in as $ADMIN_EMAIL"
  exit 1
fi
api() {
  local method="$1" path="$2" body="${3:-}"
  curl -s -w '\n%{http_code}' -X "$method" "$API_URL/api$path" \
    -H 'Content-Type: application/json' -H "Origin: $WEB_URL" \
    -H "Cookie: $ADMIN_COOKIE" ${body:+-d "$body"}
}
connection_body() {
  printf '{"name":"%s","environment":"%s","dbType":"postgres","host":"%s","port":%s,"database":"%s","username":"%s","password":"%s"}' \
    "$1" "$2" "$PROD_DB_HOST" "$PROD_DB_PORT" "$PROD_DB_NAME" "$PROD_DB_USER" "$PROD_DB_PASSWORD"
}

# ------------------------------------------------------------------ H-01
echo "H-01  PROD connections are immutable"
prod_response="$(api POST /connections "$(connection_body "audit-verify-prod-$RUN_ID" prod)")"
PROD_ID="$(echo "$prod_response" | head -n -1 | json_field data.id)"
qa_response="$(api POST /connections "$(connection_body "audit-verify-qa-$RUN_ID" qa)")"
QA_ID="$(echo "$qa_response" | head -n -1 | json_field data.id)"
if [[ -z "$PROD_ID" || -z "$QA_ID" ]]; then
  echo "  $(red ERROR) could not create the test connections"
  exit 1
fi
check H-01a "PATCH host of a PROD connection" 403 "$(api PATCH "/connections/$PROD_ID" '{"host":"10.66.66.66"}' | tail -n 1)"
check H-01b "PATCH environment=qa of a PROD connection" 403 "$(api PATCH "/connections/$PROD_ID" '{"environment":"qa"}' | tail -n 1)"
check H-01c "DELETE a PROD connection" 403 "$(api DELETE "/connections/$PROD_ID" | tail -n 1)"
check H-01d "PATCH environment=prod of a QA connection" 403 "$(api PATCH "/connections/$QA_ID" '{"environment":"prod"}' | tail -n 1)"
check H-01e "PATCH name of a QA connection still works" 200 "$(api PATCH "/connections/$QA_ID" "{\"name\":\"audit-verify-qa-$RUN_ID-renamed\"}" | tail -n 1)"
prod_after="$(api GET "/connections/$PROD_ID" | head -n -1)"
prod_host="$(echo "$prod_after" | json_field data.host)"
check H-01f "PROD connection kept its host" "$PROD_DB_HOST" "${prod_host:-none}"
api DELETE "/connections/$QA_ID" >/dev/null
echo

# ------------------------------------------------------------------ H-05
echo "H-05  a banned user loses access immediately"
USER_EMAIL="audit-verify-$RUN_ID@example.test"
USER_PASSWORD="Verify-$RUN_ID-$(node -e 'process.stdout.write(require("crypto").randomBytes(9).toString("hex"))')"
create_user="$(curl -s -X POST "$API_URL/api/auth/admin/create-user" -H 'Content-Type: application/json' \
  -H "Origin: $WEB_URL" -H "Cookie: $ADMIN_COOKIE" \
  -d "{\"email\":\"$USER_EMAIL\",\"password\":\"$USER_PASSWORD\",\"name\":\"Audit verify\",\"role\":\"user\"}")"
USER_ID="$(echo "$create_user" | json_field user.id)"
if [[ -z "$USER_ID" ]]; then
  skip H-05 "could not create a test user"
else
  USER_COOKIE="$(sign_in "$USER_EMAIL" "$USER_PASSWORD")"
  check H-05a "session works before the ban" 200 "$(status -H "Cookie: $USER_COOKIE" "$API_URL/api/me/permissions")"
  curl -s -o /dev/null -X POST "$API_URL/api/auth/admin/ban-user" -H 'Content-Type: application/json' \
    -H "Origin: $WEB_URL" -H "Cookie: $ADMIN_COOKIE" -d "{\"userId\":\"$USER_ID\",\"banReason\":\"verification\"}"
  check H-05b "same cookie on the next request after the ban" 401 "$(status -H "Cookie: $USER_COOKIE" "$API_URL/api/me/permissions")"
  curl -s -o /dev/null -X POST "$API_URL/api/auth/admin/remove-user" -H 'Content-Type: application/json' \
    -H "Origin: $WEB_URL" -H "Cookie: $ADMIN_COOKIE" -d "{\"userId\":\"$USER_ID\"}"
fi
echo

# ------------------------------------------------------------------ H-06
echo "H-06  audit_logs cannot be truncated"
if [[ -z "$CONTROL_DB_PSQL" ]]; then
  skip H-06 "CONTROL_DB_PSQL is not set"
else
  # Inside a transaction that is always rolled back: a regression never
  # destroys the audit trail of the stack under test.
  truncate_output="$(printf 'BEGIN;\nTRUNCATE audit_logs;\nROLLBACK;\n' | $CONTROL_DB_PSQL -v ON_ERROR_STOP=1 2>&1)"
  if grep -q 'append-only' <<<"$truncate_output"; then observed=blocked; else observed=allowed; fi
  check H-06 "TRUNCATE audit_logs (rolled back)" blocked "$observed"
fi
echo

# ------------------------------------------------------------------ H-07
echo "H-07  Content-Security-Policy is enforced"
headers="$(curl -s -I "$WEB_URL/" | tr -d '\r')"
csp_name="$(grep -io '^content-security-policy[a-z-]*' <<<"$headers" | head -n 1 | tr 'A-Z' 'a-z')"
check H-07a "CSP header name" content-security-policy "${csp_name:-none}"
script_src="$(grep -io '^content-security-policy[a-z-]*:.*' <<<"$headers" | grep -o "script-src [^;]*")"
if grep -q "'unsafe-inline'" <<<"$script_src"; then observed=present; else observed=absent; fi
check H-07b "'unsafe-inline' in script-src" absent "$observed"
echo

echo "Summary: $(green "$PASSED passed"), $( ((FAILED > 0)) && red "$FAILED failed" || echo "0 failed"), $SKIPPED skipped"
echo "Note: when H-01 passes, connection audit-verify-prod-$RUN_ID stays in the stack (PROD connections cannot be deleted)."
((FAILED == 0))

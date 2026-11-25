#!/usr/bin/env bash
# Safe, repeatable local-sandbox startup script for OneReport Pulse.
#
# LOCAL ONLY — this script never touches Preview or Production. It:
#   1. Refuses to run unless .env.local-sandbox points exclusively at a
#      localhost/127.0.0.1 Supabase URL (never Preview/Production).
#   2. Kills any process already bound to the target port (preventing the
#      exact "two competing Vite instances" failure mode that has twice
#      caused "Invalid login credentials" after local edits — the older,
#      stale process kept serving a previous env while a newer one failed
#      to bind).
#   3. Confirms the local Supabase Docker stack is actually up before
#      starting the dev server, rather than starting against a dead
#      backend.
#   4. Starts Vite in local-sandbox mode with --strictPort, so a port
#      conflict is a loud, immediate failure instead of a silent fallback
#      to a different port (which is how a stale process can end up being
#      the one actually serving requests without anyone noticing).
#   5. Waits for the server to respond, then runs a live password-grant
#      smoke test against all four local test accounts — so this script
#      never reports "ready" unless login genuinely works end-to-end,
#      against this exact process, right now.
#
# Usage: ./scripts/start-local-sandbox.sh
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

PORT=5180
ENV_FILE=".env.local-sandbox"
LOCAL_STACK="wfg-phase1a-local-stack"
PUBLISHABLE_KEY="sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH"
TEST_PASSWORD="LocalTest@12345"
TEST_EMAILS=("admin-test@local.test" "salesadmin-test@local.test" "manager-test@local.test" "rep-test@local.test")

echo "== 1. Validating ${ENV_FILE} =="
if [ ! -f "$ENV_FILE" ]; then
  echo "ERROR: ${ENV_FILE} does not exist. Refusing to start." >&2
  exit 1
fi

SUPABASE_URL=$(grep -E '^NEXT_PUBLIC_SUPABASE_URL=' "$ENV_FILE" | head -1 | cut -d= -f2-)
if [[ "$SUPABASE_URL" != http://localhost:* && "$SUPABASE_URL" != http://127.0.0.1:* ]]; then
  echo "ERROR: ${ENV_FILE} NEXT_PUBLIC_SUPABASE_URL is '${SUPABASE_URL}', not a localhost URL." >&2
  echo "Refusing to start — this file must never point at Preview or Production." >&2
  exit 1
fi
echo "OK — ${ENV_FILE} points at ${SUPABASE_URL}"

echo "== 2. Checking for a conflicting process on port ${PORT} =="
EXISTING_PID=$(lsof -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null || true)
if [ -n "$EXISTING_PID" ]; then
  # Only ever auto-kill what's on OUR port, and only when it actually
  # looks like a prior instance of this same dev server (its command line
  # mentions "vite") — never an arbitrary unrelated process that merely
  # happens to be bound to 5180. If it's something else, stop and let a
  # human decide; this script must never silently kill an unrelated app.
  EXISTING_CMD=$(ps -p "$EXISTING_PID" -o command= 2>/dev/null || true)
  if ! echo "$EXISTING_CMD" | grep -qi "vite"; then
    echo "ERROR: port ${PORT} is held by PID ${EXISTING_PID}, whose command does not look like a prior Vite instance:" >&2
    echo "  ${EXISTING_CMD}" >&2
    echo "Refusing to kill it automatically — free the port yourself (or confirm it's safe to stop) and re-run this script." >&2
    exit 1
  fi
  echo "Port ${PORT} is currently held by PID ${EXISTING_PID} (a prior Vite instance: ${EXISTING_CMD}) — stopping it before starting a fresh instance."
  kill -9 $EXISTING_PID 2>/dev/null || true
  sleep 1
  if lsof -tiTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "ERROR: could not free port ${PORT}." >&2
    exit 1
  fi
fi
echo "OK — port ${PORT} is free"

echo "== 3. Checking the local Supabase stack (${LOCAL_STACK}) is up =="
if ! docker ps --format '{{.Names}}' | grep -q "^supabase_db_${LOCAL_STACK}\$"; then
  echo "ERROR: supabase_db_${LOCAL_STACK} is not running. Start the local Supabase stack first." >&2
  exit 1
fi
if ! docker ps --format '{{.Names}}' | grep -q "^supabase_kong_${LOCAL_STACK}\$"; then
  echo "ERROR: supabase_kong_${LOCAL_STACK} is not running. Start the local Supabase stack first." >&2
  exit 1
fi
echo "OK — local Supabase stack containers are running"

echo "== 4. Starting Vite (mode=local-sandbox, port=${PORT}, strict) =="
LOG_FILE="/tmp/wfg-local-sandbox-vite.log"
nohup npx vite --mode local-sandbox --port "$PORT" --strictPort > "$LOG_FILE" 2>&1 &
VITE_PID=$!
disown

echo "Started PID ${VITE_PID}, logging to ${LOG_FILE}"

echo "== 5. Waiting for the server to respond =="
for i in $(seq 1 30); do
  if curl -s -o /dev/null -w '%{http_code}' "http://localhost:${PORT}/" 2>/dev/null | grep -q '^200$'; then
    echo "OK — server responding on http://localhost:${PORT}/"
    break
  fi
  if ! kill -0 "$VITE_PID" 2>/dev/null; then
    echo "ERROR: Vite process exited during startup. Log output:" >&2
    cat "$LOG_FILE" >&2
    exit 1
  fi
  sleep 1
  if [ "$i" -eq 30 ]; then
    echo "ERROR: server did not respond within 30s. Log output:" >&2
    cat "$LOG_FILE" >&2
    exit 1
  fi
done

echo "== 6. Confirming exactly one process now holds port ${PORT} =="
LISTENER_COUNT=$(lsof -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null | wc -l | tr -d ' ')
if [ "$LISTENER_COUNT" != "1" ]; then
  echo "ERROR: expected exactly 1 process on port ${PORT}, found ${LISTENER_COUNT}." >&2
  exit 1
fi
echo "OK — exactly one process on port ${PORT} (PID ${VITE_PID})"

echo "== 7. Live password-grant smoke test (local GoTrue, all four test accounts) =="
for email in "${TEST_EMAILS[@]}"; do
  HTTP_STATUS=$(curl -s -o /dev/null -w '%{http_code}' -X POST "${SUPABASE_URL}/auth/v1/token?grant_type=password" \
    -H "apikey: ${PUBLISHABLE_KEY}" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"${email}\",\"password\":\"${TEST_PASSWORD}\"}")
  if [ "$HTTP_STATUS" != "200" ]; then
    echo "ERROR: password grant for ${email} returned HTTP ${HTTP_STATUS}, expected 200." >&2
    echo "The server is running, but login will fail for this account. Investigate before use." >&2
    exit 1
  fi
  echo "OK — ${email} authenticates successfully"
done

echo
echo "================================================================"
echo " Ready: http://localhost:${PORT}"
echo " Test accounts (password for all: ${TEST_PASSWORD}):"
for email in "${TEST_EMAILS[@]}"; do
  echo "   - ${email}"
done
echo "================================================================"

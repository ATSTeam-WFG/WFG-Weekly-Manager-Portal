#!/usr/bin/env bash
# Repeatable, disposable PostgreSQL behavioral test for Phase 1A (Sales Rep
# flow: sales_rep role, reports hardening, rep-manager assignments,
# rep_reports). Runs the four real migration files from
# supabase/migrations/ — unmodified, exactly as they'd be applied for
# real — against a throwaway local Postgres 17 container (matching the
# live project's Postgres version; see supabase/migrations/20261013180000_video_render_jobs.sql's
# own use of the MAINTAIN privilege, added in PG17), stubbed with this
# project's own verified auth.uid()/is_admin()/profiles/reports shape.
#
# NEVER touches the real Supabase project — no credentials for it are read
# or required anywhere in this script. The container is created fresh and
# removed at the end regardless of outcome (see the trap below).
#
# Every RLS/RPC assertion in the four migrations' own embedded `DO $$` self
# tests runs as the `authenticated` Postgres role (via `SET ROLE
# authenticated`), never as the superuser/table-owner session that applies
# the migrations — RLS does not apply to the latter, which is exactly the
# false-pass pitfall this project's own
# leadership_report_private_ownership_rollback_test.sql already documents
# fixing once before ("SET ROLE omission — it 'passed' for the wrong
# reason"). This script additionally runs a real two-process concurrency
# race that a single serial self-test cannot produce on its own.
#
# Usage: bash supabase/phase1a-behavioral-tests/run.sh
# Requires: Docker.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MIGRATIONS_DIR="$(cd "$SCRIPT_DIR/../migrations" && pwd)"
CONTAINER_NAME="wfg-phase1a-behavioral-test-$$"
PG_IMAGE="postgres:17-alpine"

cleanup() {
  docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "== Starting disposable Postgres ($PG_IMAGE) in container $CONTAINER_NAME =="
# ACCEPTANCE FIX: a prior version of this script waited by polling
# `pg_isready` directly in a plain retry loop. That has a known, real
# failure mode with the official postgres image: on FIRST container start,
# postgres starts briefly for its own initdb bootstrap, then RESTARTS once
# before it's actually ready to serve — a bare `pg_isready` poll can
# observe the brief first "accepting connections" window, report success,
# and let this script proceed moments before the server restarts out from
# under it (this is the most likely explanation for the one transient
# failure observed during Phase 1A's own development, launching several of
# these containers back-to-back).
#
# Fixed by using Docker's OWN health-check mechanism instead of our own ad
# hoc polling: --health-cmd/--health-retries tell Docker to run pg_isready
# repeatedly and track a real "starting -> healthy" state transition, which
# Docker itself only reports once the check has succeeded the configured
# number of times — collapsing through that first bootstrap-then-restart
# blip rather than latching onto its first, possibly-premature success.
# This script then polls Docker's own tracked health STATUS (a single
# source of truth, not a second independent guess) rather than re-deriving
# readiness itself.
docker run -d --name "$CONTAINER_NAME" \
  -e POSTGRES_PASSWORD=postgres \
  --health-cmd="pg_isready -U postgres" \
  --health-interval=1s \
  --health-timeout=3s \
  --health-retries=3 \
  --health-start-period=5s \
  "$PG_IMAGE" >/dev/null

echo "== Waiting for Docker's own health check to report \"healthy\" =="
READY=""
for _ in $(seq 1 90); do
  STATUS="$(docker inspect -f '{{.State.Health.Status}}' "$CONTAINER_NAME" 2>/dev/null || echo "unknown")"
  if [ "$STATUS" = "healthy" ]; then
    READY=1
    break
  fi
  if [ "$(docker inspect -f '{{.State.Running}}' "$CONTAINER_NAME" 2>/dev/null || echo "false")" != "true" ]; then
    echo "FAIL: container $CONTAINER_NAME exited before becoming healthy (status: $STATUS)."
    docker logs "$CONTAINER_NAME" 2>&1 | tail -50
    exit 1
  fi
  sleep 1
done
if [ -z "$READY" ]; then
  echo "FAIL: container $CONTAINER_NAME never reported healthy within 90s (last status: $STATUS)."
  docker logs "$CONTAINER_NAME" 2>&1 | tail -50
  exit 1
fi
echo "Postgres is healthy."

run_sql() {
  local label="$1" file="$2"
  echo ""
  echo "== $label =="
  docker cp "$file" "$CONTAINER_NAME:/tmp/$(basename "$file")"
  if ! docker exec -u postgres "$CONTAINER_NAME" psql -v ON_ERROR_STOP=1 -f "/tmp/$(basename "$file")"; then
    echo "FAIL: $label"
    exit 1
  fi
}

run_sql "Stub schema"            "$SCRIPT_DIR/00-stub-schema.sql"
run_sql "Seed (real manager/admin)" "$SCRIPT_DIR/01-seed.sql"
run_sql "Migration 1: sales_rep_role"                       "$MIGRATIONS_DIR/20261027140000_sales_rep_role.sql"
run_sql "Migration 2: reports_restrict_to_manager_admin"    "$MIGRATIONS_DIR/20261027140100_reports_restrict_to_manager_admin.sql"
run_sql "Migration 3: rep_manager_assignments"              "$MIGRATIONS_DIR/20261027140200_rep_manager_assignments.sql"
run_sql "Migration 4: rep_reports"                          "$MIGRATIONS_DIR/20261027140300_rep_reports.sql"

echo ""
echo "== Concurrency race: two REAL concurrent assign_sales_rep calls for the same rep =="
run_sql "Concurrency race fixture" "$SCRIPT_DIR/02-concurrency-race.sql"

docker cp "$SCRIPT_DIR/race-call.sql" "$CONTAINER_NAME:/tmp/race-call.sql"

# Fire both calls as close together as possible from two independent psql
# processes (two real connections, two real transactions) — this is what
# makes it a genuine race rather than a simulated one.
set +e
docker exec -u postgres "$CONTAINER_NAME" psql -v ON_ERROR_STOP=1 -v manager_id='c0000000-0000-0000-0000-00000000000b' -f /tmp/race-call.sql > /tmp/phase1a-race-1.log 2>&1 &
PID1=$!
docker exec -u postgres "$CONTAINER_NAME" psql -v ON_ERROR_STOP=1 -v manager_id='c0000000-0000-0000-0000-00000000000c' -f /tmp/race-call.sql > /tmp/phase1a-race-2.log 2>&1 &
PID2=$!
wait $PID1; EXIT1=$?
wait $PID2; EXIT2=$?
set -e

echo "--- race call 1 (-> manager 1) exit=$EXIT1 ---"
cat /tmp/phase1a-race-1.log
echo "--- race call 2 (-> manager 2) exit=$EXIT2 ---"
cat /tmp/phase1a-race-2.log

if [ "$EXIT1" -ne 0 ] || [ "$EXIT2" -ne 0 ]; then
  echo "FAIL: at least one concurrent assign_sales_rep call errored out (expected: the advisory lock serializes them so BOTH succeed cleanly, with no raw unique_violation)."
  exit 1
fi

echo ""
echo "== Verifying post-race consistency =="
docker exec -u postgres "$CONTAINER_NAME" psql -v ON_ERROR_STOP=1 -c "
DO \$\$
DECLARE
  active_count integer;
  total_count integer;
BEGIN
  SELECT count(*) FILTER (WHERE unassigned_at IS NULL), count(*)
    INTO active_count, total_count
    FROM public.rep_manager_assignments
    WHERE rep_id = 'c0000000-0000-0000-0000-00000000000a';
  IF active_count <> 1 THEN
    RAISE EXCEPTION 'FAIL: expected exactly 1 active assignment after the race, found %.', active_count;
  END IF;
  IF total_count <> 2 THEN
    RAISE EXCEPTION 'FAIL: expected exactly 2 total assignment rows after the race (one per concurrent call, no duplicates/orphans), found %.', total_count;
  END IF;
  RAISE NOTICE 'PASSED: two concurrent assign_sales_rep calls for the same rep serialized cleanly — exactly 1 active row, 2 total rows, no raw unique_violation.';
END \$\$;
"

echo ""
echo "================================================================"
echo "ALL PHASE 1A BEHAVIORAL TESTS PASSED"
echo "================================================================"

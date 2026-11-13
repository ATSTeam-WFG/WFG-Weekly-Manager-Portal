-- DRAFT ONLY — do not move into supabase/migrations or apply until the
-- Manager authorization design is reviewed and approved.
--
-- This adds one narrow capability: an active Manager may close only the
-- current assignment row whose manager_id is their own auth.uid(). It does
-- not delete the Sales Rep, profiles, report rows, or assignment history.
-- Existing assign_sales_rep/unassign_sales_rep Admin/Sales-Admin behavior is
-- not changed. The new Manager API also remains disabled unless the
-- non-Production MANAGER_ACCOUNT_ACTIONS_ENABLED feature flag is set.
--
-- REVIEW FINDING, addressed below: a Node-side env var does not protect this
-- function once it is actually applied to a real database — GRANT EXECUTE
-- ... TO authenticated means any signed-in Manager could call
-- unassign_own_sales_rep directly via the Supabase client (supabase.rpc(...)),
-- completely bypassing api/manager/sales-reps/unassign.ts and its
-- MANAGER_ACCOUNT_ACTIONS_ENABLED / VERCEL_ENV checks — those only gate the
-- Node wrapper, never the database grant itself. The function's own
-- authorization logic (active Manager, real ownership, no escalation) is
-- independently correct on its own terms, but the TEAM'S decision to keep
-- this capability switched off until approved deserves an enforcement point
-- the database itself honors, not just the Node layer. Added: a database-
-- level kill switch via a Postgres GUC (current_setting with missing_ok,
-- so an unset value is always 'disabled' — fails closed by default,
-- settable only via ALTER DATABASE/ALTER ROLE ... SET by a project owner,
-- never by application code, an RLS policy, or this function's own caller).
-- This does not replace the Node feature flag (defense in depth — both
-- must independently allow the action); it means the database can never be
-- exposed by this grant alone, even if this migration were applied before
-- the Node-side rollout decision was made.
--
-- ACTIVATION MECHANISM (reviewed for connection pooling — Supabase sits
-- Supavisor/PgBouncer in front of Postgres, typically in transaction
-- mode): activate with
--   ALTER DATABASE postgres SET app.manager_account_actions_enabled = 'true';
-- (a one-time statement against the target database, run by a project
-- owner — e.g. via the Supabase SQL editor), NEVER with a plain SET or
-- set_config(...) from application code. ALTER DATABASE ... SET writes a
-- row into Postgres's own pg_db_role_setting catalog; every NEW backend
-- that connects to that database has this default applied automatically
-- at session start, by Postgres itself, regardless of which pooler or
-- pooling mode sits in front of it — there is no "forgetting" it on a
-- pooled/reused connection, because it was never a per-connection runtime
-- SET to begin with, and no dependency on which specific backend a
-- pooled client happens to land on. (A plain `SET app.manager_account_
-- actions_enabled = 'true'` run once in a psql session, by contrast,
-- would only affect that one session/transaction and would never reach
-- the application's own pooled connections at all — this is the mistake
-- this comment exists to prevent.) Verify activation took effect with:
--   SELECT current_setting('app.manager_account_actions_enabled', true);
-- run as a FRESH session/query (not reusing a session opened before the
-- ALTER DATABASE), which should return 'true'. Deactivate the same way
-- with RESET (ALTER DATABASE postgres RESET app.manager_account_actions_enabled;).
--
-- Direct-RPC-invocation safety (re-confirmed, not just asserted): GRANT
-- EXECUTE ... TO authenticated below means ANY signed-in Manager can call
-- this function directly via supabase.rpc(...), bypassing
-- api/manager/sales-reps/unassign.ts entirely — this is BY DESIGN and
-- safe specifically because every authorization check inside the function
-- body derives from auth.uid() (the caller's own verified JWT), never
-- from a parameter or anything the Node layer would have supplied; a
-- direct call is authorized (or refused) by exactly the same rules as a
-- call routed through the Node endpoint. The kill switch above is the one
-- check that is NOT re-derived per-caller (it is a database-wide
-- default), which is exactly why it needed its own explicit review and
-- activation step, documented here.

CREATE OR REPLACE FUNCTION public.unassign_own_sales_rep(p_rep_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_rep_role text;
  v_updated integer;
BEGIN
  -- Database-level kill switch, independent of the Node API's own
  -- MANAGER_ACCOUNT_ACTIONS_ENABLED check. Missing (the default, until a
  -- project owner explicitly sets it) or any value other than the literal
  -- string 'true' means disabled — never inferred from anything the caller
  -- controls.
  IF coalesce(current_setting('app.manager_account_actions_enabled', true), 'false') <> 'true' THEN
    RAISE EXCEPTION 'FEATURE_DISABLED: Manager-initiated sales rep unassignment is not yet enabled on this database.';
  END IF;

  -- Optional narrow allowlist, for controlled Preview validation before a
  -- broad rollout: when app.manager_account_actions_allowed_ids holds a
  -- non-empty, comma-separated list of Manager profile ids, ONLY those
  -- Managers may proceed, even though the boolean switch above is already
  -- 'true' for the whole database. Left unset (the only state this ever
  -- had before this check existed, and the intended Production steady
  -- state once broadly approved), every active Manager is allowed, exactly
  -- as before. A malformed value (not valid uuids) fails this cast with a
  -- genuine Postgres error rather than silently granting or denying
  -- access — never a fail-open on a typo.
  IF current_setting('app.manager_account_actions_allowed_ids', true) IS NOT NULL
     AND trim(current_setting('app.manager_account_actions_allowed_ids', true)) <> ''
     AND NOT (v_caller = ANY (string_to_array(current_setting('app.manager_account_actions_allowed_ids', true), ',')::uuid[]))
  THEN
    RAISE EXCEPTION 'FEATURE_DISABLED: Manager-initiated sales rep unassignment is not yet enabled for your account.';
  END IF;
  -- This exact check (narrowed vs. unset behavior, malformed-value
  -- handling) is exercised with a fully synthetic fixture in the
  -- companion self-assignment draft's own self-test (Test 7) — this
  -- file's self-test below reuses real existing assignment data by
  -- established convention and was not restructured to duplicate that
  -- coverage, since the underlying SQL is identical in both files.

  IF v_caller IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = v_caller AND p.role = 'manager' AND p.is_active = true
  ) THEN
    RAISE EXCEPTION 'FORBIDDEN: An active Manager session is required.';
  END IF;

  -- Share the per-rep lock used by the existing Admin/Sales-Admin
  -- assign_sales_rep/unassign_sales_rep RPCs so a reassign/unassign race is
  -- serialized and the assignment history remains valid.
  PERFORM pg_advisory_xact_lock(hashtext(p_rep_id::text));

  SELECT role INTO v_rep_role FROM public.profiles WHERE id = p_rep_id;
  IF v_rep_role IS DISTINCT FROM 'sales_rep' THEN
    RAISE EXCEPTION 'INVALID_REP: The target profile is not a Sales Rep.';
  END IF;

  -- Recheck current ownership after taking the shared lock. Never trusts a
  -- manager id supplied by the request and never touches another manager's
  -- assignment row.
  IF NOT public.is_assigned_manager_of(p_rep_id) THEN
    RAISE EXCEPTION 'FORBIDDEN: This Sales Rep is not currently assigned to you.';
  END IF;

  UPDATE public.rep_manager_assignments
  SET unassigned_at = clock_timestamp(), unassigned_by = v_caller
  WHERE rep_id = p_rep_id
    AND manager_id = v_caller
    AND unassigned_at IS NULL;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated = 1;
END;
$$;

REVOKE ALL ON FUNCTION public.unassign_own_sales_rep(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.unassign_own_sales_rep(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.unassign_own_sales_rep(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- Self-verifying test script, same established pattern used throughout this
-- project's other migrations (e.g. 20260920_password_change_required.sql):
-- real existing rows, request.jwt.claims simulation, atomic. DRAFT-ONLY —
-- this entire file, self-test included, must not be applied to PREVIEW or
-- production until approved; it is written so it is ready to run
-- immediately once that approval happens, exactly like every other
-- migration in this project.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  test_rep_id uuid;
  test_manager_id uuid;
  test_other_manager_id uuid;
  result boolean;
  caught boolean;
BEGIN
  SELECT a.rep_id, a.manager_id INTO test_rep_id, test_manager_id
  FROM rep_manager_assignments a
  WHERE a.unassigned_at IS NULL
  LIMIT 1;

  IF test_rep_id IS NULL THEN
    RAISE NOTICE 'SKIPPED: this self-test needs at least one existing active rep_manager_assignments row to run against.';
    RETURN;
  END IF;

  SELECT id INTO test_other_manager_id FROM profiles WHERE role = 'manager' AND is_active = true AND id <> test_manager_id LIMIT 1;

  SET ROLE authenticated;

  -- Test 1: the kill switch defaults to disabled (unset) — even an active
  -- Manager acting on their own currently-assigned rep is refused.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', test_manager_id)::text, true);
  caught := false;
  BEGIN
    PERFORM public.unassign_own_sales_rep(test_rep_id);
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'FEATURE_DISABLED%' THEN caught := true; ELSE RAISE; END IF;
  END;
  IF NOT caught THEN
    RESET ROLE;
    RAISE EXCEPTION 'Test 1 FAILED: the kill switch did not block an unset GUC — it must default to disabled.';
  END IF;
  RAISE NOTICE 'Test 1 PASSED: unset kill switch correctly defaults to disabled.';

  -- From here on, enable the kill switch for this session only (never
  -- persisted beyond this transaction) to exercise the rest of the
  -- function's own authorization logic.
  RESET ROLE;
  PERFORM set_config('app.manager_account_actions_enabled', 'true', true);
  SET ROLE authenticated;

  -- Test 2: a DIFFERENT manager (not the one currently assigned) is refused.
  IF test_other_manager_id IS NOT NULL THEN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', test_other_manager_id)::text, true);
    caught := false;
    BEGIN
      PERFORM public.unassign_own_sales_rep(test_rep_id);
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM LIKE 'FORBIDDEN%' THEN caught := true; ELSE RAISE; END IF;
    END;
    IF NOT caught THEN
      RESET ROLE;
      RAISE EXCEPTION 'Test 2 FAILED: a different Manager was able to unassign a Sales Rep not currently assigned to them.';
    END IF;
    RAISE NOTICE 'Test 2 PASSED: a Manager cannot unassign another Manager''s Sales Rep, even with the kill switch enabled.';
  ELSE
    RAISE NOTICE 'Test 2 SKIPPED: no second active Manager profile exists to test cross-Manager ownership against.';
  END IF;

  -- Test 3: the actual assigned Manager succeeds, with the kill switch on.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', test_manager_id)::text, true);
  SELECT public.unassign_own_sales_rep(test_rep_id) INTO result;
  IF result IS NOT TRUE THEN
    RESET ROLE;
    RAISE EXCEPTION 'Test 3 FAILED: the actual assigned Manager could not unassign their own Sales Rep with the kill switch enabled.';
  END IF;
  RAISE NOTICE 'Test 3 PASSED: the assigned Manager successfully closed their own assignment.';

  -- Test 4: calling it again for the same rep is safe — is_assigned_manager_of
  -- now correctly sees no active assignment for this caller (Test 3 already
  -- closed it), so the RETRY raises the same FORBIDDEN ownership error a
  -- genuine stranger would get, rather than silently re-running the UPDATE
  -- or returning a misleading true. Never a second history row, never an
  -- unhandled exception.
  caught := false;
  BEGIN
    PERFORM public.unassign_own_sales_rep(test_rep_id);
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'FORBIDDEN%' THEN caught := true; ELSE RAISE; END IF;
  END;
  IF NOT caught THEN
    RESET ROLE;
    RAISE EXCEPTION 'Test 4 FAILED: retrying after a successful unassignment did not raise FORBIDDEN as expected.';
  END IF;
  RAISE NOTICE 'Test 4 PASSED: retrying after a successful unassignment correctly raises FORBIDDEN (no longer assigned), never a silent or duplicate write.';

  RESET ROLE;

  -- Restore the real assignment this self-test closed, so running it leaves
  -- no lasting effect on the row it borrowed.
  UPDATE rep_manager_assignments
  SET unassigned_at = NULL, unassigned_by = NULL
  WHERE rep_id = test_rep_id AND manager_id = test_manager_id AND unassigned_at IS NOT NULL;

  PERFORM set_config('app.manager_account_actions_enabled', '', true);
  RESET request.jwt.claims;
  RAISE NOTICE 'All tests PASSED. The borrowed assignment row was restored to its original (assigned) state.';
END $$;

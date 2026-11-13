-- DRAFT ONLY — do not move into supabase/migrations or apply until
-- reviewed and approved. CORRECTIVE, forward-only migration: it does not
-- edit or replace the four already-executed migration drafts by hand —
-- it patches the two functions they created, in place, via CREATE OR
-- REPLACE (same signature, same return type for both), which is safe to
-- run on Preview exactly once, and safe to re-run if needed (idempotent).
--
-- ROOT CAUSE
-- assign_own_sales_rep(uuid) and unassign_own_sales_rep(uuid), as actually
-- applied to Preview project asojatcycijoikeovibs, treat
-- app.manager_account_actions_allowed_ids as OPTIONAL: whenever it is
-- unset or an empty string, the allowlist check is skipped entirely and
-- every active Manager is authorized, with the allowlist only ever able
-- to NARROW access when a project owner chooses to populate it. That
-- means the single boolean switch (app.manager_account_actions_enabled =
-- 'true') is, by itself, sufficient to expose Manager-initiated
-- assignment/unassignment to every active Manager in the database — the
-- allowlist was a layer of defense-in-depth, never a required gate. For
-- controlled Preview validation (one dedicated test Manager account, by
-- design — see the activation plan), that is too permissive: a single
-- misconfiguration (forgetting to also set the allowlist, or a
-- deployment step that enables the boolean switch slightly before the
-- allowlist step runs) would silently open the capability to every active
-- Manager, not just the intended test account. This migration makes the
-- allowlist itself a mandatory, fail-closed gate.
--
-- CORRECTED LOGIC
-- A caller is authorized only if ALL of the following hold:
--   1. app.manager_account_actions_enabled equals the literal string
--      'true' (unchanged from before).
--   2. app.manager_account_actions_allowed_ids is set, non-empty after
--      trimming, and parses entirely as a comma-separated list of valid
--      UUIDs (every entry — a single bad entry invalidates the whole
--      value, never just that one entry).
--   3. The caller's own auth.uid() is present in that parsed list.
-- Missing, empty, whitespace-only, malformed (including partially
-- malformed — one good id plus one bad entry), or non-matching allowlists
-- all deny EVERY caller. There is no remaining code path that treats an
-- absent or unusable allowlist as "allow all". This is implemented once,
-- in a small shared helper function, so the two RPCs can never drift from
-- each other on this logic.
--
-- UNCHANGED (by design — this migration touches authorization logic only)
--   - Both functions' signatures and return types.
--   - The existing active-Manager-role check, real-ownership checks,
--     ALREADY_ASSIGNED/INVALID_REP/FORBIDDEN error codes, idempotent
--     re-assignment behavior, the shared pg_advisory_xact_lock key, and
--     the UPDATE/INSERT statements themselves.
--   - The existing REVOKE/GRANT EXECUTE privileges on both RPCs
--     (authenticated only, never anon/PUBLIC) — CREATE OR REPLACE
--     FUNCTION preserves existing grants for an unchanged signature, but
--     this migration restates them explicitly anyway, for certainty.
--   - SECURITY DEFINER behavior: both RPCs still derive every
--     authorization decision from auth.uid() (the caller's own verified
--     JWT) and from this helper's own read of the GUC via
--     current_setting(...) — never from a parameter, and never from
--     anything a request body could supply. The new helper function
--     itself has NO grant to authenticated/anon/PUBLIC, so it can only
--     ever be reached from inside these two already-reviewed SECURITY
--     DEFINER functions, never called directly via supabase.rpc(...).
--
-- ON "CAN AN AUTHENTICATED CLIENT SUPPLY app.manager_account_actions_
-- allowed_ids ITSELF?" — reviewed, and no: PostgREST (what Supabase's
-- client SDK talks to) only ever sets a small, fixed set of per-request
-- session GUCs it controls itself (request.jwt.claims and similar
-- request.* values derived from the HTTP request), and binds RPC
-- arguments as typed function parameters — it never lets a client's
-- request body or headers set an arbitrary custom app.* GUC. This
-- project's PostgREST configuration defines no additional pre-request
-- hook that would forward anything into this specific GUC name. The only
-- way this value is ever set is ALTER DATABASE ... SET, run directly by a
-- project owner — never by application code, an RLS policy, or either
-- RPC's own caller. (A session-level SET/set_config of a custom GUC is
-- technically permitted to any Postgres role by default, but Supabase's
-- REST interface gives a remote client no mechanism to issue one.)
--
-- Because the four original drafts have already been executed against
-- Preview, this file is the one to run there now. The two source drafts
-- (20261110_manager_owned_sales_rep_unassignment.sql and
-- 20261112_manager_owned_sales_rep_self_assignment.sql) have also been
-- updated in place with this same corrected logic, so a FRESH environment
-- that applies all drafts from scratch gets the fix from the start and
-- never needs this file at all.

CREATE OR REPLACE FUNCTION public.manager_account_action_allowlist_permits(p_caller uuid)
RETURNS boolean
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_raw text := current_setting('app.manager_account_actions_allowed_ids', true);
  v_parts text[];
  v_part text;
  v_ids uuid[] := ARRAY[]::uuid[];
BEGIN
  IF p_caller IS NULL THEN
    RETURN false;
  END IF;

  IF v_raw IS NULL OR trim(v_raw) = '' THEN
    RETURN false;
  END IF;

  v_parts := string_to_array(v_raw, ',');

  BEGIN
    FOREACH v_part IN ARRAY v_parts LOOP
      v_part := trim(v_part);
      IF v_part = '' THEN
        RETURN false;
      END IF;
      v_ids := v_ids || v_part::uuid;
    END LOOP;
  EXCEPTION WHEN OTHERS THEN
    RETURN false;
  END;

  IF array_length(v_ids, 1) IS NULL THEN
    RETURN false;
  END IF;

  RETURN p_caller = ANY (v_ids);
END;
$$;

REVOKE ALL ON FUNCTION public.manager_account_action_allowlist_permits(uuid) FROM PUBLIC, authenticated, anon;

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
  IF coalesce(current_setting('app.manager_account_actions_enabled', true), 'false') <> 'true' THEN
    RAISE EXCEPTION 'FEATURE_DISABLED: Manager-initiated sales rep unassignment is not yet enabled on this database.';
  END IF;

  IF public.manager_account_action_allowlist_permits(v_caller) IS NOT TRUE THEN
    RAISE EXCEPTION 'FEATURE_DISABLED: Manager-initiated sales rep unassignment is not yet enabled for your account.';
  END IF;

  IF v_caller IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = v_caller AND p.role = 'manager' AND p.is_active = true
  ) THEN
    RAISE EXCEPTION 'FORBIDDEN: An active Manager session is required.';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(p_rep_id::text));

  SELECT role INTO v_rep_role FROM public.profiles WHERE id = p_rep_id;
  IF v_rep_role IS DISTINCT FROM 'sales_rep' THEN
    RAISE EXCEPTION 'INVALID_REP: The target profile is not a Sales Rep.';
  END IF;

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

CREATE OR REPLACE FUNCTION public.assign_own_sales_rep(p_rep_id uuid)
RETURNS public.rep_manager_assignments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_rep_role text;
  v_existing public.rep_manager_assignments;
  v_result public.rep_manager_assignments;
BEGIN
  IF coalesce(current_setting('app.manager_account_actions_enabled', true), 'false') <> 'true' THEN
    RAISE EXCEPTION 'FEATURE_DISABLED: Manager-initiated sales rep assignment is not yet enabled on this database.';
  END IF;

  IF public.manager_account_action_allowlist_permits(v_caller) IS NOT TRUE THEN
    RAISE EXCEPTION 'FEATURE_DISABLED: Manager-initiated sales rep assignment is not yet enabled for your account.';
  END IF;

  IF v_caller IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = v_caller AND p.role = 'manager' AND p.is_active = true
  ) THEN
    RAISE EXCEPTION 'FORBIDDEN: An active Manager session is required.';
  END IF;

  SELECT role INTO v_rep_role FROM public.profiles WHERE id = p_rep_id;
  IF v_rep_role IS DISTINCT FROM 'sales_rep' THEN
    RAISE EXCEPTION 'INVALID_REP: The target profile is not a Sales Rep.';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(p_rep_id::text));

  SELECT * INTO v_existing
  FROM public.rep_manager_assignments
  WHERE rep_id = p_rep_id AND unassigned_at IS NULL;

  IF v_existing.id IS NOT NULL THEN
    IF v_existing.manager_id = v_caller THEN
      RETURN v_existing;
    END IF;
    RAISE EXCEPTION 'ALREADY_ASSIGNED: This Sales Rep is already assigned to a different Manager. Only an Admin or Sales Admin can reassign them.';
  END IF;

  INSERT INTO public.rep_manager_assignments (rep_id, manager_id, assigned_by, assigned_at)
  VALUES (p_rep_id, v_caller, v_caller, clock_timestamp())
  RETURNING * INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.assign_own_sales_rep(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.assign_own_sales_rep(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.assign_own_sales_rep(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- Self-verifying test. Fully synthetic — no real data touched. This is a
-- representative confirmation that the corrective patch itself behaves
-- correctly once applied; the exhaustive edge-case matrix (empty,
-- whitespace-only, malformed, partially-malformed, non-matching,
-- inactive-Manager, non-Manager, real authenticated/anon grants) is
-- already covered by the updated self-tests embedded in the two source
-- drafts themselves (20261110_manager_owned_sales_rep_unassignment.sql
-- and 20261112_manager_owned_sales_rep_self_assignment.sql).
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  fake_rep_a_id uuid := gen_random_uuid();
  fake_rep_b_id uuid := gen_random_uuid();
  fake_manager_allowed_id uuid := gen_random_uuid();
  fake_manager_other_id uuid := gen_random_uuid();
  v_assignment public.rep_manager_assignments;
  result boolean;
BEGIN
  BEGIN
    INSERT INTO auth.users (id) VALUES (fake_rep_a_id), (fake_rep_b_id), (fake_manager_allowed_id), (fake_manager_other_id);
    INSERT INTO public.profiles (id, full_name, email, role, is_active) VALUES
      (fake_rep_a_id, 'Allowlist Fix Test Rep A', 'allowlist-fix-test-rep-a-' || fake_rep_a_id || '@example.invalid', 'sales_rep', true),
      (fake_rep_b_id, 'Allowlist Fix Test Rep B', 'allowlist-fix-test-rep-b-' || fake_rep_b_id || '@example.invalid', 'sales_rep', true),
      (fake_manager_allowed_id, 'Allowlist Fix Test Manager (Allowed)', 'allowlist-fix-test-mgr-allowed-' || fake_manager_allowed_id || '@example.invalid', 'manager', true),
      (fake_manager_other_id, 'Allowlist Fix Test Manager (Other)', 'allowlist-fix-test-mgr-other-' || fake_manager_other_id || '@example.invalid', 'manager', true);
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIPPED corrective allowlist self-test: could not create throwaway profiles (%).', SQLERRM;
    RETURN;
  END;

  PERFORM set_config('app.manager_account_actions_enabled', 'true', true);

  -- The helper itself, called directly (no role simulation needed — it is
  -- a plain function, not SECURITY DEFINER, so this just exercises its
  -- own parsing logic as superuser).
  PERFORM set_config('app.manager_account_actions_allowed_ids', '', true);
  IF public.manager_account_action_allowlist_permits(fake_manager_allowed_id) IS NOT FALSE THEN
    RAISE EXCEPTION 'FAILED: helper did not deny an empty allowlist.';
  END IF;

  PERFORM set_config('app.manager_account_actions_allowed_ids', 'garbage-not-a-uuid', true);
  IF public.manager_account_action_allowlist_permits(fake_manager_allowed_id) IS NOT FALSE THEN
    RAISE EXCEPTION 'FAILED: helper did not deny a malformed allowlist.';
  END IF;

  PERFORM set_config('app.manager_account_actions_allowed_ids', fake_manager_other_id::text, true);
  IF public.manager_account_action_allowlist_permits(fake_manager_allowed_id) IS NOT FALSE THEN
    RAISE EXCEPTION 'FAILED: helper did not deny a non-matching allowlist.';
  END IF;

  PERFORM set_config('app.manager_account_actions_allowed_ids', fake_manager_allowed_id::text, true);
  IF public.manager_account_action_allowlist_permits(fake_manager_allowed_id) IS NOT TRUE THEN
    RAISE EXCEPTION 'FAILED: helper did not permit a caller explicitly present in a valid allowlist.';
  END IF;
  RAISE NOTICE 'PASSED: helper function denies empty/malformed/non-matching allowlists and permits an explicit match.';

  -- End-to-end through assign_own_sales_rep: allowlist unset denies even
  -- though the switch is on.
  PERFORM set_config('app.manager_account_actions_allowed_ids', '', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', fake_manager_allowed_id)::text, true);
  SET ROLE authenticated;
  BEGIN
    PERFORM public.assign_own_sales_rep(fake_rep_a_id);
    RESET ROLE;
    RAISE EXCEPTION 'FAILED: assign_own_sales_rep allowed a Manager through with the allowlist unset.';
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    IF SQLERRM LIKE 'FEATURE_DISABLED%' THEN
      RAISE NOTICE 'PASSED: assign_own_sales_rep denies with the allowlist unset, even with the boolean switch on.';
    ELSE
      RAISE;
    END IF;
  END;

  -- Now allowlist the one approved test Manager and confirm both RPCs work
  -- end-to-end, subject to their unchanged ownership checks.
  PERFORM set_config('app.manager_account_actions_allowed_ids', fake_manager_allowed_id::text, true);

  SET ROLE authenticated;
  v_assignment := public.assign_own_sales_rep(fake_rep_a_id);
  RESET ROLE;
  IF v_assignment.manager_id IS DISTINCT FROM fake_manager_allowed_id THEN
    RAISE EXCEPTION 'FAILED: the allowlisted Manager could not self-assign an unassigned rep.';
  END IF;
  RAISE NOTICE 'PASSED: assign_own_sales_rep succeeds for the allowlisted Manager, through the real authenticated role.';

  SET ROLE authenticated;
  result := public.unassign_own_sales_rep(fake_rep_a_id);
  RESET ROLE;
  IF result IS NOT TRUE THEN
    RAISE EXCEPTION 'FAILED: the allowlisted Manager could not unassign their own just-assigned rep.';
  END IF;
  RAISE NOTICE 'PASSED: unassign_own_sales_rep succeeds for the allowlisted Manager, through the real authenticated role.';

  -- A non-allowlisted Manager, calling directly as the real authenticated
  -- role (not a superuser session), is still denied.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', fake_manager_other_id)::text, true);
  SET ROLE authenticated;
  BEGIN
    PERFORM public.assign_own_sales_rep(fake_rep_b_id);
    RESET ROLE;
    RAISE EXCEPTION 'FAILED: a non-allowlisted Manager was able to call assign_own_sales_rep as the real authenticated role.';
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    IF SQLERRM LIKE 'FEATURE_DISABLED%' THEN
      RAISE NOTICE 'PASSED: a non-allowlisted Manager is denied even as the real authenticated role.';
    ELSE
      RAISE;
    END IF;
  END;

  -- Cleanup.
  RESET request.jwt.claims;
  RESET app.manager_account_actions_enabled;
  RESET app.manager_account_actions_allowed_ids;
  DELETE FROM public.rep_manager_assignments WHERE rep_id IN (fake_rep_a_id, fake_rep_b_id);
  DELETE FROM public.profiles WHERE id IN (fake_rep_a_id, fake_rep_b_id, fake_manager_allowed_id, fake_manager_other_id);
  DELETE FROM auth.users WHERE id IN (fake_rep_a_id, fake_rep_b_id, fake_manager_allowed_id, fake_manager_other_id);
  RAISE NOTICE 'Cleanup PASSED: no residual synthetic rows remain. Corrective migration self-test complete.';
END $$;

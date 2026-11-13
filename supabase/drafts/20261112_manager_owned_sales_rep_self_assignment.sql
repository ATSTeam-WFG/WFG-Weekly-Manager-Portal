-- DRAFT ONLY — do not move into supabase/migrations or apply until
-- reviewed and approved. Companion to
-- 20261110_manager_owned_sales_rep_unassignment.sql (Remove Assignment);
-- this adds the matching "claim an unassigned Sales Rep for myself" half
-- of Manager self-service Sales Rep management (Add Sales Rep's
-- auto-assignment step, and nothing else — a Manager editing an existing
-- rep's name/email reuses the already-committed decideSalesRepProfileUpdate
-- guard, extended at the Node layer to also accept a Manager who is the
-- rep's current assigned manager; no new SQL is needed for that).
--
-- SCOPE, deliberately narrow: a Manager may assign ONLY an rep that
-- currently has NO active manager (unassigned_at IS NULL does not already
-- exist for them) to THEMSELVES, never to any other manager_id, and never
-- a rep who is currently assigned to someone else — reassigning away from
-- another Manager remains Admin/Sales-Admin-only via the existing
-- assign_sales_rep. This is what "Managers must never modify another
-- Manager's assignments or users" means structurally here: there is no
-- parameter this function accepts that could ever target another
-- manager's active assignment, and the one case where a target rep
-- already has an active assignment (to anyone, including this same
-- caller — see idempotency below) is read before any write and compared
-- against auth.uid(), not merely assumed absent.
--
-- Shares the same database-level kill switch as the companion
-- unassignment draft (current_setting with missing_ok, fails closed on
-- any database that has not explicitly enabled it) and the same advisory
-- lock key as assign_sales_rep/unassign_sales_rep/unassign_own_sales_rep,
-- so a concurrent Admin-driven assign/unassign for the same rep can never
-- race against this. See that draft's own header comment for the full
-- activation mechanism (ALTER DATABASE ... SET, verified safe under
-- connection pooling) and direct-RPC-invocation safety analysis — both
-- apply here identically, since this function shares the exact same
-- kill-switch GUC and the exact same "every check derives from auth.uid(),
-- never a Node-supplied parameter" design.

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

  -- Optional narrow allowlist — see the companion unassignment draft's own
  -- header comment for the full rationale (controlled Preview validation
  -- before a broad rollout; unset means every active Manager is allowed,
  -- exactly as before this existed).
  IF current_setting('app.manager_account_actions_allowed_ids', true) IS NOT NULL
     AND trim(current_setting('app.manager_account_actions_allowed_ids', true)) <> ''
     AND NOT (v_caller = ANY (string_to_array(current_setting('app.manager_account_actions_allowed_ids', true), ',')::uuid[]))
  THEN
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

  -- Same lock key as assign_sales_rep/unassign_sales_rep/
  -- unassign_own_sales_rep — serializes against every other caller
  -- (Admin or Manager) touching this same rep's assignment.
  PERFORM pg_advisory_xact_lock(hashtext(p_rep_id::text));

  SELECT * INTO v_existing
  FROM public.rep_manager_assignments
  WHERE rep_id = p_rep_id AND unassigned_at IS NULL;

  IF v_existing.id IS NOT NULL THEN
    IF v_existing.manager_id = v_caller THEN
      -- Idempotent: the rep is already actively assigned to this same
      -- caller — return the existing row unchanged, no new history row.
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
-- Self-verifying test. Creates throwaway synthetic profiles only, removed
-- before this block returns. Five tests: kill-switch-defaults-disabled,
-- successful-self-assignment, idempotent-re-call, cannot-claim-another-
-- managers-rep, non-manager-forbidden.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  fake_rep_id uuid := gen_random_uuid();
  fake_rep2_id uuid := gen_random_uuid();
  fake_manager_a_id uuid := gen_random_uuid();
  fake_manager_b_id uuid := gen_random_uuid();
  v_assignment public.rep_manager_assignments;
  active_count integer;
  history_count integer;
BEGIN
  BEGIN
    INSERT INTO auth.users (id) VALUES (fake_rep_id), (fake_rep2_id), (fake_manager_a_id), (fake_manager_b_id);
    INSERT INTO public.profiles (id, full_name, email, role, is_active) VALUES
      (fake_rep_id, 'Self-Assign Test Rep', 'self-assign-test-rep-' || fake_rep_id || '@example.invalid', 'sales_rep', true),
      (fake_rep2_id, 'Self-Assign Test Rep 2', 'self-assign-test-rep2-' || fake_rep2_id || '@example.invalid', 'sales_rep', true),
      (fake_manager_a_id, 'Self-Assign Test Manager A', 'self-assign-test-mgr-a-' || fake_manager_a_id || '@example.invalid', 'manager', true),
      (fake_manager_b_id, 'Self-Assign Test Manager B', 'self-assign-test-mgr-b-' || fake_manager_b_id || '@example.invalid', 'manager', true);
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIPPED assign_own_sales_rep self-test: could not create throwaway profiles (%).', SQLERRM;
    RETURN;
  END;

  -- Test 1: kill switch defaults disabled.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', fake_manager_a_id)::text, true);
  BEGIN
    PERFORM public.assign_own_sales_rep(fake_rep_id);
    RAISE EXCEPTION 'FAILED: assign_own_sales_rep should be disabled by default (no app.manager_account_actions_enabled set).';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'FEATURE_DISABLED%' THEN
      RAISE NOTICE 'PASSED: kill switch defaults to disabled.';
    ELSE
      RAISE;
    END IF;
  END;

  -- Enable the kill switch for the rest of this test block only (session-
  -- local via set_config's third arg = true — never persisted, never
  -- affects any other session or a real deployment).
  PERFORM set_config('app.manager_account_actions_enabled', 'true', true);

  -- Test 2: successful self-assignment.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', fake_manager_a_id)::text, true);
  v_assignment := public.assign_own_sales_rep(fake_rep_id);
  IF v_assignment.manager_id IS DISTINCT FROM fake_manager_a_id THEN
    RAISE EXCEPTION 'FAILED: expected the new assignment''s manager_id to be the calling manager.';
  END IF;
  RAISE NOTICE 'PASSED: manager A successfully self-assigns an unassigned rep.';

  -- Test 3: idempotent re-call by the same manager.
  PERFORM public.assign_own_sales_rep(fake_rep_id);
  SELECT count(*) FILTER (WHERE unassigned_at IS NULL), count(*)
    INTO active_count, history_count
    FROM public.rep_manager_assignments WHERE rep_id = fake_rep_id;
  IF active_count <> 1 OR history_count <> 1 THEN
    RAISE EXCEPTION 'FAILED: re-calling for the same manager was not idempotent — expected 1 active / 1 total, found % active / % total.', active_count, history_count;
  END IF;
  RAISE NOTICE 'PASSED: re-assigning to the same (calling) manager is idempotent.';

  -- Test 4: manager B cannot claim a rep already assigned to manager A.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', fake_manager_b_id)::text, true);
  BEGIN
    PERFORM public.assign_own_sales_rep(fake_rep_id);
    RAISE EXCEPTION 'FAILED: manager B was able to claim a rep already assigned to manager A.';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'ALREADY_ASSIGNED%' THEN
      RAISE NOTICE 'PASSED: manager B cannot claim another manager''s already-assigned rep.';
    ELSE
      RAISE;
    END IF;
  END;

  -- Test 5: a sales_rep (non-manager) cannot call this at all.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', fake_rep_id)::text, true);
  BEGIN
    PERFORM public.assign_own_sales_rep(fake_rep_id);
    RAISE EXCEPTION 'FAILED: a sales_rep was able to call assign_own_sales_rep.';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'FORBIDDEN%' THEN
      RAISE NOTICE 'PASSED: a non-manager caller cannot call assign_own_sales_rep.';
    ELSE
      RAISE;
    END IF;
  END;

  -- Test 6 (REVIEW FIX — added to verify REAL grants, not just this
  -- function's own internal logic): under the genuine `authenticated`/
  -- `anon` roles (SET ROLE, not a superuser session with a fake JWT claim
  -- — superuser bypasses the GRANT/REVOKE below entirely, so testing only
  -- as superuser, as Tests 1-5 above do, would never catch a missing
  -- REVOKE). anon cannot call this function at all. authenticated (as
  -- manager A, who is still the rep's active manager from Test 2/3 —
  -- Tests 4 and 5 both failed and changed nothing) CAN call it
  -- successfully, hitting the same idempotent no-op path as Test 3 —
  -- confirming the actual GRANT EXECUTE ... TO authenticated takes
  -- effect, not merely that the function's own body would allow it if
  -- reachable.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', fake_manager_a_id)::text, true);
  SET ROLE anon;
  BEGIN
    PERFORM public.assign_own_sales_rep(fake_rep_id);
    RAISE EXCEPTION 'FAILED: anon was able to call assign_own_sales_rep at all.';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASSED: anon has no EXECUTE grant on assign_own_sales_rep.';
  END;
  RESET ROLE;

  SET ROLE authenticated;
  PERFORM public.assign_own_sales_rep(fake_rep_id);
  RESET ROLE;
  SELECT count(*) FILTER (WHERE unassigned_at IS NULL AND manager_id = fake_manager_a_id)
    INTO active_count
    FROM public.rep_manager_assignments WHERE rep_id = fake_rep_id;
  IF active_count <> 1 THEN
    RAISE EXCEPTION 'FAILED: calling assign_own_sales_rep as the real authenticated role did not produce the expected active assignment to manager A.';
  END IF;
  RAISE NOTICE 'PASSED: the real authenticated role (not just a superuser session) can successfully call assign_own_sales_rep when authorized.';

  -- Test 7 (REVIEW FIX — narrowly-scoped allowlist for controlled Preview
  -- validation): a fresh, still-unassigned rep. With the allowlist set to
  -- ONLY manager B, manager A (not listed) is blocked even though the
  -- boolean switch is already 'true' database-wide; manager B (listed)
  -- succeeds on the exact same rep.
  PERFORM set_config('app.manager_account_actions_allowed_ids', fake_manager_b_id::text, true);

  PERFORM set_config('request.jwt.claims', json_build_object('sub', fake_manager_a_id)::text, true);
  BEGIN
    PERFORM public.assign_own_sales_rep(fake_rep2_id);
    RAISE EXCEPTION 'FAILED: manager A (not in the allowlist) was able to call assign_own_sales_rep.';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'FEATURE_DISABLED%' THEN
      RAISE NOTICE 'PASSED: a Manager not in app.manager_account_actions_allowed_ids is blocked even though the boolean switch is on.';
    ELSE
      RAISE;
    END IF;
  END;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', fake_manager_b_id)::text, true);
  PERFORM public.assign_own_sales_rep(fake_rep2_id);
  SELECT count(*) FILTER (WHERE unassigned_at IS NULL AND manager_id = fake_manager_b_id)
    INTO active_count
    FROM public.rep_manager_assignments WHERE rep_id = fake_rep2_id;
  IF active_count <> 1 THEN
    RAISE EXCEPTION 'FAILED: manager B (in the allowlist) could not self-assign the rep.';
  END IF;
  RAISE NOTICE 'PASSED: a Manager IN the allowlist can proceed normally.';

  RESET app.manager_account_actions_allowed_ids;

  -- Cleanup.
  RESET request.jwt.claims;
  RESET app.manager_account_actions_enabled;
  DELETE FROM public.rep_manager_assignments WHERE rep_id IN (fake_rep_id, fake_rep2_id);
  DELETE FROM public.profiles WHERE id IN (fake_rep_id, fake_rep2_id, fake_manager_a_id, fake_manager_b_id);
  DELETE FROM auth.users WHERE id IN (fake_rep_id, fake_rep2_id, fake_manager_a_id, fake_manager_b_id);
  RAISE NOTICE 'Cleanup PASSED: no residual synthetic rows remain.';
END $$;

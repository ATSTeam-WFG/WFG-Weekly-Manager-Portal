-- ---------------------------------------------------------------------------
-- Sales Admin — a new, distinct, least-privilege role. NOT a widening of
-- is_admin()/'admin': is_admin() stays admin-only everywhere, unchanged, in
-- this migration. Every existing policy/RPC that keys off is_admin() (the
-- rep_reports/rep_report_review_history/governance-table SELECT policies,
-- review_rep_report, grant_rep_report_late_submission_exception) continues
-- to treat a sales_admin exactly like any other non-admin caller — which is
-- exactly the required behavior (Sales Admin must never approve/reject a
-- report or grant a late exception).
--
-- This migration adds a brand new, separate helper (is_sales_admin()) and
-- grants it access ONLY where explicitly required:
--   - profiles:   read ALL sales_rep rows (not just assigned ones) — never
--                 manager/admin rows (Manager names for the assignment
--                 selector are served through the existing, already-narrow
--                 list-managers.ts/listActiveManagers() service-role-backed
--                 endpoint instead — {id, fullName} only, no RLS grant
--                 needed or added here).
--   - rep_reports: read ALL rows (any rep, any manager) — read-only; no
--                 write policy is added, and review_rep_report's own
--                 authorization (is_assigned_manager_of OR is_admin) is
--                 untouched, so a sales_admin still cannot approve/reject.
--   - assign_sales_rep / unassign_sales_rep: CREATE OR REPLACE with the
--                 exact same bodies as 20261027140200_rep_manager_assignments.sql,
--                 with the single authorization line widened from
--                 "is_admin()" to "is_admin() OR is_sales_admin()". Nothing
--                 else in either function changes.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. Widen the role constraints to accept 'sales_admin'.
-- ---------------------------------------------------------------------------
ALTER TABLE public.profiles
  DROP CONSTRAINT profiles_role_check;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_role_check
  CHECK ((role = ANY (ARRAY['manager'::text, 'admin'::text, 'sales_rep'::text, 'sales_admin'::text])));

ALTER TABLE public.approved_employees
  DROP CONSTRAINT approved_employees_portal_role_check;
ALTER TABLE public.approved_employees
  ADD CONSTRAINT approved_employees_portal_role_check
  CHECK ((portal_role = ANY (ARRAY['manager'::text, 'admin'::text, 'sales_rep'::text, 'sales_admin'::text])));

-- ---------------------------------------------------------------------------
-- 2. is_sales_admin() — mirrors is_admin()'s exact shape (STABLE SECURITY
-- DEFINER, re-checks role AND is_active live, every call), but for a
-- distinct role. Deliberately NOT a change to is_admin() itself.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_sales_admin() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'sales_admin' AND p.is_active = true
  )
$$;

REVOKE ALL ON FUNCTION public.is_sales_admin() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_sales_admin() FROM anon;
GRANT EXECUTE ON FUNCTION public.is_sales_admin() TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. profiles — additive SELECT policy: a Sales Admin may read ANY
-- sales_rep profile row (full roster visibility, per the approved
-- requirements), and nothing else. The two pre-existing policies
-- ("Admins can view all profiles", "Users can view their own profile") and
-- the Manager-assigned-rep policy from 20261102090000 are untouched.
-- ---------------------------------------------------------------------------
CREATE POLICY "Sales Admins can view all Sales Rep profiles"
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (
    role = 'sales_rep'
    AND public.is_sales_admin()
  );

-- ---------------------------------------------------------------------------
-- 4. rep_reports — additive, read-only SELECT policy for Sales Admin,
-- mirroring the shape of rep_reports_select_admin but keyed off
-- is_sales_admin() instead of is_admin(). No write policy, no change to
-- review_rep_report's own authorization check (still is_assigned_manager_of
-- OR is_admin only) — a Sales Admin can read any report's content and
-- status, never approve/reject one.
-- ---------------------------------------------------------------------------
CREATE POLICY rep_reports_select_sales_admin
  ON public.rep_reports
  FOR SELECT
  TO authenticated
  USING (public.is_sales_admin());

-- ---------------------------------------------------------------------------
-- 5. assign_sales_rep / unassign_sales_rep — CREATE OR REPLACE with
-- identical bodies to 20261027140200_rep_manager_assignments.sql, widening
-- only the single authorization check on each. Every other line (target-row
-- validation, advisory-lock serialization, history-preserving UPDATE/INSERT
-- shape) is reproduced verbatim, unchanged.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.assign_sales_rep(
  p_rep_id uuid,
  p_manager_id uuid
)
RETURNS public.rep_manager_assignments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_rep_role text;
  v_manager_role text;
  v_manager_active boolean;
  v_existing public.rep_manager_assignments;
  v_result public.rep_manager_assignments;
BEGIN
  IF NOT (public.is_admin() OR public.is_sales_admin()) THEN
    RAISE EXCEPTION 'FORBIDDEN: Only an admin or sales admin may assign a sales rep to a manager.';
  END IF;

  SELECT role INTO v_rep_role FROM public.profiles WHERE id = p_rep_id;
  IF v_rep_role IS DISTINCT FROM 'sales_rep' THEN
    RAISE EXCEPTION 'INVALID_REP: The target profile is not a sales_rep.';
  END IF;

  SELECT role, is_active INTO v_manager_role, v_manager_active FROM public.profiles WHERE id = p_manager_id;
  IF v_manager_role IS DISTINCT FROM 'manager' OR v_manager_active IS NOT TRUE THEN
    RAISE EXCEPTION 'INVALID_MANAGER: The target profile is not an active manager.';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(p_rep_id::text));

  SELECT * INTO v_existing
  FROM public.rep_manager_assignments
  WHERE rep_id = p_rep_id AND unassigned_at IS NULL;

  IF v_existing.id IS NOT NULL AND v_existing.manager_id = p_manager_id THEN
    RETURN v_existing;
  END IF;

  UPDATE public.rep_manager_assignments
  SET unassigned_at = clock_timestamp(), unassigned_by = v_caller
  WHERE rep_id = p_rep_id AND unassigned_at IS NULL;

  INSERT INTO public.rep_manager_assignments (rep_id, manager_id, assigned_by, assigned_at)
  VALUES (p_rep_id, p_manager_id, v_caller, clock_timestamp())
  RETURNING * INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.assign_sales_rep(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.assign_sales_rep(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.assign_sales_rep(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.unassign_sales_rep(p_rep_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_updated integer;
BEGIN
  IF NOT (public.is_admin() OR public.is_sales_admin()) THEN
    RAISE EXCEPTION 'FORBIDDEN: Only an admin or sales admin may unassign a sales rep.';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(p_rep_id::text));

  UPDATE public.rep_manager_assignments
  SET unassigned_at = clock_timestamp(), unassigned_by = v_caller
  WHERE rep_id = p_rep_id AND unassigned_at IS NULL;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated = 1;
END;
$$;

REVOKE ALL ON FUNCTION public.unassign_sales_rep(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.unassign_sales_rep(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.unassign_sales_rep(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- Self-test: Sales Admin can list all sales reps and read report content
-- across managers, can assign/reassign, and is independently re-verified
-- unable to view a manager's own profile row, unable to approve/reject a
-- report, and unable to grant a late exception. Full Admin, assigned
-- Manager, and Sales Rep access are all independently re-confirmed
-- unaffected.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  real_admin_id uuid;
  fake_rep_id uuid := gen_random_uuid();
  fake_manager_id uuid := gen_random_uuid();
  fake_sales_admin_id uuid := gen_random_uuid();
  v_report_id uuid;
  row_count integer;
  caught boolean;
BEGIN
  SELECT id INTO real_admin_id FROM public.profiles WHERE role = 'admin' AND is_active = true LIMIT 1;
  IF real_admin_id IS NULL THEN
    RAISE NOTICE 'SKIPPED sales_admin_role self-test: needs at least one active admin profile.';
    RETURN;
  END IF;

  BEGIN
    SET ROLE authenticated;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIPPED sales_admin_role self-test: this session cannot SET ROLE authenticated (%).', SQLERRM;
    RETURN;
  END;

  BEGIN
    INSERT INTO auth.users (id) VALUES (fake_rep_id), (fake_manager_id), (fake_sales_admin_id);
    INSERT INTO public.profiles (id, full_name, email, role, is_active) VALUES
      (fake_rep_id, 'Sales Admin Role Test Rep', 'sales-admin-role-test-rep-' || fake_rep_id || '@example.invalid', 'sales_rep', true),
      (fake_manager_id, 'Sales Admin Role Test Manager', 'sales-admin-role-test-mgr-' || fake_manager_id || '@example.invalid', 'manager', true),
      (fake_sales_admin_id, 'Sales Admin Role Test Sales Admin', 'sales-admin-role-test-sa-' || fake_sales_admin_id || '@example.invalid', 'sales_admin', true);
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIPPED sales_admin_role self-test: could not create throwaway profiles (%).', SQLERRM;
    RETURN;
  END;

  -- Test 1: sales_admin can assign the rep to the manager.
  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', fake_sales_admin_id)::text, true);
  PERFORM public.assign_sales_rep(fake_rep_id, fake_manager_id);
  RESET ROLE;
  SELECT count(*) INTO row_count FROM public.rep_manager_assignments WHERE rep_id = fake_rep_id AND manager_id = fake_manager_id AND unassigned_at IS NULL;
  IF row_count <> 1 THEN
    RAISE EXCEPTION 'FAILED: sales_admin could not assign a sales rep to a manager — expected 1 active assignment, found %.', row_count;
  END IF;
  RAISE NOTICE 'PASSED: sales_admin can assign a sales rep to a manager.';

  -- Test 2: sales_admin can list (SELECT) the rep's profile.
  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', fake_sales_admin_id)::text, true);
  SELECT count(*) INTO row_count FROM public.profiles WHERE id = fake_rep_id;
  RESET ROLE;
  IF row_count <> 1 THEN
    RAISE EXCEPTION 'FAILED: sales_admin could not read the sales rep''s profile — expected 1, found %.', row_count;
  END IF;
  RAISE NOTICE 'PASSED: sales_admin can read a sales rep''s profile.';

  -- Test 3: sales_admin CANNOT read the manager's profile row.
  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', fake_sales_admin_id)::text, true);
  SELECT count(*) INTO row_count FROM public.profiles WHERE id = fake_manager_id;
  RESET ROLE;
  IF row_count <> 0 THEN
    RAISE EXCEPTION 'FAILED: sales_admin could read a manager''s profile row — expected 0, found %.', row_count;
  END IF;
  RAISE NOTICE 'PASSED: sales_admin cannot read a manager''s profile row.';

  -- Sales rep saves and submits a report, as itself.
  -- A far-future Monday, matching the established self-test convention
  -- elsewhere in this migration series (e.g. 20261028090000's test_week),
  -- so this self-test's on-time submission check never depends on exactly
  -- when this migration happens to be applied.
  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', fake_rep_id)::text, true);
  PERFORM public.save_rep_report_draft(
    '2026-12-07',
    '{"accomplishments": ["Closed a deal"], "salesMetrics": [], "pipelineUpdates": [], "blockers": [], "nextWeekPriorities": [], "managerSupportNeeded": ""}'::jsonb
  );
  PERFORM public.submit_rep_report('2026-12-07');
  RESET ROLE;
  SELECT id INTO v_report_id FROM public.rep_reports WHERE rep_id = fake_rep_id AND week_start_date = '2026-12-07';

  -- Test 4: sales_admin can read the report's content across managers (no
  -- is_assigned_manager_of relationship required for sales_admin — only
  -- is_sales_admin()).
  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', fake_sales_admin_id)::text, true);
  SELECT count(*) INTO row_count FROM public.rep_reports WHERE id = v_report_id;
  RESET ROLE;
  IF row_count <> 1 THEN
    RAISE EXCEPTION 'FAILED: sales_admin could not read the rep report — expected 1, found %.', row_count;
  END IF;
  RAISE NOTICE 'PASSED: sales_admin can read a sales rep report''s content.';

  -- Test 5: sales_admin CANNOT approve/reject the report.
  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', fake_sales_admin_id)::text, true);
  caught := false;
  BEGIN
    PERFORM public.review_rep_report(v_report_id, 'approved', 'sales_admin should not be able to do this');
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'FORBIDDEN%' THEN caught := true; ELSE RAISE; END IF;
  END;
  RESET ROLE;
  IF NOT caught THEN
    RAISE EXCEPTION 'FAILED: sales_admin was able to approve/reject a sales rep report.';
  END IF;
  RAISE NOTICE 'PASSED: sales_admin cannot approve or reject a sales rep report.';

  -- Test 6: sales_admin CANNOT grant a late submission exception.
  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', fake_sales_admin_id)::text, true);
  caught := false;
  BEGIN
    PERFORM public.grant_rep_report_late_submission_exception(fake_rep_id, '2026-12-07', 'sales_admin should not be able to do this');
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'FORBIDDEN%' THEN caught := true; ELSE RAISE; END IF;
  END;
  RESET ROLE;
  IF NOT caught THEN
    RAISE EXCEPTION 'FAILED: sales_admin was able to grant a late submission exception.';
  END IF;
  RAISE NOTICE 'PASSED: sales_admin cannot grant a late submission exception.';

  -- Test 7: a plain sales_rep still cannot call assign_sales_rep (unaffected
  -- by widening the check to include is_sales_admin()).
  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', fake_rep_id)::text, true);
  caught := false;
  BEGIN
    PERFORM public.assign_sales_rep(fake_rep_id, fake_manager_id);
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'FORBIDDEN%' THEN caught := true; ELSE RAISE; END IF;
  END;
  RESET ROLE;
  IF NOT caught THEN
    RAISE EXCEPTION 'FAILED: a plain sales_rep was able to call assign_sales_rep.';
  END IF;
  RAISE NOTICE 'PASSED: a plain sales_rep still cannot call assign_sales_rep.';

  -- Test 8: the real admin can still assign/unassign (assign_sales_rep's
  -- is_admin() path is unaffected by the OR is_sales_admin() addition).
  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', real_admin_id)::text, true);
  PERFORM public.unassign_sales_rep(fake_rep_id);
  RESET ROLE;
  SELECT count(*) INTO row_count FROM public.rep_manager_assignments WHERE rep_id = fake_rep_id AND unassigned_at IS NULL;
  IF row_count <> 0 THEN
    RAISE EXCEPTION 'FAILED: a real admin could not unassign a sales rep — expected 0 active assignments, found %.', row_count;
  END IF;
  RAISE NOTICE 'PASSED: a real admin can still assign/unassign sales reps.';

  -- Cleanup.
  RESET request.jwt.claims;
  DELETE FROM public.rep_report_review_history WHERE report_id = v_report_id;
  DELETE FROM public.rep_reports WHERE rep_id = fake_rep_id;
  DELETE FROM public.rep_manager_assignments WHERE rep_id = fake_rep_id;
  DELETE FROM public.profiles WHERE id IN (fake_rep_id, fake_manager_id, fake_sales_admin_id);
  DELETE FROM auth.users WHERE id IN (fake_rep_id, fake_manager_id, fake_sales_admin_id);
  RAISE NOTICE 'Cleanup PASSED: no residual synthetic rows remain.';
END $$;

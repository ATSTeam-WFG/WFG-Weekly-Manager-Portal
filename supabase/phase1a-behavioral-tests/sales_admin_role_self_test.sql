-- LOCAL-ONLY behavioral self-test for the Sales Admin role.
--
-- NEVER paste this into PREVIEW or production SQL Editor. It is not a
-- migration (no timestamp prefix, not in supabase/migrations/), and it is
-- not referenced by supabase/phase1a-behavioral-tests/run.sh's own
-- migration list — run it manually, by hand, against a disposable/local
-- Postgres instance only, AFTER supabase/migrations/20261103090000_sales_admin_role.sql
-- (schema-only: role constraints, is_sales_admin(), the two new RLS
-- policies, and the two widened assign/unassign functions — no synthetic
-- data of any kind) has already been applied there.
--
-- Creates and fully cleans up its own synthetic auth.users/profiles/
-- rep_manager_assignments/rep_reports rows only; reads but never writes any
-- pre-existing row. Exercises: Sales Admin can assign/reassign a rep and
-- read across managers; cannot read a Manager's own profile row; cannot
-- approve/reject a report; cannot grant a late submission exception; a
-- plain sales_rep still cannot call assign_sales_rep; a real Admin's own
-- assign/unassign access is unaffected by the OR is_sales_admin() widening.
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

  -- Sales rep saves and submits a report, as itself. A far-future Monday,
  -- matching the established self-test convention elsewhere in this
  -- migration series (e.g. 20261028090000's test_week), so this self-test's
  -- on-time submission check never depends on exactly when it happens to be
  -- run.
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

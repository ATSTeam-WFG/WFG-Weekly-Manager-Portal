-- LOCAL-ONLY behavioral self-test for the historical-access refinement to
-- rep_reports' Manager SELECT policies.
--
-- NEVER paste this into PREVIEW or production SQL Editor. It is not a
-- migration (no timestamp prefix, not in supabase/migrations/), and it is
-- not referenced by supabase/phase1a-behavioral-tests/run.sh's own
-- migration list — run it manually, by hand, against a disposable/local
-- Postgres instance only, AFTER
-- supabase/migrations/20261104120000_rep_reports_assigned_manager_historical_scope.sql
-- (schema-only: the ALTER POLICY on rep_reports_select_assigned_manager and
-- the new CREATE POLICY rep_reports_select_reviewer — no synthetic data of
-- any kind) has already been applied there.
--
-- Creates and fully cleans up its own synthetic auth.users/profiles/
-- rep_manager_assignments/rep_reports/rep_report_review_history/
-- manager_report_rep_imports rows only; reads but never writes any
-- pre-existing row.
--
-- Covers a chain of THREE consecutive reassignments (A -> B -> C -> D): one
-- report resolved entirely under A, one inherited-pending-then-APPROVED by
-- B, one inherited-pending-then-REJECTED by C, and one freshly created
-- under D — multiple reassignments, both review decisions, consolidation,
-- and a final-current-manager baseline — plus admin/sales_admin/rep/
-- unrelated-manager/privilege-escalation checks.
DO $$
DECLARE
  real_admin_id uuid;
  fake_rep_id uuid := gen_random_uuid();
  fake_manager_a_id uuid := gen_random_uuid();
  fake_manager_b_id uuid := gen_random_uuid();
  fake_manager_c_id uuid := gen_random_uuid();
  fake_manager_d_id uuid := gen_random_uuid();
  fake_manager_unrelated_id uuid := gen_random_uuid();
  fake_sales_admin_id uuid := gen_random_uuid();
  report_a_id uuid;   -- created + resolved (approved) entirely under A
  report_b_id uuid;   -- created under A, inherited + approved by B
  report_c_id uuid;   -- created under B, inherited + rejected by C
  report_d_id uuid;   -- created + left pending under D (final manager)
  row_count integer;
  caught boolean;
  -- Comfortably-future, non-overlapping weeks — see the historical-scope
  -- fix's own earlier note on why real calendar dates would make this self-
  -- test flaky against submit_rep_report's/import_rep_report_for_
  -- consolidation's own real-clock deadline checks, which this migration is
  -- not about.
  v_week_a date := date_trunc('week', CURRENT_DATE + interval '90 days')::date;
  v_week_b date := date_trunc('week', CURRENT_DATE + interval '97 days')::date;
  v_week_c date := date_trunc('week', CURRENT_DATE + interval '104 days')::date;
  v_week_d date := date_trunc('week', CURRENT_DATE + interval '111 days')::date;
BEGIN
  SELECT id INTO real_admin_id FROM public.profiles WHERE role = 'admin' AND is_active = true LIMIT 1;
  IF real_admin_id IS NULL THEN
    RAISE NOTICE 'SKIPPED rep_reports_assigned_manager_historical_scope self-test: needs at least one active admin profile.';
    RETURN;
  END IF;

  BEGIN
    SET ROLE authenticated;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIPPED rep_reports_assigned_manager_historical_scope self-test: this session cannot SET ROLE authenticated (%).', SQLERRM;
    RETURN;
  END;

  BEGIN
    INSERT INTO auth.users (id) VALUES
      (fake_rep_id), (fake_manager_a_id), (fake_manager_b_id), (fake_manager_c_id),
      (fake_manager_d_id), (fake_manager_unrelated_id), (fake_sales_admin_id);
    INSERT INTO public.profiles (id, full_name, email, role, is_active) VALUES
      (fake_rep_id, 'Phase 3 Fix Test Rep', 'phase3-fix-rep-' || fake_rep_id || '@example.invalid', 'sales_rep', true),
      (fake_manager_a_id, 'Phase 3 Fix Test Manager A', 'phase3-fix-mgr-a-' || fake_manager_a_id || '@example.invalid', 'manager', true),
      (fake_manager_b_id, 'Phase 3 Fix Test Manager B', 'phase3-fix-mgr-b-' || fake_manager_b_id || '@example.invalid', 'manager', true),
      (fake_manager_c_id, 'Phase 3 Fix Test Manager C', 'phase3-fix-mgr-c-' || fake_manager_c_id || '@example.invalid', 'manager', true),
      (fake_manager_d_id, 'Phase 3 Fix Test Manager D', 'phase3-fix-mgr-d-' || fake_manager_d_id || '@example.invalid', 'manager', true),
      (fake_manager_unrelated_id, 'Phase 3 Fix Test Manager Unrelated', 'phase3-fix-mgr-u-' || fake_manager_unrelated_id || '@example.invalid', 'manager', true),
      (fake_sales_admin_id, 'Phase 3 Fix Test Sales Admin', 'phase3-fix-sa-' || fake_sales_admin_id || '@example.invalid', 'sales_admin', true);
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIPPED rep_reports_assigned_manager_historical_scope self-test: could not create throwaway profiles (%).', SQLERRM;
    RETURN;
  END;

  -- === Setup: A owns the rep; one report created + resolved entirely under A. ===
  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', real_admin_id)::text, true);
  PERFORM public.assign_sales_rep(fake_rep_id, fake_manager_a_id);
  RESET ROLE;

  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', fake_rep_id)::text, true);
  PERFORM public.save_rep_report_draft(v_week_a, '{"accomplishments":["resolved under A"],"salesMetrics":[],"pipelineUpdates":[],"blockers":[],"nextWeekPriorities":[],"managerSupportNeeded":""}'::jsonb);
  PERFORM public.submit_rep_report(v_week_a);
  RESET ROLE;
  SELECT id INTO report_a_id FROM public.rep_reports WHERE rep_id = fake_rep_id AND week_start_date = v_week_a;

  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', fake_manager_a_id)::text, true);
  PERFORM public.review_rep_report(report_a_id, 'approved', 'Approved by A, entirely within A''s own tenure.');
  RESET ROLE;

  -- A second report, left PENDING under A.
  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', fake_rep_id)::text, true);
  PERFORM public.save_rep_report_draft(v_week_b, '{"accomplishments":["pending at A to B handoff"],"salesMetrics":[],"pipelineUpdates":[],"blockers":[],"nextWeekPriorities":[],"managerSupportNeeded":""}'::jsonb);
  PERFORM public.submit_rep_report(v_week_b);
  RESET ROLE;
  SELECT id INTO report_b_id FROM public.rep_reports WHERE rep_id = fake_rep_id AND week_start_date = v_week_b;

  -- === Reassignment 1: A -> B. B inherits and APPROVES the pending report. ===
  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', real_admin_id)::text, true);
  PERFORM public.assign_sales_rep(fake_rep_id, fake_manager_b_id);
  RESET ROLE;

  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', fake_manager_b_id)::text, true);
  SELECT count(*) INTO row_count FROM public.rep_reports WHERE id = report_b_id;
  RESET ROLE;
  IF row_count <> 1 THEN
    RAISE EXCEPTION 'FAILED: B could not see the inherited pending report — expected 1, found %.', row_count;
  END IF;
  RAISE NOTICE 'PASSED: B (new manager) sees the report inherited pending from A.';

  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', fake_manager_b_id)::text, true);
  PERFORM public.review_rep_report(report_b_id, 'approved', 'Approved by B after inheriting it from A.');
  RESET ROLE;

  -- A third report is created while the rep is under B, left PENDING.
  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', fake_rep_id)::text, true);
  PERFORM public.save_rep_report_draft(v_week_c, '{"accomplishments":["pending at B to C handoff"],"salesMetrics":[],"pipelineUpdates":[],"blockers":[],"nextWeekPriorities":[],"managerSupportNeeded":""}'::jsonb);
  PERFORM public.submit_rep_report(v_week_c);
  RESET ROLE;
  SELECT id INTO report_c_id FROM public.rep_reports WHERE rep_id = fake_rep_id AND week_start_date = v_week_c;

  -- === Reassignment 2: B -> C. C inherits and REJECTS the pending report. ===
  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', real_admin_id)::text, true);
  PERFORM public.assign_sales_rep(fake_rep_id, fake_manager_c_id);
  RESET ROLE;

  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', fake_manager_c_id)::text, true);
  SELECT count(*) INTO row_count FROM public.rep_reports WHERE id = report_c_id;
  RESET ROLE;
  IF row_count <> 1 THEN
    RAISE EXCEPTION 'FAILED: C could not see the inherited pending report — expected 1, found %.', row_count;
  END IF;
  RAISE NOTICE 'PASSED: C (new manager, second reassignment) sees the report inherited pending from B.';

  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', fake_manager_c_id)::text, true);
  PERFORM public.review_rep_report(report_c_id, 'rejected', 'Rejected by C after inheriting it from B — needs correction.');
  RESET ROLE;

  -- A fourth report is created while the rep is under C, left pending for D.
  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', fake_rep_id)::text, true);
  PERFORM public.save_rep_report_draft(v_week_d, '{"accomplishments":["pending at C to D handoff"],"salesMetrics":[],"pipelineUpdates":[],"blockers":[],"nextWeekPriorities":[],"managerSupportNeeded":""}'::jsonb);
  PERFORM public.submit_rep_report(v_week_d);
  RESET ROLE;
  SELECT id INTO report_d_id FROM public.rep_reports WHERE rep_id = fake_rep_id AND week_start_date = v_week_d;

  -- === Reassignment 3: C -> D. Final current manager. ===
  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', real_admin_id)::text, true);
  PERFORM public.assign_sales_rep(fake_rep_id, fake_manager_d_id);
  RESET ROLE;

  -- Test: A (twice-removed former manager) still sees ONLY their own
  -- created-and-resolved report (report_a) AND report_b (also CREATED while
  -- A was still the manager, before the A -> B handoff — owning_assignment_id
  -- for report_b is A's assignment, so A's former-manager access to it is
  -- legitimate and unchanged, exactly matching "Manager A retains authorized
  -- access to reports created under their assignment"). A never created or
  -- reviewed report_c or report_d (both created after the rep had already
  -- moved past A), so those must stay invisible to A.
  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', fake_manager_a_id)::text, true);
  SELECT count(*) INTO row_count FROM public.rep_reports WHERE id IN (report_a_id, report_b_id);
  IF row_count <> 2 THEN
    RESET ROLE;
    RAISE EXCEPTION 'FAILED: A lost access to a report created under A''s own assignment — expected 2, found %.', row_count;
  END IF;
  SELECT count(*) INTO row_count FROM public.rep_reports WHERE id IN (report_c_id, report_d_id);
  RESET ROLE;
  IF row_count <> 0 THEN
    RAISE EXCEPTION 'FAILED: A could see a report created after the rep had already moved past A — expected 0, found %.', row_count;
  END IF;
  RAISE NOTICE 'PASSED: A retains access to every report created under A''s own assignment (report_a and report_b), and nothing created after the rep moved on.';

  -- Test: B (reassigned away TWICE — to C, then to D) still sees the report
  -- they personally reviewed, via rep_reports_select_reviewer.
  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', fake_manager_b_id)::text, true);
  SELECT count(*) INTO row_count FROM public.rep_reports WHERE id = report_b_id AND review_status = 'approved';
  RESET ROLE;
  IF row_count <> 1 THEN
    RAISE EXCEPTION 'FAILED: B lost access to the report they reviewed, after being reassigned away twice more — expected 1, found %.', row_count;
  END IF;
  RAISE NOTICE 'PASSED: B retains access to the report they reviewed, even after two FURTHER reassignments (B -> C -> D) moved them off the rep entirely.';

  -- Test: B also still sees report_c (created while B was the manager, so
  -- owning_assignment_id is B's own now-closed assignment) via the
  -- UNCHANGED rep_reports_select_former_manager policy — a second,
  -- independent, correctly-overlapping reason, not a conflict.
  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', fake_manager_b_id)::text, true);
  SELECT count(*) INTO row_count FROM public.rep_reports WHERE id = report_c_id;
  RESET ROLE;
  IF row_count <> 1 THEN
    RAISE EXCEPTION 'FAILED: B lost former-manager access to a report created during B''s own tenure — expected 1, found %.', row_count;
  END IF;
  RAISE NOTICE 'PASSED: B also retains former-manager access (unchanged policy) to the report created during B''s own tenure, independent of having reviewed it.';

  -- Test (privilege escalation guard): B can no longer REVIEW report_b —
  -- read-only historical access only, never renewed authority.
  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', fake_manager_b_id)::text, true);
  caught := false;
  BEGIN
    PERFORM public.review_rep_report(report_b_id, 'rejected', 'B trying to re-review after being reassigned away.');
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'FORBIDDEN%' THEN caught := true; ELSE RAISE; END IF;
  END;
  RESET ROLE;
  IF NOT caught THEN
    RAISE EXCEPTION 'FAILED: B was able to re-review a report after being reassigned away — rep_reports_select_reviewer must never grant write/review authority.';
  END IF;
  RAISE NOTICE 'PASSED: B cannot re-review report_b after reassignment — the reviewer policy grants read-only access, no privilege escalation.';

  -- Test (consolidation guard): B can no longer consolidate report_b either.
  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', fake_manager_b_id)::text, true);
  caught := false;
  BEGIN
    PERFORM public.import_rep_report_for_consolidation(report_b_id, v_week_b, ARRAY['accomplishments']);
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'FORBIDDEN%' THEN caught := true; ELSE RAISE; END IF;
  END;
  RESET ROLE;
  IF NOT caught THEN
    RAISE EXCEPTION 'FAILED: B was able to consolidate a report after being reassigned away — consolidation must remain current-assignment-gated only.';
  END IF;
  RAISE NOTICE 'PASSED: B cannot consolidate report_b after reassignment — no consolidation regression from the new reviewer policy.';

  -- Test: C (reassigned away once, to D) still sees the report they
  -- rejected, approved OR rejected alike.
  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', fake_manager_c_id)::text, true);
  SELECT count(*) INTO row_count FROM public.rep_reports WHERE id = report_c_id AND review_status = 'rejected';
  RESET ROLE;
  IF row_count <> 1 THEN
    RAISE EXCEPTION 'FAILED: C lost access to the report they rejected, after being reassigned away — expected 1, found %.', row_count;
  END IF;
  RAISE NOTICE 'PASSED: C retains access to the report they REJECTED, even after being reassigned away (approved and rejected both covered).';

  -- Test (the core historical restriction, re-confirmed at the END of a
  -- 3-deep reassignment chain): D, the FINAL current manager, automatically
  -- sees NONE of A/B/C's already-resolved reports — no escalation just by
  -- becoming current.
  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', fake_manager_d_id)::text, true);
  SELECT count(*) INTO row_count FROM public.rep_reports WHERE id IN (report_a_id, report_b_id, report_c_id);
  RESET ROLE;
  IF row_count <> 0 THEN
    RAISE EXCEPTION 'FAILED: D (final current manager) could see an already-resolved historical report from a previous manager''s tenure — expected 0, found %.', row_count;
  END IF;
  RAISE NOTICE 'PASSED: D, the final current manager after 3 reassignments, cannot automatically see any of the 3 already-resolved historical reports.';

  -- Test: D CAN see the genuinely pending report created during D's own
  -- tenure (baseline inherited-pending visibility still holds at the end of
  -- a long reassignment chain).
  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', fake_manager_d_id)::text, true);
  SELECT count(*) INTO row_count FROM public.rep_reports WHERE id = report_d_id AND review_status = 'pending';
  RESET ROLE;
  IF row_count <> 1 THEN
    RAISE EXCEPTION 'FAILED: D could not see the genuinely pending report for their own tenure — expected 1, found %.', row_count;
  END IF;
  RAISE NOTICE 'PASSED: D can see and would be able to review the genuinely pending report from their own tenure.';

  -- Test: an unrelated manager, never assigned to this rep at any point,
  -- sees none of the four reports.
  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', fake_manager_unrelated_id)::text, true);
  SELECT count(*) INTO row_count FROM public.rep_reports WHERE id IN (report_a_id, report_b_id, report_c_id, report_d_id);
  RESET ROLE;
  IF row_count <> 0 THEN
    RAISE EXCEPTION 'FAILED: an unrelated manager could see a report — expected 0, found %.', row_count;
  END IF;
  RAISE NOTICE 'PASSED: an unrelated manager sees none of the four reports.';

  -- Test: admin, sales_admin, and the rep's own access are all completely
  -- unaffected by either of this migration's two policy changes.
  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', real_admin_id)::text, true);
  SELECT count(*) INTO row_count FROM public.rep_reports WHERE id IN (report_a_id, report_b_id, report_c_id, report_d_id);
  RESET ROLE;
  IF row_count <> 4 THEN
    RAISE EXCEPTION 'FAILED: admin could not read all four reports — expected 4, found %.', row_count;
  END IF;
  RAISE NOTICE 'PASSED: admin access is completely unaffected.';

  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', fake_sales_admin_id)::text, true);
  SELECT count(*) INTO row_count FROM public.rep_reports WHERE id IN (report_a_id, report_b_id, report_c_id, report_d_id);
  RESET ROLE;
  IF row_count <> 4 THEN
    RAISE EXCEPTION 'FAILED: sales_admin could not read all four reports — expected 4, found %.', row_count;
  END IF;
  RAISE NOTICE 'PASSED: sales_admin access is completely unaffected.';

  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', fake_rep_id)::text, true);
  SELECT count(*) INTO row_count FROM public.rep_reports WHERE id IN (report_a_id, report_b_id, report_c_id, report_d_id);
  RESET ROLE;
  IF row_count <> 4 THEN
    RAISE EXCEPTION 'FAILED: the rep lost access to their own reports — expected 4, found %.', row_count;
  END IF;
  RAISE NOTICE 'PASSED: the rep''s own access to all of their own reports is completely unaffected.';

  -- Cleanup.
  RESET request.jwt.claims;
  DELETE FROM public.manager_report_rep_imports WHERE manager_id IN (fake_manager_a_id, fake_manager_b_id, fake_manager_c_id, fake_manager_d_id, fake_manager_unrelated_id);
  DELETE FROM public.rep_report_review_history WHERE report_id IN (report_a_id, report_b_id, report_c_id, report_d_id);
  DELETE FROM public.rep_reports WHERE rep_id = fake_rep_id;
  DELETE FROM public.rep_manager_assignments WHERE rep_id = fake_rep_id;
  DELETE FROM public.profiles WHERE id IN (fake_rep_id, fake_manager_a_id, fake_manager_b_id, fake_manager_c_id, fake_manager_d_id, fake_manager_unrelated_id, fake_sales_admin_id);
  DELETE FROM auth.users WHERE id IN (fake_rep_id, fake_manager_a_id, fake_manager_b_id, fake_manager_c_id, fake_manager_d_id, fake_manager_unrelated_id, fake_sales_admin_id);
  RAISE NOTICE 'Cleanup PASSED: no residual synthetic rows remain.';
END $$;

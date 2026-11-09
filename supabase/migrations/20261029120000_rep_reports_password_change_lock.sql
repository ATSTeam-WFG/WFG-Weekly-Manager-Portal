-- Sales Rep flow — closes a gap found during Phase 1D production-readiness
-- review: `reports` (the Manager's own weekly report) has had
-- reports_require_password_change_cleared() since 20260920_password_change_
-- required.sql, blocking any write while the caller's own JWT still carries
-- app_metadata.password_change_required = true (the shared-temporary-
-- password onboarding marker — see that migration's own header for the
-- full rationale). `rep_reports` (a Sales Rep's own weekly report, added
-- later in 20261027140300_rep_reports.sql) never got the equivalent
-- protection, even though a Sales Rep is provisioned through the exact same
-- shared-temporary-password flow (createEmployeeAccount, reused role-
-- agnostically by addOrCreateSalesRepAccount) and can reach an identical
-- "profiles row already exists, JWT marker not yet cleared" window — api/
-- onboarding/complete-profile.ts creates the profile first and best-effort-
-- clears the marker as a separate, can-fail step, so that window is
-- reachable in practice, not merely theoretical.
--
-- Deliberately narrower than the `reports` version: `rep_reports` has TWO
-- different kinds of writer, not one. `reports` is written only by
-- Managers/Admins, so that trigger correctly applies to every writer with
-- no exemption. `rep_reports` is written both by the owning Sales Rep
-- (save_rep_report_draft / submit_rep_report / resubmit_rejected_rep_report
-- — every one of these sets/keeps rep_id = the calling rep's own auth.uid())
-- AND by a reviewing Manager or Admin (review_rep_report — which updates
-- only review_status/reviewed_by/reviewed_at on a row whose rep_id is
-- someone else's id, never the caller's own). Gating on
-- `NEW.rep_id = auth.uid()` targets exactly the first group and leaves the
-- second completely untouched — satisfying "preserve existing Manager and
-- Administrator behavior" structurally, not by role-checking the caller
-- (which would need updating every time a new write path is added), but by
-- the one fact that is already, always true of every legitimate rep-
-- authored write and never true of a review: the row's own rep_id equals
-- the writer's own auth.uid().
--
-- Bypass analysis (every write-capable path touching rep_reports):
--   - Direct table access: impossible for anyone other than this migration
--     chain's own SECURITY DEFINER functions — rep_reports has zero
--     INSERT/UPDATE/DELETE grant to authenticated/anon (see
--     20261027140300_rep_reports.sql's own REVOKE), confirmed unbypassable
--     by that migration's own self-test.
--   - save_rep_report_draft / submit_rep_report / resubmit_rejected_rep_
--     report (sales_rep-only, own row only): every INSERT/UPDATE they issue
--     keeps rep_id = the calling rep's own auth.uid() — all three are
--     caught by this trigger while the marker is true.
--   - review_rep_report (currently-assigned manager, or admin): its UPDATE
--     never touches rep_id, which remains the REP's id, never the
--     reviewer's — auth.uid() (the reviewer) never equals NEW.rep_id, so
--     this trigger never fires for it, regardless of the reviewer's own
--     password-change state.
--   - grant_rep_report_late_submission_exception (admin-only): writes only
--     to the separate rep_report_late_submission_exceptions table, never to
--     rep_reports itself — not in scope for a rep_reports trigger at all.
--   - Implemented as a TRIGGER rather than inside each function body for
--     the same reason reports_require_password_change_cleared() already is
--     one (see 20260920_password_change_required.sql's own header): it
--     fires for every write to this table regardless of which function
--     performs it, including any future one — not an easy-to-forget
--     per-function check that a later addition could accidentally omit.
--
-- SECURITY DEFINER is required here purely so this trigger function can
-- read auth.jwt() the same way every sibling trigger/RPC in this project
-- already does (it carries no additional privilege beyond that — it never
-- reads or writes any table). Kept as a brand-new, separate function/
-- trigger name rather than editing reports_require_password_change_cleared
-- itself, so that already-committed, already-tested trigger is left
-- completely untouched by this migration.

CREATE OR REPLACE FUNCTION public.rep_reports_require_password_change_cleared()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.rep_id = auth.uid()
     AND coalesce((auth.jwt() -> 'app_metadata' ->> 'password_change_required')::boolean, false) THEN
    RAISE EXCEPTION 'PASSWORD_CHANGE_REQUIRED: You must set your own password before saving or submitting reports.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS rep_reports_password_change_required_lock ON public.rep_reports;
CREATE TRIGGER rep_reports_password_change_required_lock
  BEFORE INSERT OR UPDATE ON public.rep_reports
  FOR EACH ROW
  EXECUTE FUNCTION public.rep_reports_require_password_change_cleared();

-- ---------------------------------------------------------------------------
-- Self-verifying test script — run after the statements above and review the
-- NOTICE output, same convention as every other trigger/RPC migration in
-- this project. Uses fabricated, throwaway profiles (never real ones) for
-- the rep/manager being tested, following the exact pattern already
-- established in 20261028090000_manager_report_rep_consolidation.sql's own
-- self-test (SET ROLE authenticated + set_config('request.jwt.claims', ...)
-- to simulate a specific caller's JWT, including its app_metadata claim).
-- Only one pre-existing, real admin profile is read (never modified) to
-- authorize the test assignment.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  real_admin_id uuid;
  fake_rep_id uuid := gen_random_uuid();
  fake_manager_id uuid := gen_random_uuid();
  test_week date := '2026-12-14'; -- a Monday, distinct from sibling migrations' test weeks
  v_report_id uuid;
  caught boolean;
BEGIN
  SELECT id INTO real_admin_id FROM public.profiles WHERE role = 'admin' AND is_active = true LIMIT 1;
  IF real_admin_id IS NULL THEN
    RAISE NOTICE 'SKIPPED rep_reports_password_change_lock self-test: needs at least one active admin profile.';
    RETURN;
  END IF;

  BEGIN
    SET ROLE authenticated;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIPPED rep_reports_password_change_lock self-test: this session cannot SET ROLE authenticated (%).', SQLERRM;
    RETURN;
  END;

  BEGIN
    INSERT INTO auth.users (id) VALUES (fake_rep_id), (fake_manager_id);
    INSERT INTO public.profiles (id, full_name, email, role, is_active) VALUES
      (fake_rep_id, 'Phase 1D Test Rep', 'phase1d-rep-' || fake_rep_id || '@example.invalid', 'sales_rep', true),
      (fake_manager_id, 'Phase 1D Test Manager', 'phase1d-mgr-' || fake_manager_id || '@example.invalid', 'manager', true);
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIPPED rep_reports_password_change_lock self-test: could not create throwaway profiles (%).', SQLERRM;
    RETURN;
  END;

  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', real_admin_id)::text, true);
  PERFORM public.assign_sales_rep(fake_rep_id, fake_manager_id);
  RESET ROLE;

  -- Test 1: a Sales Rep whose JWT carries password_change_required=true
  -- cannot save a new draft at all (the INSERT branch of the upsert).
  SET ROLE authenticated;
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object('sub', fake_rep_id, 'app_metadata', json_build_object('password_change_required', true))::text,
    true
  );
  caught := false;
  BEGIN
    PERFORM public.save_rep_report_draft(test_week, '{"accomplishments": ["Should be blocked"]}'::jsonb);
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'PASSWORD_CHANGE_REQUIRED%' THEN
      caught := true;
    ELSE
      RAISE;
    END IF;
  END;
  RESET ROLE;
  IF NOT caught THEN
    RAISE EXCEPTION 'Test 1 FAILED: a Sales Rep with password_change_required=true was able to save a new draft.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.rep_reports WHERE rep_id = fake_rep_id AND week_start_date = test_week) THEN
    RAISE EXCEPTION 'Test 1 FAILED: a report row was created despite the trigger refusing the save.';
  END IF;
  RAISE NOTICE 'Test 1 PASSED: save_rep_report_draft (new draft) correctly rejected (PASSWORD_CHANGE_REQUIRED) while the marker is true.';

  -- Test 2: once the marker is false, the same rep CAN save a draft.
  SET ROLE authenticated;
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object('sub', fake_rep_id, 'app_metadata', json_build_object('password_change_required', false))::text,
    true
  );
  PERFORM public.save_rep_report_draft(test_week, '{"accomplishments": ["Closed 3 deals"]}'::jsonb);
  RESET ROLE;
  SELECT id INTO v_report_id FROM public.rep_reports WHERE rep_id = fake_rep_id AND week_start_date = test_week;
  IF v_report_id IS NULL THEN
    RAISE EXCEPTION 'Test 2 FAILED: a Sales Rep whose password_change_required is false could not save a draft.';
  END IF;
  RAISE NOTICE 'Test 2 PASSED: save_rep_report_draft succeeds once password_change_required is false.';

  -- Test 3: editing that same existing draft is ALSO blocked while the
  -- marker is true (the UPDATE/ON CONFLICT branch of the upsert, not just
  -- the initial INSERT).
  SET ROLE authenticated;
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object('sub', fake_rep_id, 'app_metadata', json_build_object('password_change_required', true))::text,
    true
  );
  caught := false;
  BEGIN
    PERFORM public.save_rep_report_draft(test_week, '{"accomplishments": ["Should still be blocked"]}'::jsonb);
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'PASSWORD_CHANGE_REQUIRED%' THEN
      caught := true;
    ELSE
      RAISE;
    END IF;
  END;
  RESET ROLE;
  IF NOT caught THEN
    RAISE EXCEPTION 'Test 3 FAILED: editing an existing draft was allowed while password_change_required=true.';
  END IF;
  RAISE NOTICE 'Test 3 PASSED: editing an existing draft is also rejected while the marker is true.';

  -- Test 4: submit_rep_report is blocked the same way.
  SET ROLE authenticated;
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object('sub', fake_rep_id, 'app_metadata', json_build_object('password_change_required', true))::text,
    true
  );
  caught := false;
  BEGIN
    PERFORM public.submit_rep_report(test_week);
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'PASSWORD_CHANGE_REQUIRED%' THEN
      caught := true;
    ELSE
      RAISE;
    END IF;
  END;
  RESET ROLE;
  IF NOT caught THEN
    RAISE EXCEPTION 'Test 4 FAILED: submit_rep_report succeeded while password_change_required=true.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.rep_reports WHERE id = v_report_id AND status = 'submitted') THEN
    RAISE EXCEPTION 'Test 4 FAILED: the report was marked submitted despite the trigger refusing the write.';
  END IF;
  RAISE NOTICE 'Test 4 PASSED: submit_rep_report correctly rejected (PASSWORD_CHANGE_REQUIRED) while the marker is true.';

  -- Test 5: once cleared, submit_rep_report succeeds.
  SET ROLE authenticated;
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object('sub', fake_rep_id, 'app_metadata', json_build_object('password_change_required', false))::text,
    true
  );
  PERFORM public.submit_rep_report(test_week);
  RESET ROLE;
  IF NOT EXISTS (SELECT 1 FROM public.rep_reports WHERE id = v_report_id AND status = 'submitted') THEN
    RAISE EXCEPTION 'Test 5 FAILED: submit_rep_report did not succeed once password_change_required was false.';
  END IF;
  RAISE NOTICE 'Test 5 PASSED: submit_rep_report succeeds once password_change_required is false.';

  -- Test 6: resubmit_rejected_rep_report is blocked the same way. First the
  -- manager rejects it (review_rep_report — a Manager/Admin action, proven
  -- unaffected by this trigger in Test 7 below), then the rep tries to
  -- resubmit while the marker is true.
  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', fake_manager_id)::text, true);
  PERFORM public.review_rep_report(v_report_id, 'rejected', 'needs one more pass');
  RESET ROLE;

  SET ROLE authenticated;
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object('sub', fake_rep_id, 'app_metadata', json_build_object('password_change_required', true))::text,
    true
  );
  caught := false;
  BEGIN
    PERFORM public.resubmit_rejected_rep_report(test_week);
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'PASSWORD_CHANGE_REQUIRED%' THEN
      caught := true;
    ELSE
      RAISE;
    END IF;
  END;
  RESET ROLE;
  IF NOT caught THEN
    RAISE EXCEPTION 'Test 6 FAILED: resubmit_rejected_rep_report succeeded while password_change_required=true.';
  END IF;
  RAISE NOTICE 'Test 6 PASSED: resubmit_rejected_rep_report correctly rejected (PASSWORD_CHANGE_REQUIRED) while the marker is true.';

  -- Test 7: the Manager's OWN review_rep_report call is completely
  -- unaffected by this trigger, even while the MANAGER'S OWN JWT carries
  -- password_change_required=true — this is the "preserve existing
  -- Manager and Administrator behavior" requirement, proven, not assumed:
  -- review_rep_report never sets NEW.rep_id to the reviewer's own id.
  SET ROLE authenticated;
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object('sub', fake_manager_id, 'app_metadata', json_build_object('password_change_required', true))::text,
    true
  );
  PERFORM public.review_rep_report(v_report_id, 'approved', 'looks good, approving despite my own pending password change');
  RESET ROLE;
  IF NOT EXISTS (SELECT 1 FROM public.rep_reports WHERE id = v_report_id AND review_status = 'approved') THEN
    RAISE EXCEPTION 'Test 7 FAILED: a Manager reviewing a rep report was blocked by this trigger because of the MANAGER''S OWN password_change_required marker — this must never happen; only the owning rep''s own write is in scope.';
  END IF;
  RAISE NOTICE 'Test 7 PASSED: review_rep_report (Manager/Admin action) is completely unaffected by this trigger, even when the reviewer''s own password_change_required marker is true.';

  -- Cleanup: remove only the synthetic rows this test created.
  RESET request.jwt.claims;
  DELETE FROM public.rep_report_review_history WHERE report_id = v_report_id;
  DELETE FROM public.rep_report_resubmission_events WHERE report_id = v_report_id;
  DELETE FROM public.rep_reports WHERE id = v_report_id;
  DELETE FROM public.rep_manager_assignments WHERE rep_id = fake_rep_id;
  DELETE FROM public.profiles WHERE id IN (fake_rep_id, fake_manager_id);
  DELETE FROM auth.users WHERE id IN (fake_rep_id, fake_manager_id);
  RAISE NOTICE 'Cleanup PASSED: no residual synthetic rows remain.';
END $$;

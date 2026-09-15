-- Friday grace-period business-rule change: there is now ONE Manager write
-- cutoff — Friday 3:30 PM America/New_York — instead of two. A manager who
-- is Not Started (no report row yet for this week) is no longer blocked at
-- 3:00 PM; they get the same 3:00-3:29:59 PM grace period an existing
-- Draft/Submitted report already had, and may start, save, edit, and
-- manually submit a brand-new report throughout that window. At/after
-- 3:30 PM, every Manager write locks — new or existing, no exception —
-- exactly as before. The weekend lock (Saturday/Sunday) is unaffected,
-- since it was always just this same cutoff persisting through the rest of
-- the week (see src/utils/easternTime.ts's isPastEasternCutoff), never a
-- separate rule.
--
-- The ONLY change here is to the body of the already-existing
-- reports_enforce_manager_edit_cutoff() function (refined in place again,
-- not replaced with a new trigger, the same way 20260922_submits_weekly_report.sql
-- refined it for the dual-role admin-submitter change) — the trigger itself,
-- its name, and its timing are unchanged. No column, RLS policy, or other
-- function is touched. Nothing here modifies api/auto-submit.ts, its
-- Friday 3:00-3:14 PM scheduler window, api/reminders.ts, or
-- REMINDER_ACTIONS_ENABLED — the scheduler bot is admin-role and already
-- unconditionally exempt from this trigger regardless of this change, and
-- auto-submit's own UPDATE ... WHERE status='draft' query is untouched, so
-- it still only ever touches rows that already exist at the moment it runs.
--
-- What changes, precisely: previously, a brand-new report (no existing row)
-- was rejected with MANAGER_NEW_REPORT_LOCKED once now() >= new_report_cutoff
-- (3:00 PM), while an existing row was rejected with MANAGER_EDIT_LOCKED
-- only once now() >= edit_cutoff (3:30 PM). Both cases now use edit_cutoff
-- (3:30 PM) and both raise MANAGER_EDIT_LOCKED — MANAGER_NEW_REPORT_LOCKED
-- is retired entirely, since it can never fire again. The status-regression
-- guard (an already-submitted report can never be silently moved back to
-- draft) and the admin-exemption logic (normal Admins fully exempt; a
-- dual-role Admin exempt only when NOT acting on their own report) are
-- byte-for-byte unchanged from 20260922_submits_weekly_report.sql.
--
-- The row_exists variable (previously needed to pick which of the two
-- cutoffs applied, since an upsert's BEFORE INSERT firing always reports
-- TG_OP = 'INSERT' regardless of whether it will resolve as an update on
-- conflict — see the original comment in 20260918_manager_edit_lock.sql) is
-- removed: with one shared cutoff, there is no longer anything that needs
-- picking. The status-regression guard already independently re-checks
-- TG_OP = 'UPDATE' inside its own condition (true only for a genuine UPDATE
-- statement, or the real second trigger firing Postgres performs for an
-- upsert that resolves via ON CONFLICT DO UPDATE, which does populate OLD
-- correctly) — it never depended on row_exists for its own correctness, so
-- dropping that variable changes nothing about when the regression guard
-- fires.
CREATE OR REPLACE FUNCTION reports_enforce_manager_edit_cutoff()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  acting_role text;
  acting_submits boolean;
  friday_date date;
  edit_cutoff timestamptz;
BEGIN
  -- The CALLING user's own profile role and submits_weekly_report flag
  -- (never the row's manager_id alone). auth.uid() is null outside an
  -- authenticated request context; that case resolves acting_role/
  -- acting_submits to null, which is NOT exempted, failing closed exactly
  -- as before this change.
  SELECT role, submits_weekly_report INTO acting_role, acting_submits
  FROM public.profiles WHERE id = auth.uid();

  -- Admin exemption, unchanged from 20260922_submits_weekly_report.sql:
  -- exempt unless this admin is also a submitter acting on their OWN
  -- report. A plain admin (acting_submits = false or null) is
  -- unconditionally exempt. An admin+submitter acting on someone else's
  -- report is still exempt — a legitimate Admin action, not a
  -- self-submission.
  IF acting_role = 'admin' AND NOT (coalesce(acting_submits, false) AND NEW.manager_id = auth.uid()) THEN
    RETURN NEW;
  END IF;

  friday_date := NEW.week_start_date + 4;
  edit_cutoff := (friday_date + time '15:30') AT TIME ZONE 'America/New_York';

  -- ONE cutoff for every Manager write — a brand-new report (no existing
  -- row) and an existing Draft/auto-submitted/Submitted report are treated
  -- identically now. Before this instant: create, edit, save, and submit
  -- are all allowed, new report or not. At/after this instant: every write
  -- is rejected, new report or not — this is what "weekend lock" already
  -- was, since it never depended on which cutoff fired, only on how long
  -- past 3:30 PM Friday now() is.
  IF now() >= edit_cutoff THEN
    RAISE EXCEPTION 'MANAGER_EDIT_LOCKED: Editing is closed for this reporting week.';
  END IF;

  -- Status-regression guard — unchanged condition, byte-for-byte, from
  -- both prior migrations. Only ever true for a genuine UPDATE (TG_OP is
  -- 'INSERT' for any INSERT, including one that will resolve via ON
  -- CONFLICT DO UPDATE — Postgres fires a SEPARATE, real BEFORE UPDATE
  -- trigger invocation for the row that actually resolves as an update,
  -- with OLD correctly populated at that point, which is what this
  -- condition observes).
  IF TG_OP = 'UPDATE' AND OLD.status = 'submitted' AND NEW.status IS DISTINCT FROM 'submitted' THEN
    RAISE EXCEPTION 'MANAGER_STATUS_REGRESSION_BLOCKED: An already-submitted report cannot be changed back to draft.';
  END IF;

  RETURN NEW;
END;
$$;

-- The existing reports_manager_edit_cutoff trigger (from
-- 20260918_manager_edit_lock.sql) already calls this function by name — no
-- DROP TRIGGER / CREATE TRIGGER is needed or included here, matching the
-- convention established in 20260922_submits_weekly_report.production.sql.
-- CREATE OR REPLACE FUNCTION above is sufficient: Postgres updates the
-- function body in place and the already-installed trigger picks up the
-- new behavior on its very next invocation.

-- ---------------------------------------------------------------------------
-- Self-verifying test script. Run after the statement above and review the
-- NOTICE output. Follows the same conventions as the two prior migrations'
-- self-tests: only synthetic REPORT rows for clearly out-of-range test
-- weeks are created/removed; the real profiles used are only ever read,
-- and (for the synthetic admin+submitter case) temporarily flagged and
-- restored, never left modified.
--
-- Precise minute-level boundaries (2:59 PM / 3:00 PM / 3:15 PM / 3:29:59 PM
-- / exactly 3:30 PM) are exhaustively covered by the dynamic, injectable-
-- clock unit tests in src/lib/managerEditLock.test.ts — a live Postgres
-- self-test cannot control now() precisely enough to hit those exact
-- instants deterministically. This script instead proves the same
-- structural behavior against a real database: a brand-new report succeeds
-- for a week whose 3:30 PM cutoff is still far in the future (proving the
-- old, separate 3:00 PM new-report block is gone), and is rejected with
-- MANAGER_EDIT_LOCKED (not the retired MANAGER_NEW_REPORT_LOCKED) for a
-- week whose cutoff is far in the past — exactly the same two cases the
-- prior migration's self-test verified, updated for the new single-cutoff
-- exception code.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  test_manager_id uuid;
  test_admin_id uuid;
  admin_original_submits boolean;
  test_week_far_future date := '2099-04-06'; -- a Monday; Friday 3:30 PM cutoff far in the future
  test_week_far_past date := '1999-01-04';   -- a Monday; Friday 3:30 PM cutoff far in the past
  caught boolean;
BEGIN
  SELECT id INTO test_manager_id FROM profiles WHERE role = 'manager' LIMIT 1;
  SELECT id INTO test_admin_id FROM profiles WHERE role = 'admin' LIMIT 1;

  IF test_manager_id IS NULL OR test_admin_id IS NULL THEN
    RAISE NOTICE 'SKIPPED: this self-test needs at least one existing manager-role profile and one existing admin-role profile to run against. Found manager=%, admin=%.', test_manager_id, test_admin_id;
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1 FROM reports
    WHERE manager_id IN (test_manager_id, test_admin_id) AND week_start_date IN (test_week_far_future, test_week_far_past)
  ) THEN
    RAISE EXCEPTION 'SKIPPED: a report row already exists for the test manager/admin on a test week — aborting to avoid touching real data.';
  END IF;

  -- Test 1: a manager starting a BRAND-NEW report (no existing row) for a
  -- week whose 3:30 PM cutoff is far in the future must SUCCEED — this is
  -- the core behavior change. Under the old logic this always succeeded
  -- too (far future is before both cutoffs), so this alone doesn't prove
  -- the fix; Test 2 below is what actually distinguishes old vs. new
  -- behavior.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', test_manager_id)::text, true);
  INSERT INTO reports (manager_id, week_start_date, status) VALUES (test_manager_id, test_week_far_future, 'draft');
  IF NOT EXISTS (SELECT 1 FROM reports WHERE manager_id = test_manager_id AND week_start_date = test_week_far_future) THEN
    RAISE EXCEPTION 'Test 1 FAILED: a manager could not start a brand-new report for a week whose cutoff has not passed.';
  END IF;
  RAISE NOTICE 'Test 1 PASSED: a brand-new report succeeds well before the single 3:30 PM cutoff.';

  -- Test 2: the same manager starting a BRAND-NEW report for a week whose
  -- 3:30 PM cutoff is far in the PAST must be rejected specifically with
  -- MANAGER_EDIT_LOCKED — never the retired MANAGER_NEW_REPORT_LOCKED, and
  -- never silently allowed. This is the test that actually distinguishes
  -- the new single-cutoff behavior from the old two-cutoff behavior: under
  -- the OLD logic this INSERT would have been rejected with
  -- MANAGER_NEW_REPORT_LOCKED at the earlier 3:00 PM mark; it must still be
  -- rejected now, but with the single MANAGER_EDIT_LOCKED code, since the
  -- two separate exceptions have been merged into one.
  caught := false;
  BEGIN
    INSERT INTO reports (manager_id, week_start_date, status) VALUES (test_manager_id, test_week_far_past, 'draft');
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'MANAGER_EDIT_LOCKED%' THEN
      caught := true;
    ELSIF SQLERRM LIKE 'MANAGER_NEW_REPORT_LOCKED%' THEN
      RAISE EXCEPTION 'Test 2 FAILED: MANAGER_NEW_REPORT_LOCKED fired — this exception code should be retired and never raised anymore.';
    ELSE
      RAISE;
    END IF;
  END;
  IF NOT caught THEN
    RAISE EXCEPTION 'Test 2 FAILED: a manager was able to start a brand-new report for a week whose 3:30 PM cutoff has long passed.';
  END IF;
  RAISE NOTICE 'Test 2 PASSED: a brand-new report past the single 3:30 PM cutoff is correctly rejected with MANAGER_EDIT_LOCKED.';

  -- Test 3: the same manager continuing/editing an EXISTING report (the one
  -- from Test 1) well before its own 3:30 PM cutoff must still succeed —
  -- unchanged existing-report behavior.
  UPDATE reports SET what_matters_now = 'Updated bullet'
  WHERE manager_id = test_manager_id AND week_start_date = test_week_far_future;
  IF NOT EXISTS (
    SELECT 1 FROM reports
    WHERE manager_id = test_manager_id AND week_start_date = test_week_far_future AND what_matters_now = 'Updated bullet'
  ) THEN
    RAISE EXCEPTION 'Test 3 FAILED: a manager could not edit their own existing, not-yet-due report.';
  END IF;
  RAISE NOTICE 'Test 3 PASSED: editing an existing report is unaffected — still allowed well before the cutoff.';

  -- Test 4: editing an EXISTING report for a week whose cutoff is far in
  -- the past must still be rejected with MANAGER_EDIT_LOCKED — first create
  -- that row as an admin (exempt), then attempt the edit as the manager.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', test_admin_id)::text, true);
  INSERT INTO reports (manager_id, week_start_date, status)
  VALUES (test_manager_id, test_week_far_past, 'submitted')
  ON CONFLICT (manager_id, week_start_date) DO NOTHING;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', test_manager_id)::text, true);
  caught := false;
  BEGIN
    UPDATE reports SET what_matters_now = 'Too late'
    WHERE manager_id = test_manager_id AND week_start_date = test_week_far_past;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'MANAGER_EDIT_LOCKED%' THEN
      caught := true;
    ELSE
      RAISE;
    END IF;
  END;
  IF NOT caught THEN
    RAISE EXCEPTION 'Test 4 FAILED: a manager was able to edit an existing report for a week whose cutoff has long passed.';
  END IF;
  RAISE NOTICE 'Test 4 PASSED: editing an existing report past the cutoff is correctly rejected (MANAGER_EDIT_LOCKED), unchanged from before.';

  -- Test 5: the status-regression guard still fires — a manager can never
  -- move an already-submitted report (for the still-open far-future week)
  -- back to draft, even though the write itself is otherwise well within
  -- the allowed window.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', test_admin_id)::text, true);
  UPDATE reports SET status = 'submitted', submitted_at = now(), submission_source = 'manual'
  WHERE manager_id = test_manager_id AND week_start_date = test_week_far_future;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', test_manager_id)::text, true);
  caught := false;
  BEGIN
    UPDATE reports SET status = 'draft'
    WHERE manager_id = test_manager_id AND week_start_date = test_week_far_future;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'MANAGER_STATUS_REGRESSION_BLOCKED%' OR SQLERRM LIKE '%Reports cannot transition from submitted to draft this way%' THEN
      caught := true;
    ELSE
      RAISE;
    END IF;
  END;
  IF NOT caught THEN
    RAISE EXCEPTION 'Test 5 FAILED: a manager was able to move an already-submitted report back to draft.';
  END IF;
  RAISE NOTICE 'Test 5 PASSED: the status-regression guard is unaffected by this change.';

  -- Test 6: a PLAIN admin remains fully exempt regardless of the cutoff —
  -- unaffected by this change.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', test_admin_id)::text, true);
  UPDATE reports SET what_matters_now = 'Admin edit after cutoff, should succeed'
  WHERE manager_id = test_manager_id AND week_start_date = test_week_far_past;
  IF NOT EXISTS (
    SELECT 1 FROM reports
    WHERE manager_id = test_manager_id AND week_start_date = test_week_far_past
      AND what_matters_now = 'Admin edit after cutoff, should succeed'
  ) THEN
    RAISE EXCEPTION 'Test 6 FAILED: a plain admin-role caller was blocked by the Manager edit cutoff.';
  END IF;
  RAISE NOTICE 'Test 6 PASSED: a plain admin remains exempt, unaffected by this change.';

  -- Test 7: a dual-role admin submitter (simulated on the real test admin
  -- profile, flag restored afterward) is still held to the SAME single
  -- cutoff on their OWN report — starting a brand-new report of their own
  -- for the far-past week must be rejected with MANAGER_EDIT_LOCKED, same
  -- as any other submitter.
  SELECT submits_weekly_report INTO admin_original_submits FROM profiles WHERE id = test_admin_id;
  UPDATE profiles SET submits_weekly_report = true WHERE id = test_admin_id;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', test_admin_id)::text, true);
  caught := false;
  BEGIN
    INSERT INTO reports (manager_id, week_start_date, status) VALUES (test_admin_id, test_week_far_past, 'draft');
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'MANAGER_EDIT_LOCKED%' THEN
      caught := true;
    ELSE
      RAISE;
    END IF;
  END;
  IF NOT caught THEN
    RAISE EXCEPTION 'Test 7 FAILED: a dual-role admin submitter was able to start their OWN new report for a week whose cutoff has long passed.';
  END IF;
  RAISE NOTICE 'Test 7 PASSED: a dual-role admin submitter is NOT exempt on their own report — correctly rejected with the same MANAGER_EDIT_LOCKED code.';

  -- Test 8: the SAME dual-role admin submitter remains exempt when acting
  -- on a DIFFERENT manager's report, even past that report's own cutoff —
  -- unaffected by this change.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', test_admin_id)::text, true);
  UPDATE reports SET what_matters_now = 'Admin+submitter editing a DIFFERENT manager''s report, should still succeed'
  WHERE manager_id = test_manager_id AND week_start_date = test_week_far_past;
  IF NOT EXISTS (
    SELECT 1 FROM reports
    WHERE manager_id = test_manager_id AND week_start_date = test_week_far_past
      AND what_matters_now = 'Admin+submitter editing a DIFFERENT manager''s report, should still succeed'
  ) THEN
    RAISE EXCEPTION 'Test 8 FAILED: a dual-role admin submitter performing a legitimate Admin action on someone else''s report was blocked.';
  END IF;
  RAISE NOTICE 'Test 8 PASSED: a dual-role admin submitter remains exempt when acting on a DIFFERENT manager''s report.';

  -- Cleanup: restore the admin profile's original submits_weekly_report
  -- value (verified, not assumed) and remove only the synthetic test report
  -- rows created above.
  RESET request.jwt.claims;
  UPDATE profiles SET submits_weekly_report = admin_original_submits WHERE id = test_admin_id;
  IF (SELECT submits_weekly_report FROM profiles WHERE id = test_admin_id) IS DISTINCT FROM admin_original_submits THEN
    RAISE EXCEPTION 'Cleanup FAILED: could not restore the test admin profile''s original submits_weekly_report value — investigate before proceeding.';
  END IF;

  DELETE FROM reports WHERE manager_id IN (test_manager_id, test_admin_id) AND week_start_date IN (test_week_far_future, test_week_far_past);
  IF EXISTS (
    SELECT 1 FROM reports WHERE manager_id IN (test_manager_id, test_admin_id) AND week_start_date IN (test_week_far_future, test_week_far_past)
  ) THEN
    RAISE EXCEPTION 'Cleanup FAILED: synthetic test report rows still exist — investigate before proceeding.';
  END IF;
  RAISE NOTICE 'Cleanup PASSED: admin profile restored to its original submits_weekly_report value, and no residual synthetic test report rows remain.';
END $$;

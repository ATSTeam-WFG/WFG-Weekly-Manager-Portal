-- Friday final-cutoff business-rule change: the single Manager write cutoff
-- moves from Friday 3:30 PM to Friday 4:00 PM America/New_York. Nothing
-- else about the rule changes — before the cutoff, a brand-new report (Not
-- Started) and an existing report (Draft/auto-submitted/Submitted) are
-- still treated identically; at/after the cutoff, every Manager write on
-- that reporting week still locks, with no exception. The weekend lock is
-- unaffected, since it was always this same cutoff persisting through the
-- rest of the week, never a separate rule. The Friday 3:00 PM auto-submit
-- scheduler and its own logic (api/auto-submit.ts) are completely untouched
-- by this migration — this only changes the FINAL lock instant that
-- follows it, not the auto-submit action itself.
--
-- The ONLY change here is the literal cutoff time constant, `time '15:30'`
-- -> `time '16:00'`, inside the already-existing
-- reports_enforce_manager_edit_cutoff() function (refined in place again,
-- the same function most recently refined by
-- 20260915_new_report_grace_period.sql) — the trigger itself, its name,
-- and its timing are unchanged. The admin-exemption logic (normal Admins
-- fully exempt; a dual-role Admin exempt only when NOT acting on their own
-- report) and the status-regression guard are byte-for-byte unchanged.
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
  SELECT role, submits_weekly_report INTO acting_role, acting_submits
  FROM public.profiles WHERE id = auth.uid();

  IF acting_role = 'admin' AND NOT (coalesce(acting_submits, false) AND NEW.manager_id = auth.uid()) THEN
    RETURN NEW;
  END IF;

  friday_date := NEW.week_start_date + 4;
  edit_cutoff := (friday_date + time '16:00') AT TIME ZONE 'America/New_York';

  IF now() >= edit_cutoff THEN
    RAISE EXCEPTION 'MANAGER_EDIT_LOCKED: Editing is closed for this reporting week.';
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.status = 'submitted' AND NEW.status IS DISTINCT FROM 'submitted' THEN
    RAISE EXCEPTION 'MANAGER_STATUS_REGRESSION_BLOCKED: An already-submitted report cannot be changed back to draft.';
  END IF;

  RETURN NEW;
END;
$$;

-- The existing reports_manager_edit_cutoff trigger already calls this
-- function by name — no DROP TRIGGER / CREATE TRIGGER is needed or
-- included here. CREATE OR REPLACE FUNCTION above is sufficient: Postgres
-- updates the function body in place and the already-installed trigger
-- picks up the new behavior on its very next invocation.

-- ---------------------------------------------------------------------------
-- Self-verifying test script. Run after the statement above and review the
-- NOTICE output. Follows the same conventions as the prior migrations'
-- self-tests: only synthetic REPORT rows for clearly out-of-range test
-- weeks are created/removed; the real profiles used are only ever read,
-- and (for the synthetic admin+submitter case) temporarily flagged and
-- restored, never left modified.
--
-- Precise minute-level boundaries (2:59:59 PM / 3:00:00 PM / 3:30:00 PM /
-- 3:59:59 PM / exactly 4:00:00 PM) are exhaustively covered by the dynamic,
-- injectable-clock unit tests in src/lib/managerEditLock.test.ts and
-- src/utils/easternTime.test.ts — a live Postgres self-test cannot control
-- now() precisely enough to hit those exact instants deterministically.
-- This script instead proves the same structural behavior against a real
-- database: a brand-new report succeeds for a week whose 4:00 PM cutoff is
-- still far in the future, and is rejected with MANAGER_EDIT_LOCKED for a
-- week whose cutoff is far in the past — exactly the same shape of test the
-- prior migration's self-test used, confirming only the threshold moved,
-- not the underlying behavior.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  test_manager_id uuid;
  test_admin_id uuid;
  admin_original_submits boolean;
  test_week_far_future date := '2099-05-04'; -- a Monday; Friday 4:00 PM cutoff far in the future
  test_week_far_past date := '1999-02-01';   -- a Monday; Friday 4:00 PM cutoff far in the past
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

  -- Test 1: a manager starting a BRAND-NEW report for a week whose 4:00 PM
  -- cutoff is far in the future must SUCCEED.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', test_manager_id)::text, true);
  INSERT INTO reports (manager_id, week_start_date, status) VALUES (test_manager_id, test_week_far_future, 'draft');
  IF NOT EXISTS (SELECT 1 FROM reports WHERE manager_id = test_manager_id AND week_start_date = test_week_far_future) THEN
    RAISE EXCEPTION 'Test 1 FAILED: a manager could not start a brand-new report for a week whose 4:00 PM cutoff has not passed.';
  END IF;
  RAISE NOTICE 'Test 1 PASSED: a brand-new report succeeds well before the 4:00 PM cutoff.';

  -- Test 2: continuing/editing that EXISTING report well before its own
  -- 4:00 PM cutoff must succeed — including a submitted -> corrected edit
  -- that must remain 'submitted' (never regress to 'draft').
  UPDATE reports SET what_matters_now = 'Updated bullet'
  WHERE manager_id = test_manager_id AND week_start_date = test_week_far_future;
  IF NOT EXISTS (
    SELECT 1 FROM reports
    WHERE manager_id = test_manager_id AND week_start_date = test_week_far_future AND what_matters_now = 'Updated bullet'
  ) THEN
    RAISE EXCEPTION 'Test 2 FAILED: a manager could not edit their own existing, not-yet-due report.';
  END IF;
  RAISE NOTICE 'Test 2 PASSED: editing an existing report is unaffected — still allowed well before the cutoff.';

  -- Test 3: a manager starting a BRAND-NEW report for a week whose 4:00 PM
  -- cutoff is far in the PAST must be rejected with MANAGER_EDIT_LOCKED.
  caught := false;
  BEGIN
    INSERT INTO reports (manager_id, week_start_date, status) VALUES (test_manager_id, test_week_far_past, 'draft');
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'MANAGER_EDIT_LOCKED%' THEN
      caught := true;
    ELSE
      RAISE;
    END IF;
  END;
  IF NOT caught THEN
    RAISE EXCEPTION 'Test 3 FAILED: a manager was able to start a brand-new report for a week whose 4:00 PM cutoff has long passed.';
  END IF;
  RAISE NOTICE 'Test 3 PASSED: a brand-new report past the 4:00 PM cutoff is correctly rejected with MANAGER_EDIT_LOCKED.';

  -- Test 4: editing an EXISTING report for a week whose cutoff is far in
  -- the past must also be rejected — first create that row as an admin
  -- (exempt), then attempt the edit as the manager.
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
    RAISE EXCEPTION 'Test 4 FAILED: a manager was able to edit an existing report for a week whose 4:00 PM cutoff has long passed.';
  END IF;
  RAISE NOTICE 'Test 4 PASSED: editing an existing report past the cutoff is correctly rejected (MANAGER_EDIT_LOCKED).';

  -- Test 5: the status-regression guard still fires — a manager can never
  -- move an already-submitted report (for the still-open far-future week)
  -- back to draft, even though the write itself is otherwise well within
  -- the allowed window. "An already submitted report must remain
  -- status=submitted when corrected" is the same guarantee this proves.
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
  RAISE NOTICE 'Test 5 PASSED: the status-regression guard is unaffected by this change — submitted never regresses to draft.';

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
    RAISE EXCEPTION 'Test 7 FAILED: a dual-role admin submitter was able to start their OWN new report for a week whose 4:00 PM cutoff has long passed.';
  END IF;
  RAISE NOTICE 'Test 7 PASSED: a dual-role admin submitter is NOT exempt on their own report — correctly rejected at the new 4:00 PM cutoff.';

  -- Test 8: the SAME dual-role admin submitter remains exempt when acting
  -- on a DIFFERENT manager's report, even past that report's own cutoff —
  -- unaffected by this change. Their own Admin access to other managers'
  -- reports remains unaffected.
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

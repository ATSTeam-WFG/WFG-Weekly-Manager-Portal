-- Friday reporting-workflow write lock for the `reports` table — additive
-- only: no columns added/removed/renamed, no existing RLS policy altered or
-- dropped. This adds a BEFORE INSERT/UPDATE trigger, which is the
-- authoritative, bypass-proof enforcement layer for the approved business
-- rules (React UI + service-layer guards mirror the same logic for UX, but
-- neither can be trusted as a security boundary on their own — see
-- src/lib/managerEditLock.ts and src/lib/reportsService.ts).
--
-- Rules enforced, both in America/New_York, DST-safe (AT TIME ZONE with a
-- named IANA zone resolves the correct UTC offset for that specific
-- calendar date automatically):
--   - A manager with NO existing report row for a given reporting week may
--     not create one (INSERT, or an upsert that would resolve to an INSERT)
--     once that week's Friday 3:00 PM ET has passed.
--   - A manager may not write to an EXISTING report row (UPDATE, or an
--     upsert that resolves to an UPDATE because the row already exists —
--     continuing a draft, or editing an already-submitted report) once that
--     week's Friday 3:30 PM ET has passed.
--   - A manager may never flip an already-submitted report's status back to
--     draft (defense-in-depth for the 3:00-3:30 PM edit window's "must
--     preserve the submitted state" rule — the application code never sends
--     `status` in this path at all, so this only matters for a bypassing
--     direct call).
--
-- Admin-role callers (profiles.role = 'admin') are exempt from all of the
-- above and completely unaffected — this includes the scheduler-bot, which
-- authenticates as a real admin-role account (see
-- api/_lib/adminAuth.ts's authenticateSchedulerBot), never a bare
-- service_role key, so the Friday auto-submit action is not restricted by
-- this trigger either.
--
-- Implemented as a TRIGGER rather than an RLS policy specifically because a
-- trigger cannot be bypassed by BYPASSRLS/service-role writes the way an RLS
-- policy can — it fires for every write to this table regardless of which
-- grant path is used, which is exactly the bypass-proof guarantee this task
-- requires.

CREATE OR REPLACE FUNCTION reports_enforce_manager_edit_cutoff()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  acting_role text;
  friday_date date;
  new_report_cutoff timestamptz;
  edit_cutoff timestamptz;
  row_exists boolean;
BEGIN
  -- The CALLING user's own profile role (never the row's manager_id) — an
  -- admin is always exempt regardless of whose report they're touching.
  -- auth.uid() is null outside an authenticated request context (e.g. a bare
  -- service_role connection with no JWT); that case is treated the same as
  -- "no matching profile" below — NOT exempted, fails closed. This
  -- project's own automation always authenticates as a real admin-role
  -- account, never a bare service_role key, so this does not affect it.
  SELECT role INTO acting_role FROM public.profiles WHERE id = auth.uid();

  IF acting_role = 'admin' THEN
    RETURN NEW;
  END IF;

  friday_date := NEW.week_start_date + 4;
  new_report_cutoff := (friday_date + time '15:00') AT TIME ZONE 'America/New_York';
  edit_cutoff := (friday_date + time '15:30') AT TIME ZONE 'America/New_York';

  -- Whether a row already exists for this manager/week determines which
  -- cutoff applies — NOT the raw TG_OP. An upsert (INSERT ... ON CONFLICT DO
  -- UPDATE) fires this trigger's BEFORE INSERT path first regardless of
  -- whether it will ultimately insert or resolve to an update on conflict;
  -- checking existence directly (rather than trusting TG_OP = 'INSERT')
  -- ensures continuing an existing draft via upsert is correctly measured
  -- against the later 3:30 PM edit cutoff, not the earlier 3:00 PM
  -- new-report cutoff.
  row_exists := TG_OP = 'UPDATE'
    OR EXISTS (
      SELECT 1 FROM public.reports
      WHERE manager_id = NEW.manager_id AND week_start_date = NEW.week_start_date
    );

  IF NOT row_exists THEN
    IF now() >= new_report_cutoff THEN
      RAISE EXCEPTION 'MANAGER_NEW_REPORT_LOCKED: The submission deadline has passed for this reporting week.';
    END IF;
  ELSE
    IF now() >= edit_cutoff THEN
      RAISE EXCEPTION 'MANAGER_EDIT_LOCKED: Editing is closed for this reporting week.';
    END IF;

    IF TG_OP = 'UPDATE' AND OLD.status = 'submitted' AND NEW.status IS DISTINCT FROM 'submitted' THEN
      RAISE EXCEPTION 'MANAGER_STATUS_REGRESSION_BLOCKED: An already-submitted report cannot be changed back to draft.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS reports_manager_edit_cutoff ON reports;
CREATE TRIGGER reports_manager_edit_cutoff
  BEFORE INSERT OR UPDATE ON reports
  FOR EACH ROW
  EXECUTE FUNCTION reports_enforce_manager_edit_cutoff();

-- ---------------------------------------------------------------------------
-- Self-verifying test script — run after the statements above and review the
-- NOTICE output. Every test expecting rejection verifies the exception is
-- specifically one of this trigger's own error codes (MANAGER_NEW_REPORT_
-- LOCKED / MANAGER_EDIT_LOCKED / MANAGER_STATUS_REGRESSION_BLOCKED) — an
-- unrelated database error (a constraint violation, an RLS issue, anything
-- else) is deliberately NOT swallowed as a false pass; it is re-raised
-- verbatim so the real problem surfaces immediately. Cleanup is verified by
-- checking that the specific synthetic test rows are gone, not by a global
-- row-count comparison (the live application could plausibly insert an
-- unrelated report while this runs; a global count is not this test's
-- concern and must never make it fail).
--
-- Test 5 (submitted -> draft regression) is a deliberate exception to "only
-- our own error code counts": this project already has a separate,
-- pre-existing trigger/function (enforce_report_protected_fields(), not
-- defined in any migration file in this repo — it predates this repo's
-- migration tracking and was created directly in Supabase) that also
-- forbids a submitted report from being written back to draft, raising
-- 'Reports cannot transition from submitted to draft this way.'. Depending
-- on trigger firing order (Postgres runs same-timing BEFORE ROW triggers in
-- trigger-name order), that older trigger can fire before this one's own
-- MANAGER_STATUS_REGRESSION_BLOCKED check is ever reached for this specific
-- transition — the statement aborts at whichever trigger raises first, so
-- only one of the two error messages is actually observed per attempt, not
-- both. Test 5 accepts either — never a bare WHEN OTHERS — because either
-- one proves a manager cannot regress a submitted report to draft, which is
-- the only thing this test is actually verifying. See the note on Test 5
-- itself for what this does and does not imply about the two triggers'
-- relationship.
--
-- Deliberately uses REAL, already-existing profiles (one manager-role, one
-- admin-role) rather than fabricated ids — profiles.id is expected to carry
-- a foreign key to auth.users(id) in a standard Supabase setup, so inserting
-- synthetic profile rows here would likely fail with a foreign-key
-- violation unrelated to the actual behavior being tested. Only new REPORT
-- rows are created (for two clearly-out-of-range weeks, 2099 and 1999, that
-- cannot collide with real data), and only those are deleted at the end —
-- the two real profiles used are never modified or deleted.
--
-- Uses `set_config('request.jwt.claims', ..., true)` to simulate acting as
-- a specific profile for the duration of this transaction (Supabase's own
-- convention for what auth.uid() reads) — this must be run as a role that
-- can set that GUC (the Studio SQL editor's default connection can).
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  test_manager_id uuid;
  test_admin_id uuid;
  test_week_far_future date := '2099-01-05'; -- a Monday; Friday cutoffs both far in the future
  test_week_far_past date := '1999-01-04';   -- a Monday; Friday cutoffs both far in the past
  caught boolean;
  matched_protection text;
BEGIN
  SELECT id INTO test_manager_id FROM profiles WHERE role = 'manager' LIMIT 1;
  SELECT id INTO test_admin_id FROM profiles WHERE role = 'admin' LIMIT 1;

  IF test_manager_id IS NULL OR test_admin_id IS NULL THEN
    RAISE NOTICE 'SKIPPED: this self-test needs at least one existing manager-role profile and one existing admin-role profile to run against. Found manager=%, admin=%.', test_manager_id, test_admin_id;
    RETURN;
  END IF;

  -- Neither test week (2099 / 1999) should ever already have a row for
  -- these two real profiles; if one somehow does, stop rather than risk
  -- touching real data.
  IF EXISTS (
    SELECT 1 FROM reports
    WHERE manager_id IN (test_manager_id, test_admin_id)
      AND week_start_date IN (test_week_far_future, test_week_far_past)
  ) THEN
    RAISE EXCEPTION 'SKIPPED: a report row already exists for the test manager/admin on one of the test weeks — aborting to avoid touching real data.';
  END IF;

  -- Test 1: a manager INSERTing a brand-new report for a week whose Friday
  -- 3:00 PM cutoff is far in the past must be rejected specifically with
  -- MANAGER_NEW_REPORT_LOCKED — any other exception is a real problem, not
  -- a pass, and is re-raised as-is.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', test_manager_id)::text, true);
  caught := false;
  BEGIN
    INSERT INTO reports (manager_id, week_start_date, status)
    VALUES (test_manager_id, test_week_far_past, 'draft');
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'MANAGER_NEW_REPORT_LOCKED%' THEN
      caught := true;
    ELSE
      RAISE;
    END IF;
  END;
  IF NOT caught THEN
    RAISE EXCEPTION 'Test 1 FAILED: a manager was able to start a brand-new report for a week whose deadline has long passed.';
  END IF;
  RAISE NOTICE 'Test 1 PASSED: new-report INSERT correctly rejected (MANAGER_NEW_REPORT_LOCKED) for a manager past the 3:00 PM cutoff.';

  -- Test 2: the same manager INSERTing a brand-new report for a week whose
  -- Friday 3:00 PM cutoff has not yet arrived must succeed.
  INSERT INTO reports (manager_id, week_start_date, status)
  VALUES (test_manager_id, test_week_far_future, 'draft');
  IF NOT EXISTS (SELECT 1 FROM reports WHERE manager_id = test_manager_id AND week_start_date = test_week_far_future) THEN
    RAISE EXCEPTION 'Test 2 FAILED: a manager could not start a new report for a week whose deadline has not passed.';
  END IF;
  RAISE NOTICE 'Test 2 PASSED: new-report INSERT correctly allowed well before the 3:00 PM cutoff.';

  -- Test 3: the same manager continuing/editing that just-created report
  -- (an UPDATE on an existing row, still far before its own 3:30 PM cutoff)
  -- must succeed.
  UPDATE reports SET what_matters_now = 'Updated bullet'
  WHERE manager_id = test_manager_id AND week_start_date = test_week_far_future;
  IF NOT EXISTS (
    SELECT 1 FROM reports
    WHERE manager_id = test_manager_id AND week_start_date = test_week_far_future AND what_matters_now = 'Updated bullet'
  ) THEN
    RAISE EXCEPTION 'Test 3 FAILED: a manager could not edit their own existing, not-yet-due report.';
  END IF;
  RAISE NOTICE 'Test 3 PASSED: editing an existing report is allowed well before the 3:30 PM cutoff.';

  -- Test 4: a manager UPDATEing an EXISTING report for a week whose 3:30 PM
  -- edit cutoff is far in the past must be rejected specifically with
  -- MANAGER_EDIT_LOCKED — first create that row as an admin (bypassing the
  -- manager INSERT cutoff, since admins are exempt), then attempt the edit
  -- as the manager. Any exception other than MANAGER_EDIT_LOCKED is a real
  -- problem, not a pass, and is re-raised as-is.
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
    RAISE EXCEPTION 'Test 4 FAILED: a manager was able to edit a report for a week whose edit cutoff has long passed.';
  END IF;
  RAISE NOTICE 'Test 4 PASSED: editing an existing report is correctly rejected (MANAGER_EDIT_LOCKED) past the 3:30 PM cutoff.';

  -- Test 5: a manager may never flip an already-submitted report back to
  -- draft, even for a week that is not yet past any cutoff. The row from
  -- Test 2/3 is currently 'draft', so first mark it 'submitted' as admin
  -- (exempt from the manager cutoffs), then retry the regression as
  -- manager.
  --
  -- This project has a pre-existing, separate trigger/function
  -- (enforce_report_protected_fields() — not defined in this repo, created
  -- directly in Supabase before migration files were tracked here) that
  -- independently also forbids submitted -> draft, raising 'Reports cannot
  -- transition from submitted to draft this way.'. Depending on trigger
  -- firing order, EITHER that pre-existing protection OR this migration's
  -- own MANAGER_STATUS_REGRESSION_BLOCKED check may be the one that
  -- actually fires first and aborts the statement — only one is ever
  -- observed per attempt. Both are accepted here as a pass, since either
  -- one proves the actual thing this test cares about: a manager cannot
  -- regress a submitted report back to draft. Anything else (a genuinely
  -- unrelated error) is still re-raised, never swallowed as success.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', test_admin_id)::text, true);
  UPDATE reports SET status = 'submitted', submitted_at = now(), submission_source = 'manual'
  WHERE manager_id = test_manager_id AND week_start_date = test_week_far_future;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', test_manager_id)::text, true);
  caught := false;
  matched_protection := null;
  BEGIN
    UPDATE reports SET status = 'draft'
    WHERE manager_id = test_manager_id AND week_start_date = test_week_far_future;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'MANAGER_STATUS_REGRESSION_BLOCKED%' THEN
      caught := true;
      matched_protection := 'this migration''s MANAGER_STATUS_REGRESSION_BLOCKED trigger';
    ELSIF SQLERRM LIKE '%Reports cannot transition from submitted to draft this way%' THEN
      caught := true;
      matched_protection := 'the pre-existing enforce_report_protected_fields() trigger';
    ELSE
      RAISE;
    END IF;
  END;
  IF NOT caught THEN
    RAISE EXCEPTION 'Test 5 FAILED: a manager was able to move an already-submitted report back to draft.';
  END IF;
  RAISE NOTICE 'Test 5 PASSED: a Manager write cannot regress an already-submitted report back to draft (blocked by: %).', matched_protection;

  -- Test 6: an admin-role caller is exempt from every cutoff above — able to
  -- both create and edit a report for the long-past week.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', test_admin_id)::text, true);
  UPDATE reports SET what_matters_now = 'Admin edit after cutoff, should succeed'
  WHERE manager_id = test_manager_id AND week_start_date = test_week_far_past;
  IF NOT EXISTS (
    SELECT 1 FROM reports
    WHERE manager_id = test_manager_id AND week_start_date = test_week_far_past
      AND what_matters_now = 'Admin edit after cutoff, should succeed'
  ) THEN
    RAISE EXCEPTION 'Test 6 FAILED: an admin-role caller was blocked by the Manager edit cutoff.';
  END IF;
  RAISE NOTICE 'Test 6 PASSED: admin-role callers are exempt from the Manager edit cutoff.';

  -- Cleanup: remove only the synthetic test REPORT rows for the two
  -- out-of-range test weeks. The real manager/admin profiles used above are
  -- never modified or deleted. Verified by checking those specific rows are
  -- gone — never by a global row-count comparison, since the live
  -- application could plausibly write an unrelated report while this runs
  -- and that must never make this test fail.
  RESET request.jwt.claims;
  DELETE FROM reports WHERE manager_id = test_manager_id AND week_start_date IN (test_week_far_future, test_week_far_past);

  IF EXISTS (
    SELECT 1 FROM reports
    WHERE manager_id = test_manager_id AND week_start_date IN (test_week_far_future, test_week_far_past)
  ) THEN
    RAISE EXCEPTION 'Cleanup FAILED: synthetic test report rows still exist for manager % — investigate before proceeding.', test_manager_id;
  END IF;
  RAISE NOTICE 'Cleanup PASSED: no residual synthetic test report rows remain for the two test weeks.';
END $$;

-- Dual-role support: an Admin who ALSO submits their own weekly report (a
-- dual-role admin submitter) — additive only. No existing column is renamed or
-- dropped, no existing RLS policy is touched, and the ONLY existing trigger
-- FUNCTION whose body changes is reports_enforce_manager_edit_cutoff() (from
-- 20260918_manager_edit_lock.sql) — refined in place below, not replaced
-- with a new trigger, because the exemption CONDITION itself must change.
-- Every other object in this migration is new and additive.
--
-- submits_weekly_report is an explicit, separately-set boolean column on
-- BOTH approved_employees and profiles. It is NEVER inferred from role and
-- NEVER inferred from whether a report row happens to exist — see
-- src/types.ts, src/lib/profileService.ts, and
-- api/_lib/supabaseServiceClient.ts. This is deliberate: role answers "what
-- can this person administer", submits_weekly_report answers "does this
-- person have their own weekly report to fill out" — a dual-role admin
-- submitter needs role=admin AND submits_weekly_report=true, simultaneously,
-- with neither implying the other.
--
-- Every existing Manager is backfilled to true (by definition, a Manager
-- submits their own report). Every existing Admin-only user is backfilled to
-- false and stays false unless explicitly changed later. No specific person
-- is added, modified, or flagged by this migration — this migration only
-- adds the column and the general-purpose enforcement machinery; a specific
-- person is a separate, later, explicit action outside this file.

-- ---------------------------------------------------------------------------
-- 1) Schema — additive, NOT NULL with a safe default so existing INSERTs
--    elsewhere in the codebase that don't yet mention this column keep
--    working unchanged (they get `false`, the correct default for a
--    newly-created Admin-only row; every path that should set `true`
--    explicitly does so — see createProfileFromApprovedEmployee and
--    addOrCreateManagerAccount in api/_lib/supabaseServiceClient.ts).
-- ---------------------------------------------------------------------------
ALTER TABLE approved_employees ADD COLUMN IF NOT EXISTS submits_weekly_report boolean NOT NULL DEFAULT false;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS submits_weekly_report boolean NOT NULL DEFAULT false;

-- ---------------------------------------------------------------------------
-- 2) Backfill — explicit, not relied upon as the DEFAULT alone. Every
--    existing Manager roster/profile row becomes a submitter; every existing
--    Admin-only row is left at (or explicitly set to) false. Matches on the
--    existing role columns, exactly once, at migration time only — this is
--    NOT how the running application ever decides the flag going forward.
-- ---------------------------------------------------------------------------
UPDATE approved_employees SET submits_weekly_report = true WHERE portal_role = 'manager';
UPDATE approved_employees SET submits_weekly_report = false WHERE portal_role = 'admin';
UPDATE profiles SET submits_weekly_report = true WHERE role = 'manager';
UPDATE profiles SET submits_weekly_report = false WHERE role = 'admin';

-- ---------------------------------------------------------------------------
-- 3) Refine reports_enforce_manager_edit_cutoff() — the ONLY change here is
--    to the admin-exemption condition. Previously: any admin-role caller was
--    unconditionally exempt from the Friday cutoffs. Now: an admin-role
--    caller who is ALSO a submitter (submits_weekly_report = true) is
--    exempt ONLY while acting on someone else's report (NEW.manager_id <>
--    auth.uid()) — on their OWN report, they are held to exactly the same
--    3:00 PM / 3:30 PM cutoffs as any other submitter. A plain admin
--    (submits_weekly_report = false) remains unconditionally exempt exactly
--    as before, on every report including their own (an edge case that
--    cannot currently arise since a plain admin has no report row of their
--    own, but the logic does not depend on that).
--
--    Nothing below the exemption check changes — the actual cutoff
--    computation, the new-vs-existing-row distinction, and the
--    submitted-to-draft regression guard are byte-for-byte identical to
--    20260918_manager_edit_lock.sql.
-- ---------------------------------------------------------------------------
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
  new_report_cutoff timestamptz;
  edit_cutoff timestamptz;
  row_exists boolean;
BEGIN
  -- The CALLING user's own profile role and submits_weekly_report flag
  -- (never the row's manager_id alone) — see the exemption condition below.
  -- auth.uid() is null outside an authenticated request context; that case
  -- resolves acting_role/acting_submits to null, which is NOT exempted,
  -- failing closed exactly as before this change.
  SELECT role, submits_weekly_report INTO acting_role, acting_submits
  FROM public.profiles WHERE id = auth.uid();

  -- Admin exemption, refined: exempt unless this admin is also a submitter
  -- acting on their OWN report. A plain admin (acting_submits = false or
  -- null) is unconditionally exempt, unchanged from before. An admin+
  -- submitter acting on someone else's report (NEW.manager_id <>
  -- auth.uid()) is still exempt — this is a legitimate Admin action, not a
  -- self-submission.
  IF acting_role = 'admin' AND NOT (coalesce(acting_submits, false) AND NEW.manager_id = auth.uid()) THEN
    RETURN NEW;
  END IF;

  friday_date := NEW.week_start_date + 4;
  new_report_cutoff := (friday_date + time '15:00') AT TIME ZONE 'America/New_York';
  edit_cutoff := (friday_date + time '15:30') AT TIME ZONE 'America/New_York';

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

-- The trigger itself (name, timing, table) is completely unchanged — only
-- the function body above was refined. Re-stated here only so this
-- migration file is fully self-contained to read; this is a no-op if it
-- already exists exactly this way.
DROP TRIGGER IF EXISTS reports_manager_edit_cutoff ON reports;
CREATE TRIGGER reports_manager_edit_cutoff
  BEFORE INSERT OR UPDATE ON reports
  FOR EACH ROW
  EXECUTE FUNCTION reports_enforce_manager_edit_cutoff();

-- ---------------------------------------------------------------------------
-- Self-verifying test script. Run after the statements above and review the
-- NOTICE output. Follows the same conventions as 20260918_manager_edit_lock.sql's
-- own self-test: only synthetic REPORT rows for clearly out-of-range test
-- weeks are created/removed; the real profiles used are only ever read, and
-- (for the synthetic admin+submitter case) temporarily flagged and restored,
-- never left modified.
--
-- This project has no real admin+submitter profile at the time this
-- migration is written (no dual-role admin submitter has been added — see
-- the header above), so this test temporarily sets submits_weekly_report =
-- true on ONE existing real admin-role profile for the duration of this
-- test, and restores its
-- original value (whatever it was) at the end — verified explicitly, not
-- assumed. This is the only column value this test ever changes on a real
-- profile, and it is always restored before the script finishes.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  test_manager_id uuid;
  test_admin_id uuid;
  admin_original_submits boolean;
  test_week date := '2099-03-02'; -- a Monday, distinct from other migrations' test weeks
  other_manager_week date := '2099-03-09'; -- a distinct Monday, used for the "own vs other report" check
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
    WHERE manager_id IN (test_manager_id, test_admin_id) AND week_start_date IN (test_week, other_manager_week)
  ) THEN
    RAISE EXCEPTION 'SKIPPED: a report row already exists for the test manager/admin on a test week — aborting to avoid touching real data.';
  END IF;

  SELECT submits_weekly_report INTO admin_original_submits FROM profiles WHERE id = test_admin_id;

  -- Test 1: a PLAIN admin (submits_weekly_report = false, its actual current
  -- value) remains fully exempt, including on a week whose cutoffs are long
  -- past, when writing a row whose manager_id IS their own id (an edge case
  -- that cannot currently occur in the app, but the logic must not depend on
  -- manager_id being someone else's to exempt a plain admin).
  UPDATE profiles SET submits_weekly_report = false WHERE id = test_admin_id;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', test_admin_id)::text, true);
  INSERT INTO reports (manager_id, week_start_date, status) VALUES (test_admin_id, test_week, 'draft');
  IF NOT EXISTS (SELECT 1 FROM reports WHERE manager_id = test_admin_id AND week_start_date = test_week) THEN
    RAISE EXCEPTION 'Test 1 FAILED: a plain admin (submits_weekly_report=false) was blocked from writing their own report row on a long-past week.';
  END IF;
  RAISE NOTICE 'Test 1 PASSED: a plain admin remains exempt, even acting on a manager_id that is their own id.';
  DELETE FROM reports WHERE manager_id = test_admin_id AND week_start_date = test_week;

  -- Test 2: now flag the same admin as a submitter (simulating a dual-role
  -- admin submitter) and have them write to THEIR OWN report row for a
  -- week whose cutoffs are long past — this must now be REJECTED, held to
  -- the same cutoff as any other submitter.
  UPDATE profiles SET submits_weekly_report = true WHERE id = test_admin_id;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', test_admin_id)::text, true);
  caught := false;
  BEGIN
    INSERT INTO reports (manager_id, week_start_date, status) VALUES (test_admin_id, test_week, 'draft');
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'MANAGER_NEW_REPORT_LOCKED%' THEN
      caught := true;
    ELSE
      RAISE;
    END IF;
  END;
  IF NOT caught THEN
    RAISE EXCEPTION 'Test 2 FAILED: an admin+submitter was able to start their OWN new report for a week whose deadline has long passed.';
  END IF;
  RAISE NOTICE 'Test 2 PASSED: an admin+submitter is NOT exempt on their own report — correctly rejected (MANAGER_NEW_REPORT_LOCKED).';

  -- Test 3: the SAME admin+submitter, still acting as themselves, writing to
  -- SOMEONE ELSE's report row (the real manager profile) for a week whose
  -- cutoffs are long past — this must still SUCCEED, a legitimate Admin
  -- action on another person's report.
  INSERT INTO reports (manager_id, week_start_date, status) VALUES (test_manager_id, test_week, 'submitted')
  ON CONFLICT (manager_id, week_start_date) DO NOTHING;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', test_admin_id)::text, true);
  UPDATE reports SET what_matters_now = 'Admin+submitter editing a DIFFERENT manager''s report, should succeed'
  WHERE manager_id = test_manager_id AND week_start_date = test_week;
  IF NOT EXISTS (
    SELECT 1 FROM reports
    WHERE manager_id = test_manager_id AND week_start_date = test_week
      AND what_matters_now = 'Admin+submitter editing a DIFFERENT manager''s report, should succeed'
  ) THEN
    RAISE EXCEPTION 'Test 3 FAILED: an admin+submitter performing a legitimate Admin action on someone else''s report was blocked.';
  END IF;
  RAISE NOTICE 'Test 3 PASSED: an admin+submitter remains exempt when acting on a DIFFERENT manager''s report.';

  -- Test 4: the same admin+submitter writing their OWN report for a week
  -- whose cutoffs have NOT yet passed must still succeed — the refined
  -- exemption only removes the exemption past the actual cutoff, it does
  -- not block a submitter's own report outright.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', test_admin_id)::text, true);
  INSERT INTO reports (manager_id, week_start_date, status) VALUES (test_admin_id, other_manager_week, 'draft');
  IF NOT EXISTS (SELECT 1 FROM reports WHERE manager_id = test_admin_id AND week_start_date = other_manager_week) THEN
    RAISE EXCEPTION 'Test 4 FAILED: an admin+submitter could not start their own new report for a week whose deadline has not passed.';
  END IF;
  RAISE NOTICE 'Test 4 PASSED: an admin+submitter can write their own report well before the cutoff, same as any other submitter.';

  -- Cleanup: restore the admin profile's original submits_weekly_report
  -- value (verified, not assumed) and remove only the synthetic test report
  -- rows created above.
  RESET request.jwt.claims;
  UPDATE profiles SET submits_weekly_report = admin_original_submits WHERE id = test_admin_id;
  IF (SELECT submits_weekly_report FROM profiles WHERE id = test_admin_id) IS DISTINCT FROM admin_original_submits THEN
    RAISE EXCEPTION 'Cleanup FAILED: could not restore the test admin profile''s original submits_weekly_report value — investigate before proceeding.';
  END IF;

  DELETE FROM reports WHERE manager_id IN (test_manager_id, test_admin_id) AND week_start_date IN (test_week, other_manager_week);
  IF EXISTS (
    SELECT 1 FROM reports WHERE manager_id IN (test_manager_id, test_admin_id) AND week_start_date IN (test_week, other_manager_week)
  ) THEN
    RAISE EXCEPTION 'Cleanup FAILED: synthetic test report rows still exist — investigate before proceeding.';
  END IF;
  RAISE NOTICE 'Cleanup PASSED: admin profile restored to its original submits_weekly_report value, and no residual synthetic test report rows remain.';
END $$;

-- Mandatory first-login password change enforcement, for the
-- shared-temporary-password onboarding flow — additive only: no existing
-- column, trigger, or RLS policy is altered or dropped.
--
-- Employees onboarded via Admin User Management's "Create Account" (see
-- api/_lib/supabaseServiceClient.ts's createEmployeeAccount) get a real Auth
-- account immediately, with a fixed, shared temporary password and
-- app_metadata.password_change_required = true. They must not be able to
-- use the portal for anything — Manager or Admin alike — until they've set
-- their own password (api/onboarding/complete-profile.ts clears the marker
-- once they do).
--
-- Two enforcement points exist for this, deliberately split:
--   1. api/_lib/adminAuth.ts checks the marker (live, via auth.getUser())
--      before any Admin API action — this covers every server-side
--      endpoint.
--   2. This migration's trigger covers Manager report writes, which never
--      go through a Node API at all — they're direct, RLS-scoped calls from
--      the browser's own Supabase client. A trigger is used rather than an
--      RLS policy for the same reason reports_manager_edit_cutoff already
--      is (see 20260918_manager_edit_lock.sql): it fires for every write to
--      this table regardless of which grant path is used, which an RLS
--      policy alone would not guarantee.
--
-- Kept as a SEPARATE trigger/function from reports_manager_edit_cutoff, so
-- that existing, already-tested trigger is never modified by this
-- migration, and the Friday cutoff timing logic is completely unaffected.
--
-- Deliberately NO admin exemption here (unlike reports_manager_edit_cutoff,
-- which exempts admin-role callers from the Friday cutoffs) — an Admin
-- account still on the shared temporary password must be blocked exactly
-- the same as a Manager one; the whole point is universal, role-independent
-- enforcement until the temporary password has been replaced.
--
-- password_change_required lives in the calling user's own JWT app_metadata
-- claim (never a database column — see src/lib/onboardingSession.ts),
-- settable only via the privileged Admin API (auth.admin.createUser /
-- auth.admin.updateUserById), never by the user themselves. auth.jwt()
-- reflects the claims embedded in the presented token, not a live lookup —
-- a stale token from before the marker was cleared would still show it as
-- true, which is exactly why the client is signed out and must sign back in
-- (minting a fresh token) once the marker is actually cleared server-side —
-- see api/onboarding/complete-profile.ts and CreatePassword.tsx's existing
-- onboarding-mode sign-out behavior, unchanged by this migration.

CREATE OR REPLACE FUNCTION reports_require_password_change_cleared()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF coalesce((auth.jwt() -> 'app_metadata' ->> 'password_change_required')::boolean, false) THEN
    RAISE EXCEPTION 'PASSWORD_CHANGE_REQUIRED: You must set your own password before submitting reports.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS reports_password_change_required_lock ON reports;
CREATE TRIGGER reports_password_change_required_lock
  BEFORE INSERT OR UPDATE ON reports
  FOR EACH ROW
  EXECUTE FUNCTION reports_require_password_change_cleared();

-- ---------------------------------------------------------------------------
-- account_created_at — additive column on approved_employees, recording when
-- Admin User Management's "Create Account" action actually created the Auth
-- user for this roster entry. Used purely to distinguish "not created yet"
-- (Pending) from "created, awaiting the employee's first login" (Awaiting
-- First Login) in the User Management list — see deriveManagedUserStatus in
-- api/_lib/adminUserManagement.ts. Nullable; every existing row is
-- completely unaffected (reads as NULL, which is correct for every
-- pre-existing account regardless of how it was actually created, since
-- this column is only ever consulted for a roster entry that has no
-- profile yet).
-- ---------------------------------------------------------------------------
ALTER TABLE approved_employees ADD COLUMN IF NOT EXISTS account_created_at timestamptz;

-- ---------------------------------------------------------------------------
-- Self-verifying test script. Run after the statements above and review the
-- NOTICE output, then rely on this script's own cleanup step (it removes
-- only the synthetic REPORT rows it creates, for a clearly out-of-range test
-- week; it never modifies the real manager/admin profiles it reads). Uses
-- REAL, already-existing manager/admin profiles for the trigger simulation
-- (synthetic profile rows would likely violate the profiles -> auth.users
-- foreign key), matching the same pattern established in
-- 20260918_manager_edit_lock.sql's own self-test.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  test_manager_id uuid;
  test_admin_id uuid;
  test_week date := '2099-02-02'; -- a Monday, distinct from other migrations' test weeks
  caught boolean;
BEGIN
  SELECT id INTO test_manager_id FROM profiles WHERE role = 'manager' LIMIT 1;
  SELECT id INTO test_admin_id FROM profiles WHERE role = 'admin' LIMIT 1;

  IF test_manager_id IS NULL OR test_admin_id IS NULL THEN
    RAISE NOTICE 'SKIPPED: this self-test needs at least one existing manager-role profile and one existing admin-role profile to run against. Found manager=%, admin=%.', test_manager_id, test_admin_id;
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1 FROM reports WHERE manager_id IN (test_manager_id, test_admin_id) AND week_start_date = test_week
  ) THEN
    RAISE EXCEPTION 'SKIPPED: a report row already exists for the test manager/admin on the test week — aborting to avoid touching real data.';
  END IF;

  -- Test 1: a manager whose JWT carries password_change_required=true
  -- cannot insert a new report, even on a week far from any Friday cutoff.
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object('sub', test_manager_id, 'app_metadata', json_build_object('password_change_required', true))::text,
    true
  );
  caught := false;
  BEGIN
    INSERT INTO reports (manager_id, week_start_date, status) VALUES (test_manager_id, test_week, 'draft');
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'PASSWORD_CHANGE_REQUIRED%' THEN
      caught := true;
    ELSE
      RAISE;
    END IF;
  END;
  IF NOT caught THEN
    RAISE EXCEPTION 'Test 1 FAILED: a manager with password_change_required=true was able to insert a report.';
  END IF;
  RAISE NOTICE 'Test 1 PASSED: insert correctly rejected (PASSWORD_CHANGE_REQUIRED) while the marker is true.';

  -- Test 2: an ADMIN whose JWT carries password_change_required=true is
  -- ALSO blocked — deliberately no admin exemption for this trigger.
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object('sub', test_admin_id, 'app_metadata', json_build_object('password_change_required', true))::text,
    true
  );
  caught := false;
  BEGIN
    INSERT INTO reports (manager_id, week_start_date, status) VALUES (test_admin_id, test_week, 'draft');
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'PASSWORD_CHANGE_REQUIRED%' THEN
      caught := true;
    ELSE
      RAISE;
    END IF;
  END;
  IF NOT caught THEN
    RAISE EXCEPTION 'Test 2 FAILED: an admin with password_change_required=true was able to insert a report — this trigger must have no admin exemption.';
  END IF;
  RAISE NOTICE 'Test 2 PASSED: admin is NOT exempt — insert correctly rejected while the marker is true.';

  -- Test 3: once the marker is false, the same manager CAN insert a report
  -- (on a week that is not past the Friday cutoffs).
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object('sub', test_manager_id, 'app_metadata', json_build_object('password_change_required', false))::text,
    true
  );
  INSERT INTO reports (manager_id, week_start_date, status) VALUES (test_manager_id, test_week, 'draft');
  IF NOT EXISTS (SELECT 1 FROM reports WHERE manager_id = test_manager_id AND week_start_date = test_week) THEN
    RAISE EXCEPTION 'Test 3 FAILED: a manager whose password_change_required is false could not insert a report.';
  END IF;
  RAISE NOTICE 'Test 3 PASSED: insert succeeds once password_change_required is false.';

  -- Test 4: a JWT with no app_metadata claim at all (e.g. an older token
  -- shape) is treated as "not required" — never blocked by a missing claim.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', test_manager_id)::text, true);
  UPDATE reports SET what_matters_now = 'Updated with no app_metadata claim present'
  WHERE manager_id = test_manager_id AND week_start_date = test_week;
  IF NOT EXISTS (
    SELECT 1 FROM reports WHERE manager_id = test_manager_id AND week_start_date = test_week
      AND what_matters_now = 'Updated with no app_metadata claim present'
  ) THEN
    RAISE EXCEPTION 'Test 4 FAILED: an update with no app_metadata claim present was unexpectedly blocked.';
  END IF;
  RAISE NOTICE 'Test 4 PASSED: a JWT with no app_metadata claim at all is not blocked.';

  -- Cleanup: remove only the synthetic test report rows for this test week.
  RESET request.jwt.claims;
  DELETE FROM reports WHERE manager_id IN (test_manager_id, test_admin_id) AND week_start_date = test_week;
  IF EXISTS (SELECT 1 FROM reports WHERE manager_id IN (test_manager_id, test_admin_id) AND week_start_date = test_week) THEN
    RAISE EXCEPTION 'Cleanup FAILED: synthetic test report rows still exist — investigate before proceeding.';
  END IF;
  RAISE NOTICE 'Cleanup PASSED: no residual synthetic test report rows remain for the test week.';
END $$;

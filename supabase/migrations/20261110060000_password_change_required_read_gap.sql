-- Closes a read-access gap found while preparing the Sales Rep invitation
-- rollout: three existing SELECT policies grant access purely on
-- `<column> = auth.uid()`, with no dependency on the caller having a
-- profiles row at all:
--   rep_reports_select_own                     (rep_id = auth.uid())
--   rep_manager_assignments_select_own_rep      (rep_id = auth.uid())
--   rep_manager_assignments_select_own_manager  (manager_id = auth.uid())
--
-- password_change_required (20260920_password_change_required.sql) already
-- blocks WRITES to reports/rep_reports and every Node admin-API action
-- while the marker is true, but it was never extended to these three
-- bare-auth.uid() READS. Unlike most of this app's SELECT policies (which
-- key off a role looked up from the caller's own profiles row — a row that
-- doesn't exist until complete-profile.ts runs), these three can return
-- data to an account that has authenticated with the shared temporary
-- password but has NOT yet completed first login: a rep_manager_assignments
-- row already exists for every pre-provisioned Sales Rep (created ahead of
-- their first login — see api/admin/users/pre-provision-sales-reps.ts),
-- and a rep_reports row can exist before first login too, via
-- import_rep_report_for_consolidation. Anyone who knows the (currently
-- shared) temporary password for an account that hasn't completed first
-- login yet could read that account's assigned-Manager id and any already-
-- imported report content, before that employee ever signs in themselves.
--
-- Fix: a small reusable guard, added as an extra AND-condition to exactly
-- these three policies — additive, no existing policy is dropped, no other
-- policy (is_admin()/is_assigned_manager_of()/was_manager_for_assignment()
-- paths) is touched. ALTER POLICY redefines a policy's USING expression in
-- place rather than drop-and-recreate, so the policy's own name, table, and
-- command stay exactly as they are today.
--
-- Deliberately NOT applied to rep_reports_select_assigned_manager,
-- rep_reports_select_admin, rep_reports_select_former_manager, or either
-- rep_manager_assignments_select_admin policy — all four already require a
-- real profiles row (is_assigned_manager_of/is_admin are both EXISTS checks
-- against profiles), so they are already unreachable for an account with no
-- profile yet, and reachable only for an account whose role was already
-- fully legitimate before any password-change concern applies.
--
-- Not applied to rep_report_review_history's own bare-auth.uid() SELECT
-- policy (rep_report_review_history_select_own) — narrower still, since it
-- additionally requires a rep_reports row that has already been reviewed,
-- i.e. acted on by a Manager/Admin first. Left as a known, narrower residual
-- case rather than folded into this migration's smaller, more directly
-- reachable scope.

CREATE OR REPLACE FUNCTION public.password_change_cleared()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  -- Mirrors reports_require_password_change_cleared()'s own check exactly
  -- (20260920_password_change_required.sql) — a missing app_metadata claim
  -- (e.g. an older token shape) is treated as "cleared", never as blocked.
  SELECT NOT coalesce((auth.jwt() -> 'app_metadata' ->> 'password_change_required')::boolean, false);
$$;

REVOKE ALL ON FUNCTION public.password_change_cleared() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.password_change_cleared() FROM anon;
GRANT EXECUTE ON FUNCTION public.password_change_cleared() TO authenticated;

ALTER POLICY rep_reports_select_own ON public.rep_reports
  USING (rep_id = auth.uid() AND public.password_change_cleared());

ALTER POLICY rep_manager_assignments_select_own_rep ON public.rep_manager_assignments
  USING (rep_id = auth.uid() AND public.password_change_cleared());

ALTER POLICY rep_manager_assignments_select_own_manager ON public.rep_manager_assignments
  USING (manager_id = auth.uid() AND public.password_change_cleared());

-- ---------------------------------------------------------------------------
-- Self-verifying test script, same established pattern as
-- 20260920_password_change_required.sql's own self-test: real existing
-- rows, request.jwt.claims simulation, atomic, no data created or left
-- behind (this migration only changes read visibility, so there is nothing
-- to clean up afterward beyond resetting the simulated JWT).
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  test_rep_id uuid;
  test_manager_id uuid;
  visible_count int;
BEGIN
  SELECT a.rep_id, a.manager_id INTO test_rep_id, test_manager_id
  FROM rep_manager_assignments a
  WHERE a.unassigned_at IS NULL
  LIMIT 1;

  IF test_rep_id IS NULL THEN
    RAISE NOTICE 'SKIPPED: this self-test needs at least one existing active rep_manager_assignments row to run against.';
    RETURN;
  END IF;

  -- Every test below must run AS the 'authenticated' role — the table
  -- owner/superuser session applying this migration bypasses RLS entirely
  -- by default, which would make every one of these checks a false pass.
  SET ROLE authenticated;

  -- Test 1: the rep's own assignment row is HIDDEN from them while
  -- password_change_required is true.
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object('sub', test_rep_id, 'app_metadata', json_build_object('password_change_required', true))::text,
    true
  );
  SELECT count(*) INTO visible_count FROM rep_manager_assignments WHERE rep_id = test_rep_id;
  IF visible_count <> 0 THEN
    RESET ROLE;
    RAISE EXCEPTION 'Test 1 FAILED: rep_manager_assignments_select_own_rep returned % row(s) while password_change_required=true.', visible_count;
  END IF;
  RAISE NOTICE 'Test 1 PASSED: a rep with password_change_required=true cannot read their own assignment row.';

  -- Test 2: the SAME row IS visible once the marker is false — no
  -- regression for a normal, already-onboarded rep.
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object('sub', test_rep_id, 'app_metadata', json_build_object('password_change_required', false))::text,
    true
  );
  SELECT count(*) INTO visible_count FROM rep_manager_assignments WHERE rep_id = test_rep_id;
  IF visible_count <> 1 THEN
    RESET ROLE;
    RAISE EXCEPTION 'Test 2 FAILED: expected exactly 1 row visible once password_change_required=false, got %.', visible_count;
  END IF;
  RAISE NOTICE 'Test 2 PASSED: the same rep can read their own assignment row once password_change_required=false.';

  -- Test 3: a JWT with no app_metadata claim at all is treated as cleared
  -- (matches reports_require_password_change_cleared()'s own convention).
  PERFORM set_config('request.jwt.claims', json_build_object('sub', test_rep_id)::text, true);
  SELECT count(*) INTO visible_count FROM rep_manager_assignments WHERE rep_id = test_rep_id;
  IF visible_count <> 1 THEN
    RESET ROLE;
    RAISE EXCEPTION 'Test 3 FAILED: a JWT with no app_metadata claim at all was unexpectedly blocked.';
  END IF;
  RAISE NOTICE 'Test 3 PASSED: a JWT with no app_metadata claim at all is not blocked.';

  -- Test 4: the MANAGER side of the same row is hidden from the manager
  -- while THEIR OWN password_change_required is true.
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object('sub', test_manager_id, 'app_metadata', json_build_object('password_change_required', true))::text,
    true
  );
  SELECT count(*) INTO visible_count FROM rep_manager_assignments WHERE manager_id = test_manager_id;
  IF visible_count <> 0 THEN
    RESET ROLE;
    RAISE EXCEPTION 'Test 4 FAILED: rep_manager_assignments_select_own_manager returned % row(s) while the manager''s own password_change_required=true.', visible_count;
  END IF;
  RAISE NOTICE 'Test 4 PASSED: a manager with password_change_required=true cannot read their own assignments list.';

  RESET request.jwt.claims;
  RESET ROLE;
  RAISE NOTICE 'All tests PASSED. No data was created or modified by this self-test — only read visibility was exercised.';
END $$;

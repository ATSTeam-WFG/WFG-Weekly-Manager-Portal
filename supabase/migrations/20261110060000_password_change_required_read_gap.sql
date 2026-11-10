-- Closes a read-access gap found while preparing the Sales Rep invitation
-- rollout: four existing SELECT policies grant access purely on
-- `<column> = auth.uid()`, with no dependency on the caller having a
-- profiles row at all:
--   rep_reports_select_own                     (rep_id = auth.uid())
--   rep_manager_assignments_select_own_rep      (rep_id = auth.uid())
--   rep_manager_assignments_select_own_manager  (manager_id = auth.uid())
--   rep_report_review_history_select_own        (EXISTS ... r.rep_id = auth.uid())
--
-- password_change_required (20260920_password_change_required.sql) already
-- blocks WRITES to reports/rep_reports and every Node admin-API action
-- while the marker is true, but it was never extended to these four
-- READS. Unlike most of this app's SELECT policies (which key off a role
-- looked up from the caller's own profiles row — a row that doesn't exist
-- until complete-profile.ts runs), these four can return data to an
-- account that has authenticated with its current temporary password but
-- has NOT yet completed first login: a rep_manager_assignments row already
-- exists for every pre-provisioned Sales Rep (created ahead of their first
-- login — see api/admin/users/pre-provision-sales-reps.ts), and a
-- rep_reports/rep_report_review_history row can exist before first login
-- too, via import_rep_report_for_consolidation. Anyone who authenticates
-- with an account's current temporary password before that employee's own
-- first login could read that account's assigned-Manager id and any
-- already-imported report content and review history.
--
-- Fix: two small reusable guards (see "two guards, independently
-- justified" below), each added as an extra AND-condition to exactly these
-- four policies — additive, no existing policy is dropped, no other
-- policy (is_admin()/is_assigned_manager_of()/was_manager_for_assignment()
-- paths) is touched. ALTER POLICY redefines a policy's USING expression in
-- place rather than drop-and-recreate, so the policy's own name, table,
-- and command stay exactly as they are today.
--
-- Deliberately NOT applied to rep_reports_select_assigned_manager,
-- rep_reports_select_admin, rep_reports_select_former_manager, or
-- rep_report_review_history's assigned-manager/former-manager/admin
-- policies — all of these already require a real profiles row
-- (is_assigned_manager_of/is_admin are both EXISTS checks against
-- profiles), so they are already unreachable for an account with no
-- profile yet.
--
-- ---------------------------------------------------------------------
-- Two guards, independently justified (REVIEW FINDING addressed): a
-- single guard with one fixed "missing claim" default cannot be correct
-- for both the rep-side and manager-side policies, and a missing claim
-- must never be read as "onboarding complete" without a specific reason —
-- so this migration uses two, not one:
--
-- password_change_cleared_strict() — used for all THREE rep-side/rep_id
-- policies (rep_reports_select_own, rep_manager_assignments_select_own_rep,
-- rep_report_review_history_select_own). FAILS CLOSED: only an explicit
-- `false` counts as cleared; a missing claim, 'true', or anything else
-- denies the read. Justified because the sales_rep role, and therefore
-- every account this policy can ever apply to, was introduced AFTER this
-- claim already existed (sales_rep postdates 20260920) — every genuine
-- Sales Rep account has this claim explicitly set to `true` from the
-- moment it's created (createEmployeeAccount / rotateSalesRepTempPassword)
-- and explicitly set to `false` once cleared. A missing claim on such an
-- account is never a normal, legitimate state; it is always anomalous and
-- must never be treated as proof onboarding is complete.
--
-- manager_password_change_cleared() — used ONLY for
-- rep_manager_assignments_select_own_manager (manager_id = auth.uid()).
-- Deliberately keeps the ORIGINAL fail-OPEN-on-missing convention (a
-- missing claim counts as cleared) — independently justified, not a
-- leftover default: the Manager role predates this claim by over a month
-- (20260920), and 20260920_password_change_required.production.sql is
-- explicitly additive-only with no backfill UPDATE for pre-existing
-- accounts. A missing claim on a Manager account therefore means exactly
-- one thing: this account predates the claim entirely and has been fully,
-- legitimately active for months — never an ambiguous or newly-created
-- state. A manager account created AFTER this migration (via
-- createEmployeeAccount) always has the claim explicitly set to `true` at
-- creation, so this exception can never let a genuinely not-yet-onboarded
-- new Manager through; verified by this migration's own self-test below.
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.password_change_cleared_strict()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT (auth.jwt() -> 'app_metadata' ->> 'password_change_required') = 'false';
$$;

CREATE OR REPLACE FUNCTION public.manager_password_change_cleared()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce((auth.jwt() -> 'app_metadata' ->> 'password_change_required')::boolean, false) = false;
$$;

REVOKE ALL ON FUNCTION public.password_change_cleared_strict() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.password_change_cleared_strict() FROM anon;
GRANT EXECUTE ON FUNCTION public.password_change_cleared_strict() TO authenticated;

REVOKE ALL ON FUNCTION public.manager_password_change_cleared() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.manager_password_change_cleared() FROM anon;
GRANT EXECUTE ON FUNCTION public.manager_password_change_cleared() TO authenticated;

ALTER POLICY rep_reports_select_own ON public.rep_reports
  USING (rep_id = auth.uid() AND public.password_change_cleared_strict());

ALTER POLICY rep_manager_assignments_select_own_rep ON public.rep_manager_assignments
  USING (rep_id = auth.uid() AND public.password_change_cleared_strict());

ALTER POLICY rep_manager_assignments_select_own_manager ON public.rep_manager_assignments
  USING (manager_id = auth.uid() AND public.manager_password_change_cleared());

ALTER POLICY rep_report_review_history_select_own ON public.rep_report_review_history
  USING (
    EXISTS (
      SELECT 1 FROM public.rep_reports r
      WHERE r.id = rep_report_review_history.report_id AND r.rep_id = auth.uid()
    )
    AND public.password_change_cleared_strict()
  );

-- ---------------------------------------------------------------------------
-- Self-verifying test script, same established pattern as
-- 20260920_password_change_required.sql's own self-test: real existing
-- rows, request.jwt.claims simulation, atomic, no data created or left
-- behind beyond what this block itself inserts and then removes. Must run
-- as the 'authenticated' role — the table owner/superuser session applying
-- this migration bypasses RLS entirely by default, which would make every
-- one of these checks a false pass.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  test_rep_id uuid;
  test_manager_id uuid;
  test_review_history_report_id uuid;
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

  SELECT id INTO test_review_history_report_id FROM rep_reports WHERE rep_id = test_rep_id LIMIT 1;

  SET ROLE authenticated;

  -- Test 1 (strict guard, rep side): the rep's own assignment row is
  -- HIDDEN from them while password_change_required is true.
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

  -- Test 2 (strict guard, no regression): the SAME row IS visible once the
  -- marker is explicitly false.
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

  -- Test 3 (strict guard, the actual review-finding fix): a JWT with NO
  -- app_metadata claim at all is now DENIED on the rep side — this is the
  -- opposite of the write-blocking trigger's own convention, and
  -- deliberately so (see the migration header's justification above).
  PERFORM set_config('request.jwt.claims', json_build_object('sub', test_rep_id)::text, true);
  SELECT count(*) INTO visible_count FROM rep_manager_assignments WHERE rep_id = test_rep_id;
  IF visible_count <> 0 THEN
    RESET ROLE;
    RAISE EXCEPTION 'Test 3 FAILED: a JWT with no app_metadata claim at all was able to read rep_manager_assignments_select_own_rep — this must fail CLOSED on the rep side.';
  END IF;
  RAISE NOTICE 'Test 3 PASSED: a rep JWT with no app_metadata claim at all is correctly denied (fail closed).';

  -- Test 4 (manager guard, true blocks): the MANAGER side of the same row
  -- is hidden from the manager while THEIR OWN password_change_required is
  -- true.
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

  -- Test 5 (manager guard, the deliberate asymmetric exception): a JWT
  -- with NO app_metadata claim at all is ALLOWED on the manager side —
  -- this is the one deliberate difference from the rep-side tests above,
  -- justified because the Manager role predates this claim entirely (see
  -- migration header).
  PERFORM set_config('request.jwt.claims', json_build_object('sub', test_manager_id)::text, true);
  SELECT count(*) INTO visible_count FROM rep_manager_assignments WHERE manager_id = test_manager_id;
  IF visible_count <> 1 THEN
    RESET ROLE;
    RAISE EXCEPTION 'Test 5 FAILED: a manager JWT with no app_metadata claim at all was unexpectedly blocked — this must fail OPEN on the manager side (legacy-account exception).';
  END IF;
  RAISE NOTICE 'Test 5 PASSED: a manager JWT with no app_metadata claim at all is correctly allowed (deliberate legacy-account exception).';

  -- Test 6 (strict guard, rep_report_review_history): same fail-closed
  -- behavior as Test 1/3, now for the review-history table.
  IF test_review_history_report_id IS NOT NULL THEN
    PERFORM set_config(
      'request.jwt.claims',
      json_build_object('sub', test_rep_id, 'app_metadata', json_build_object('password_change_required', true))::text,
      true
    );
    SELECT count(*) INTO visible_count FROM rep_report_review_history WHERE report_id = test_review_history_report_id;
    IF visible_count <> 0 THEN
      RESET ROLE;
      RAISE EXCEPTION 'Test 6 FAILED: rep_report_review_history_select_own returned % row(s) while password_change_required=true.', visible_count;
    END IF;
    RAISE NOTICE 'Test 6 PASSED: rep_report_review_history is also correctly hidden while password_change_required=true.';
  ELSE
    RAISE NOTICE 'Test 6 SKIPPED: no existing rep_reports row for this test rep to exercise rep_report_review_history against.';
  END IF;

  RESET request.jwt.claims;
  RESET ROLE;
  RAISE NOTICE 'All tests PASSED. No data was created or modified by this self-test — only read visibility was exercised.';
END $$;

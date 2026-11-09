-- ---------------------------------------------------------------------------
-- Phase 1A acceptance-test fix — Manager's My Reps screen showed an assigned
-- Sales Rep as "Unnamed Rep" / "Email not available" even though the rep's
-- profiles row (full_name, email) existed and the assignment was correct.
--
-- Root cause (confirmed via a live, read-only inspection of PREVIEW's actual
-- pg_policies, not assumed): public.profiles has exactly two pre-existing
-- SELECT policies —
--   "Admins can view all profiles"   USING (is_admin())
--   "Users can view their own profile" USING (id = auth.uid())
-- — both predating the Sales Rep feature entirely (neither is defined in any
-- migration file in this repo; they were never updated when the sales_rep
-- role was introduced in 20261027140000_sales_rep_role.sql). Neither covers
-- a Manager reading a DIFFERENT row — their own currently assigned Sales
-- Rep's profile — so src/lib/repRosterService.ts's fetchProfilesByIds
-- (plain RLS-scoped SELECT, no RPC) silently got zero rows back for that id,
-- which the UI correctly-but-confusingly renders as "Unnamed Rep".
--
-- Fix: one new, additive SELECT policy, scoped as narrowly as possible —
-- only rows where role = 'sales_rep', only for the CURRENTLY assigned
-- manager (unassigned_at IS NULL — the same current-assignment-only
-- standard as is_assigned_manager_of(), stricter than the historical
-- was_manager_for_assignment() used for report access elsewhere, which is
-- the right default for exposing a name/email). The two existing policies
-- are untouched — this never narrows anything, only adds one more case.
--
-- Recursion review (see self-test below for the live-equivalent proof):
-- this policy's EXISTS subquery reads rep_manager_assignments, whose own
-- SELECT policies (20261027140200_rep_manager_assignments.sql) are:
--   rep_manager_assignments_select_admin        USING (is_admin())
--   rep_manager_assignments_select_own_manager   USING (manager_id = auth.uid())
--   rep_manager_assignments_select_own_rep       USING (rep_id = auth.uid())
-- For the exact case this policy depends on (a Manager reading their own
-- assigned rep), rep_manager_assignments_select_own_manager is a direct
-- column comparison with NO subquery into profiles at all — so the common
-- path never re-enters profiles. is_admin() does subquery profiles, but
-- only for the CALLER's own row (id = auth.uid()), a fixed, different row
-- from whichever profiles row this policy is currently evaluating — never a
-- cycle back to the same row, never unbounded. Both rep_manager_assignments
-- and profiles already rely on is_admin() being called from other RLS
-- policies elsewhere in this schema (reports_restrict_to_manager_admin.sql,
-- rep_manager_assignments.sql itself) without issue.
-- ---------------------------------------------------------------------------

CREATE POLICY "Managers can view their assigned Sales Reps' profiles"
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (
    role = 'sales_rep'
    AND EXISTS (
      SELECT 1 FROM public.rep_manager_assignments
      WHERE rep_id = profiles.id
        AND manager_id = auth.uid()
        AND unassigned_at IS NULL
    )
  );

-- ---------------------------------------------------------------------------
-- Self-test: assigned Manager (can see), unrelated Manager (cannot), former
-- Manager after unassignment (cannot), Sales Rep self-access (unaffected,
-- still via the pre-existing own-profile policy), Admin access (unaffected,
-- still via the pre-existing is_admin() policy).
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  real_admin_id uuid;
  fake_rep_id uuid := gen_random_uuid();
  fake_manager_assigned_id uuid := gen_random_uuid();
  fake_manager_unrelated_id uuid := gen_random_uuid();
  row_count integer;
BEGIN
  SELECT id INTO real_admin_id FROM public.profiles WHERE role = 'admin' AND is_active = true LIMIT 1;
  IF real_admin_id IS NULL THEN
    RAISE NOTICE 'SKIPPED profiles_select_assigned_rep_for_manager self-test: needs at least one active admin profile.';
    RETURN;
  END IF;

  BEGIN
    SET ROLE authenticated;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIPPED profiles_select_assigned_rep_for_manager self-test: this session cannot SET ROLE authenticated (%).', SQLERRM;
    RETURN;
  END;

  BEGIN
    INSERT INTO auth.users (id) VALUES (fake_rep_id), (fake_manager_assigned_id), (fake_manager_unrelated_id);
    INSERT INTO public.profiles (id, full_name, email, role, is_active) VALUES
      (fake_rep_id, 'Phase 1A Policy Test Rep', 'phase1a-policy-rep-' || fake_rep_id || '@example.invalid', 'sales_rep', true),
      (fake_manager_assigned_id, 'Phase 1A Policy Test Manager Assigned', 'phase1a-policy-mgr-a-' || fake_manager_assigned_id || '@example.invalid', 'manager', true),
      (fake_manager_unrelated_id, 'Phase 1A Policy Test Manager Unrelated', 'phase1a-policy-mgr-u-' || fake_manager_unrelated_id || '@example.invalid', 'manager', true);
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIPPED profiles_select_assigned_rep_for_manager self-test: could not create throwaway profiles (%).', SQLERRM;
    RETURN;
  END;

  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', real_admin_id)::text, true);
  PERFORM public.assign_sales_rep(fake_rep_id, fake_manager_assigned_id);
  RESET ROLE;

  -- Test 1: the assigned manager CAN see the rep's profile.
  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', fake_manager_assigned_id)::text, true);
  SELECT count(*) INTO row_count FROM public.profiles WHERE id = fake_rep_id;
  RESET ROLE;
  IF row_count <> 1 THEN
    RAISE EXCEPTION 'FAILED: the assigned manager could not read their own assigned rep''s profile — expected 1, found %.', row_count;
  END IF;
  RAISE NOTICE 'PASSED: the assigned manager can read their assigned rep''s profile.';

  -- Test 2: an unrelated manager (never assigned to this rep) CANNOT see it.
  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', fake_manager_unrelated_id)::text, true);
  SELECT count(*) INTO row_count FROM public.profiles WHERE id = fake_rep_id;
  RESET ROLE;
  IF row_count <> 0 THEN
    RAISE EXCEPTION 'FAILED: an unrelated manager could read a rep''s profile they are not assigned to — expected 0, found %.', row_count;
  END IF;
  RAISE NOTICE 'PASSED: an unrelated manager cannot read a rep''s profile they are not assigned to.';

  -- Test 3: once unassigned, the FORMER manager can no longer see it.
  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', real_admin_id)::text, true);
  PERFORM public.unassign_sales_rep(fake_rep_id);
  RESET ROLE;

  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', fake_manager_assigned_id)::text, true);
  SELECT count(*) INTO row_count FROM public.profiles WHERE id = fake_rep_id;
  RESET ROLE;
  IF row_count <> 0 THEN
    RAISE EXCEPTION 'FAILED: a FORMER manager (unassigned) could still read the rep''s profile — expected 0, found %.', row_count;
  END IF;
  RAISE NOTICE 'PASSED: a former manager loses read access to the rep''s profile once unassigned.';

  -- Test 4: the sales rep can still read their own profile (pre-existing
  -- "Users can view their own profile" policy — must be entirely unaffected).
  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', fake_rep_id)::text, true);
  SELECT count(*) INTO row_count FROM public.profiles WHERE id = fake_rep_id;
  RESET ROLE;
  IF row_count <> 1 THEN
    RAISE EXCEPTION 'FAILED: the sales rep could not read their own profile — expected 1, found % (the pre-existing self-access policy was affected).', row_count;
  END IF;
  RAISE NOTICE 'PASSED: the sales rep can still read their own profile.';

  -- Test 5: an admin can still read the rep's profile regardless of
  -- assignment state (pre-existing "Admins can view all profiles" policy —
  -- must be entirely unaffected; the rep is unassigned at this point).
  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', real_admin_id)::text, true);
  SELECT count(*) INTO row_count FROM public.profiles WHERE id = fake_rep_id;
  RESET ROLE;
  IF row_count <> 1 THEN
    RAISE EXCEPTION 'FAILED: an admin could not read the rep''s profile — expected 1, found % (the pre-existing admin policy was affected).', row_count;
  END IF;
  RAISE NOTICE 'PASSED: an admin can still read any profile regardless of assignment state.';

  -- Cleanup.
  RESET request.jwt.claims;
  DELETE FROM public.rep_manager_assignments WHERE rep_id = fake_rep_id;
  DELETE FROM public.profiles WHERE id IN (fake_rep_id, fake_manager_assigned_id, fake_manager_unrelated_id);
  DELETE FROM auth.users WHERE id IN (fake_rep_id, fake_manager_assigned_id, fake_manager_unrelated_id);
  RAISE NOTICE 'Cleanup PASSED: no residual synthetic rows remain.';
END $$;

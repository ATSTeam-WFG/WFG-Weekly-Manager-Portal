-- ---------------------------------------------------------------------------
-- Phase 1 (Sales Rep Dashboard Manager Visibility) — a Sales Rep's dashboard
-- needs to show their assigned Manager's name and WFG email. Confirmed by
-- inspecting the existing profiles SELECT policies first, per the task's own
-- requirement to add this only if not already permitted:
--   "Admins can view all profiles"                        USING (is_admin())
--   "Users can view their own profile"                    USING (id = auth.uid())
--   "Managers can view their assigned Sales Reps' profiles" (20261102090000) —
--     manager reads REP, the opposite direction from what's needed here
--   "Sales Admins can view all Sales Rep profiles" (20261103090000) — also
--     the opposite direction, and scoped to role = 'sales_rep' only
-- None of these let a Sales Rep read their own assigned MANAGER's profile
-- row, so this is a genuine gap, not a duplicate of existing access.
--
-- Fix: the exact mirror image of 20261102090000's policy — same shape,
-- reversed direction. One new, additive SELECT policy, scoped as narrowly as
-- possible: only rows where role = 'manager', only for the rep's CURRENTLY
-- assigned manager (unassigned_at IS NULL, same current-assignment-only
-- standard used throughout this feature). All pre-existing policies are
-- untouched — this only adds one more case, it narrows nothing.
--
-- Recursion review (mirrors 20261102090000's own review): this policy's
-- EXISTS subquery reads rep_manager_assignments, whose SELECT policies
-- (20261027140200_rep_manager_assignments.sql) are:
--   rep_manager_assignments_select_admin        USING (is_admin())
--   rep_manager_assignments_select_own_manager   USING (manager_id = auth.uid())
--   rep_manager_assignments_select_own_rep       USING (rep_id = auth.uid())
-- For the case this policy depends on (a rep reading their own assignment
-- row), rep_manager_assignments_select_own_rep is a direct column
-- comparison with no subquery into profiles at all — the common path never
-- re-enters profiles. No cycle, no unbounded recursion.
-- ---------------------------------------------------------------------------

CREATE POLICY "Sales Reps can view their assigned Manager's profile"
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (
    role = 'manager'
    AND EXISTS (
      SELECT 1 FROM public.rep_manager_assignments
      WHERE manager_id = profiles.id
        AND rep_id = auth.uid()
        AND unassigned_at IS NULL
    )
  );

-- ---------------------------------------------------------------------------
-- Self-test: assigned rep (can see), unrelated rep (cannot), unassigned rep
-- (cannot, "Manager not assigned yet" case), reassigned rep (sees the NEW
-- manager only, never the former one), rep's own profile (unaffected), admin
-- access (unaffected).
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  real_admin_id uuid;
  fake_rep_id uuid := gen_random_uuid();
  fake_rep_unrelated_id uuid := gen_random_uuid();
  fake_manager_a_id uuid := gen_random_uuid();
  fake_manager_b_id uuid := gen_random_uuid();
  row_count integer;
BEGIN
  SELECT id INTO real_admin_id FROM public.profiles WHERE role = 'admin' AND is_active = true LIMIT 1;
  IF real_admin_id IS NULL THEN
    RAISE NOTICE 'SKIPPED profiles_select_assigned_manager_for_rep self-test: needs at least one active admin profile.';
    RETURN;
  END IF;

  BEGIN
    SET ROLE authenticated;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIPPED profiles_select_assigned_manager_for_rep self-test: this session cannot SET ROLE authenticated (%).', SQLERRM;
    RETURN;
  END;

  BEGIN
    INSERT INTO auth.users (id) VALUES (fake_rep_id), (fake_rep_unrelated_id), (fake_manager_a_id), (fake_manager_b_id);
    INSERT INTO public.profiles (id, full_name, email, role, is_active) VALUES
      (fake_rep_id, 'Phase 1 Policy Test Rep', 'phase1-policy-rep-' || fake_rep_id || '@example.invalid', 'sales_rep', true),
      (fake_rep_unrelated_id, 'Phase 1 Policy Test Rep Unrelated', 'phase1-policy-rep-u-' || fake_rep_unrelated_id || '@example.invalid', 'sales_rep', true),
      (fake_manager_a_id, 'Phase 1 Policy Test Manager A', 'phase1-policy-mgr-a-' || fake_manager_a_id || '@example.invalid', 'manager', true),
      (fake_manager_b_id, 'Phase 1 Policy Test Manager B', 'phase1-policy-mgr-b-' || fake_manager_b_id || '@example.invalid', 'manager', true);
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIPPED profiles_select_assigned_manager_for_rep self-test: could not create throwaway profiles (%).', SQLERRM;
    RETURN;
  END;

  -- Test 0 (unassigned): before any assignment exists, the rep cannot see
  -- either manager's profile — the "Manager not assigned yet" case.
  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', fake_rep_id)::text, true);
  SELECT count(*) INTO row_count FROM public.profiles WHERE id IN (fake_manager_a_id, fake_manager_b_id);
  RESET ROLE;
  IF row_count <> 0 THEN
    RAISE EXCEPTION 'FAILED: an unassigned rep could read a manager profile before any assignment existed — expected 0, found %.', row_count;
  END IF;
  RAISE NOTICE 'PASSED: a rep with no Manager assigned yet cannot read any Manager profile.';

  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', real_admin_id)::text, true);
  PERFORM public.assign_sales_rep(fake_rep_id, fake_manager_a_id);
  RESET ROLE;

  -- Test 1: the assigned rep CAN see their manager's profile.
  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', fake_rep_id)::text, true);
  SELECT count(*) INTO row_count FROM public.profiles WHERE id = fake_manager_a_id;
  RESET ROLE;
  IF row_count <> 1 THEN
    RAISE EXCEPTION 'FAILED: the assigned rep could not read their own assigned manager''s profile — expected 1, found %.', row_count;
  END IF;
  RAISE NOTICE 'PASSED: the assigned rep can read their assigned manager''s profile.';

  -- Test 2: an unrelated rep (never assigned to this manager) CANNOT see it.
  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', fake_rep_unrelated_id)::text, true);
  SELECT count(*) INTO row_count FROM public.profiles WHERE id = fake_manager_a_id;
  RESET ROLE;
  IF row_count <> 0 THEN
    RAISE EXCEPTION 'FAILED: an unrelated rep could read a manager''s profile they are not assigned to — expected 0, found %.', row_count;
  END IF;
  RAISE NOTICE 'PASSED: an unrelated rep cannot read a manager''s profile they are not assigned to.';

  -- Test 3 (reassigned): reassign the rep from Manager A to Manager B. The
  -- rep must see ONLY the new manager, never the former one.
  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', real_admin_id)::text, true);
  PERFORM public.assign_sales_rep(fake_rep_id, fake_manager_b_id);
  RESET ROLE;

  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', fake_rep_id)::text, true);
  SELECT count(*) INTO row_count FROM public.profiles WHERE id = fake_manager_b_id;
  RESET ROLE;
  IF row_count <> 1 THEN
    RAISE EXCEPTION 'FAILED: a reassigned rep could not read their NEW manager''s profile — expected 1, found %.', row_count;
  END IF;
  RAISE NOTICE 'PASSED: a reassigned rep can read their new manager''s profile.';

  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', fake_rep_id)::text, true);
  SELECT count(*) INTO row_count FROM public.profiles WHERE id = fake_manager_a_id;
  RESET ROLE;
  IF row_count <> 0 THEN
    RAISE EXCEPTION 'FAILED: a reassigned rep could still read their FORMER manager''s profile — expected 0, found %.', row_count;
  END IF;
  RAISE NOTICE 'PASSED: a reassigned rep loses read access to their former manager''s profile.';

  -- Test 4: the rep can still read their own profile (pre-existing
  -- "Users can view their own profile" policy — must be entirely unaffected).
  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', fake_rep_id)::text, true);
  SELECT count(*) INTO row_count FROM public.profiles WHERE id = fake_rep_id;
  RESET ROLE;
  IF row_count <> 1 THEN
    RAISE EXCEPTION 'FAILED: the rep could not read their own profile — expected 1, found % (the pre-existing self-access policy was affected).', row_count;
  END IF;
  RAISE NOTICE 'PASSED: the rep can still read their own profile.';

  -- Test 5: an admin can still read any profile regardless of this new policy.
  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', real_admin_id)::text, true);
  SELECT count(*) INTO row_count FROM public.profiles WHERE id IN (fake_manager_a_id, fake_manager_b_id, fake_rep_id);
  RESET ROLE;
  IF row_count <> 3 THEN
    RAISE EXCEPTION 'FAILED: an admin could not read all three profiles — expected 3, found % (the pre-existing admin policy was affected).', row_count;
  END IF;
  RAISE NOTICE 'PASSED: an admin can still read any profile regardless of this new policy.';

  -- Cleanup.
  RESET request.jwt.claims;
  DELETE FROM public.rep_manager_assignments WHERE rep_id IN (fake_rep_id, fake_rep_unrelated_id);
  DELETE FROM public.profiles WHERE id IN (fake_rep_id, fake_rep_unrelated_id, fake_manager_a_id, fake_manager_b_id);
  DELETE FROM auth.users WHERE id IN (fake_rep_id, fake_rep_unrelated_id, fake_manager_a_id, fake_manager_b_id);
  RAISE NOTICE 'Cleanup PASSED: no residual synthetic rows remain.';
END $$;

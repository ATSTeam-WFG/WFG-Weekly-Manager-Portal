-- Security fix found during this phase's own verification work (item 7:
-- "verify reassignment and deactivation do not leave unauthorized access
-- through stale sessions"). DRAFT — not applied to Preview or Production.
--
-- Two existing, pre-existing profiles policies never check the CALLING
-- user's own is_active status — only that an active (unassigned_at IS
-- NULL) assignment row exists between them and the target:
--   "Managers can view their assigned Sales Reps' profiles" (20261102090000)
--   "Sales Reps can view their assigned Manager's profile"  (20261104090000)
-- Every OTHER sensitive policy/RPC in this schema (is_assigned_manager_of,
-- is_admin, is_sales_admin, is_global_report_viewer,
-- shares_current_manager_with, save_rep_report_draft, etc.) already
-- re-checks the caller's own profiles.is_active fresh on every call — this
-- is the one place that doesn't. Practical impact found via this phase's
-- own revocation self-test: a DEACTIVATED Manager retains the ability to
-- read their former Sales Reps' name/email (not report content — the
-- rep_reports policy already correctly blocks that) through an
-- already-"authenticated" session, because this policy alone never
-- re-checks their own active status. Same issue in the mirror direction
-- (a deactivated rep could still read their former manager's name/email).
--
-- caller_is_active() — a tiny SECURITY DEFINER helper, exactly the same
-- technique is_assigned_manager_of()/is_admin()/is_sales_admin() already
-- use to read `profiles` safely from inside a policy that is itself ON
-- `profiles`. A SECURITY DEFINER function runs as its OWNER (not the
-- calling role), so its own internal query against profiles is NOT
-- itself subject to these same profiles RLS policies — it never
-- re-triggers them. Inlining the equivalent EXISTS subquery directly in
-- the policy body instead (the first version of this fix, caught by this
-- migration's own first test run) causes Postgres to report "infinite
-- recursion detected in policy for relation profiles", because that form
-- queries profiles from within a policy ON profiles under the SAME
-- (RLS-subject) calling role.
CREATE OR REPLACE FUNCTION public.caller_is_active()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_active = true);
$$;

REVOKE ALL ON FUNCTION public.caller_is_active() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.caller_is_active() FROM anon;
GRANT EXECUTE ON FUNCTION public.caller_is_active() TO authenticated;

-- Fix: replace each policy's body with the exact same shape, with one
-- added condition — the caller's own profile is active. Nothing about
-- WHO is reachable through these policies changes on the other (target)
-- side; this narrows only the CALLER side, and only by excluding callers
-- who were already supposed to have zero access everywhere else.
DROP POLICY IF EXISTS "Managers can view their assigned Sales Reps' profiles" ON public.profiles;
CREATE POLICY "Managers can view their assigned Sales Reps' profiles"
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (
    role = 'sales_rep'
    AND public.caller_is_active()
    AND EXISTS (
      SELECT 1 FROM public.rep_manager_assignments
      WHERE rep_id = profiles.id
        AND manager_id = auth.uid()
        AND unassigned_at IS NULL
    )
  );

DROP POLICY IF EXISTS "Sales Reps can view their assigned Manager's profile" ON public.profiles;
CREATE POLICY "Sales Reps can view their assigned Manager's profile"
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (
    role = 'manager'
    AND public.caller_is_active()
    AND EXISTS (
      SELECT 1 FROM public.rep_manager_assignments
      WHERE manager_id = profiles.id
        AND rep_id = auth.uid()
        AND unassigned_at IS NULL
    )
  );

-- ---------------------------------------------------------------------------
-- Self-test: a deactivated Manager can no longer read their former Sales
-- Rep's profile; a deactivated Sales Rep can no longer read their former
-- Manager's profile. Both checked under a real simulated session (same
-- set_config + SET LOCAL ROLE technique as this phase's other migrations).
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_mgr uuid := gen_random_uuid();
  v_rep uuid := gen_random_uuid();
  v_count int;
BEGIN
  INSERT INTO auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  SELECT x.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', x.id::text || '@activecheckfixtest.invalid', '{}'::jsonb, '{}'::jsonb, now(), now()
  FROM (VALUES (v_mgr), (v_rep)) AS x(id);

  INSERT INTO public.profiles (id, full_name, email, role, is_active, submits_weekly_report)
  VALUES (v_mgr, 'ActiveCheckFix Manager', v_mgr::text || '@activecheckfixtest.invalid', 'manager', true, false),
         (v_rep, 'ActiveCheckFix Rep', v_rep::text || '@activecheckfixtest.invalid', 'sales_rep', true, false);

  INSERT INTO public.rep_manager_assignments (rep_id, manager_id, assigned_by) VALUES (v_rep, v_mgr, v_mgr);

  -- Both sides can see each other while both are active (sanity baseline).
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_mgr)::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_count FROM public.profiles WHERE id = v_rep;
  RESET ROLE;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'SELF_TEST_FAILED: active manager could not see their active rep (baseline broken)';
  END IF;

  -- Deactivate the Manager; they must immediately lose visibility into
  -- their former rep's profile.
  UPDATE public.profiles SET is_active = false WHERE id = v_mgr;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_mgr)::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_count FROM public.profiles WHERE id = v_rep;
  RESET ROLE;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'SELF_TEST_FAILED: a deactivated manager could still read their former rep''s profile';
  END IF;
  RAISE NOTICE 'SELF_TEST_PASSED: a deactivated manager loses profile visibility into their former rep';

  -- Reactivate the manager, deactivate the rep instead; the REP must
  -- immediately lose visibility into the manager's profile.
  UPDATE public.profiles SET is_active = true WHERE id = v_mgr;
  UPDATE public.profiles SET is_active = false WHERE id = v_rep;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_rep)::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_count FROM public.profiles WHERE id = v_mgr;
  RESET ROLE;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'SELF_TEST_FAILED: a deactivated rep could still read their former manager''s profile';
  END IF;
  RAISE NOTICE 'SELF_TEST_PASSED: a deactivated rep loses profile visibility into their former manager';

  DELETE FROM public.rep_manager_assignments WHERE rep_id = v_rep AND manager_id = v_mgr;
  DELETE FROM public.profiles WHERE id IN (v_mgr, v_rep);
  DELETE FROM auth.users WHERE id IN (v_mgr, v_rep);
  RAISE NOTICE 'SELF_TEST_PASSED: cleanup complete, no residual test data';
END;
$$;

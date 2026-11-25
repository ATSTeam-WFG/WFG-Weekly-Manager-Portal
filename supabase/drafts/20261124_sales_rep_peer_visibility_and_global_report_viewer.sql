-- Reporting hierarchy & access phase (2026-11-24) — two independent,
-- additive features. This is a DRAFT migration — review and apply
-- explicitly; do not run against Preview or Production without separate
-- approval. Nothing here drops, renames, or weakens any existing column,
-- function, or policy.
--
-- 1. Sales Rep peer visibility ("Team Reports" for Sales Reps): a Sales
--    Rep may see their teammates' (other reps sharing their own CURRENT
--    manager) name/email and SUBMITTED-only report rows — never a
--    teammate's draft, never anyone on a different team. Enforced at the
--    RLS layer via one shared helper, shares_current_manager_with(), so a
--    direct API/database request can never see more than the UI does.
--
-- 2. Global report viewer (Gene Rebadow / Joey Grampa requirement): a new,
--    narrowly-scoped, role-independent boolean flag
--    (profiles.global_report_viewer) grants read-only visibility into
--    every Sales Rep's SUBMITTED reports across every Manager. It is NOT a
--    role — it can be set on any existing role (Admin, Manager, Sales
--    Admin) without changing that role's own permissions, and it never
--    grants write access to anything. An Admin already sees everything,
--    so this flag is a no-op for an Admin; it is additive for every other
--    role.
--
-- Both features reuse the existing assign/unassign/status machinery
-- untouched — no change to any write path, no new report status.

-- ---------------------------------------------------------------------------
-- 1a. shares_current_manager_with(p_other_rep_id) — true iff the CALLER is
-- a currently-active sales_rep who currently has an active assignment to
-- the same manager p_other_rep_id is currently (also actively) assigned
-- to, AND p_other_rep_id's own profile is still active. Both assignment
-- sides require unassigned_at IS NULL — a former teammate (either side
-- reassigned away) stops matching immediately, exactly like
-- is_assigned_manager_of()'s own "current assignment only" standard. The
-- target-is-active check (added after this migration's own local browser
-- testing surfaced a deactivated teammate still appearing in "Team
-- Reports") keeps a revoked employee out of their former teammates'
-- everyday view without touching their historical report/assignment rows
-- at all — an Admin/former-manager/global-viewer can still see them
-- through their own, separate policies. SECURITY DEFINER so a caller's
-- own RLS on rep_manager_assignments/profiles (which otherwise only lets
-- them see their OWN rows) never blocks this function from reading the
-- rows it needs to evaluate the check itself.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.shares_current_manager_with(p_other_rep_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.rep_manager_assignments mine
    JOIN public.rep_manager_assignments theirs
      ON theirs.manager_id = mine.manager_id
     AND theirs.rep_id = p_other_rep_id
     AND theirs.unassigned_at IS NULL
    JOIN public.profiles target
      ON target.id = p_other_rep_id
     AND target.is_active = true
    JOIN public.profiles caller
      ON caller.id = auth.uid()
     AND caller.role = 'sales_rep'
     AND caller.is_active = true
    WHERE mine.rep_id = auth.uid()
      AND mine.unassigned_at IS NULL
      AND p_other_rep_id <> auth.uid()
  );
$$;

REVOKE ALL ON FUNCTION public.shares_current_manager_with(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.shares_current_manager_with(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.shares_current_manager_with(uuid) TO authenticated;

-- 1b. The three read policies this feature needs. Each is additive — it
-- only ever adds visibility on top of what a rep already has (their own
-- row), never replaces or narrows an existing policy.
CREATE POLICY rep_manager_assignments_select_teammate
  ON public.rep_manager_assignments
  FOR SELECT
  TO authenticated
  USING (public.shares_current_manager_with(rep_id));

CREATE POLICY profiles_select_teammate
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (role = 'sales_rep' AND public.shares_current_manager_with(id));

-- status = 'submitted' is baked directly into the USING clause — a
-- teammate's draft is never selectable through this policy no matter what
-- the client asks for, so hiding an "Edit"/"Feedback" button in the UI is
-- not the thing doing the work here.
CREATE POLICY rep_reports_select_teammate
  ON public.rep_reports
  FOR SELECT
  TO authenticated
  USING (status = 'submitted' AND public.shares_current_manager_with(rep_id));

-- ---------------------------------------------------------------------------
-- 2a. global_report_viewer — additive column, defaults false for every
-- existing row (including Admins, for whom it is simply redundant).
-- ---------------------------------------------------------------------------
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS global_report_viewer boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.is_global_report_viewer()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND is_active = true AND global_report_viewer = true
  );
$$;

REVOKE ALL ON FUNCTION public.is_global_report_viewer() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_global_report_viewer() FROM anon;
GRANT EXECUTE ON FUNCTION public.is_global_report_viewer() TO authenticated;

-- 2b. Just enough read access to build the same compact "Sales Rep
-- Reporting" list/expand UI Admin already has (AdminManagerRepOverview),
-- reused rather than duplicated: every Manager's and Sales Rep's basic
-- identity, every current assignment (to resolve who reports to whom),
-- and every SUBMITTED rep_reports row. Never draft content, never write
-- access to anything, never Admin-only fields.
CREATE POLICY profiles_select_global_viewer
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (public.is_global_report_viewer() AND role IN ('sales_rep', 'manager'));

CREATE POLICY rep_manager_assignments_select_global_viewer
  ON public.rep_manager_assignments
  FOR SELECT
  TO authenticated
  USING (public.is_global_report_viewer());

CREATE POLICY rep_reports_select_global_viewer
  ON public.rep_reports
  FOR SELECT
  TO authenticated
  USING (public.is_global_report_viewer() AND status = 'submitted');

-- ---------------------------------------------------------------------------
-- Self-test — run after the statements above. Builds two managers, four
-- reps (2+1 split across the two managers, matching the required test
-- matrix), one global-viewer-flagged profile, and one deactivated rep,
-- then checks every permitted/denied case under a real simulated caller
-- context (set_config('request.jwt.claims', ...)), the same technique
-- already used by this project's other migration self-tests.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_mgr_a uuid := gen_random_uuid();
  v_mgr_b uuid := gen_random_uuid();
  v_rep_a1 uuid := gen_random_uuid();
  v_rep_a2 uuid := gen_random_uuid();
  v_rep_b1 uuid := gen_random_uuid();
  v_viewer uuid := gen_random_uuid();
  v_deactivated_rep uuid := gen_random_uuid();
  v_assignment_a1 uuid;
  v_week date := '2099-01-05';
  v_count int;
BEGIN
  -- auth.users rows (profiles.id FK) — local self-test only.
  INSERT INTO auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  SELECT x.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', x.id::text || '@selftest.invalid', '{}'::jsonb, '{}'::jsonb, now(), now()
  FROM (VALUES (v_mgr_a), (v_mgr_b), (v_rep_a1), (v_rep_a2), (v_rep_b1), (v_viewer), (v_deactivated_rep)) AS x(id)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.profiles (id, full_name, email, role, is_active, submits_weekly_report)
  VALUES
    (v_mgr_a, 'Self-Test Manager A', v_mgr_a::text || '@selftest.invalid', 'manager', true, false),
    (v_mgr_b, 'Self-Test Manager B', v_mgr_b::text || '@selftest.invalid', 'manager', true, false),
    (v_rep_a1, 'Self-Test Rep A1', v_rep_a1::text || '@selftest.invalid', 'sales_rep', true, false),
    (v_rep_a2, 'Self-Test Rep A2', v_rep_a2::text || '@selftest.invalid', 'sales_rep', true, false),
    (v_rep_b1, 'Self-Test Rep B1', v_rep_b1::text || '@selftest.invalid', 'sales_rep', true, false),
    -- Deliberately role='manager', never 'admin': an admin already has
    -- unconditional access via the pre-existing profiles_select_admin /
    -- rep_reports_select_admin policies, which would make this test pass
    -- for the wrong reason and mask a broken global_report_viewer policy.
    -- Using an unrelated Manager (no assignment to any of the test reps)
    -- isolates the flag's own effect.
    (v_viewer, 'Self-Test Global Viewer', v_viewer::text || '@selftest.invalid', 'manager', true, false),
    (v_deactivated_rep, 'Self-Test Deactivated Rep', v_deactivated_rep::text || '@selftest.invalid', 'sales_rep', false, false)
  ON CONFLICT (id) DO NOTHING;

  UPDATE public.profiles SET global_report_viewer = true WHERE id = v_viewer;

  INSERT INTO public.rep_manager_assignments (rep_id, manager_id, assigned_by)
  VALUES (v_rep_a1, v_mgr_a, v_mgr_a) RETURNING id INTO v_assignment_a1;
  INSERT INTO public.rep_manager_assignments (rep_id, manager_id, assigned_by)
  VALUES (v_rep_a2, v_mgr_a, v_mgr_a);
  INSERT INTO public.rep_manager_assignments (rep_id, manager_id, assigned_by)
  VALUES (v_rep_b1, v_mgr_b, v_mgr_b);

  INSERT INTO public.rep_reports (rep_id, week_start_date, status, submission_source, submitted_at, first_submitted_at, content, owning_assignment_id)
  VALUES
    (v_rep_a1, v_week, 'submitted', 'manual', now(), now(), '{}'::jsonb, v_assignment_a1),
    (v_rep_a2, v_week, 'draft', NULL, NULL, NULL, '{}'::jsonb, NULL),
    (v_rep_b1, v_week, 'submitted', 'manual', now(), now(), '{}'::jsonb, NULL);

  -- Every check below runs as the real `authenticated` Postgres role (not
  -- the `postgres` superuser this whole block otherwise runs as) — RLS is
  -- enforced per-role, and a superuser/BYPASSRLS role never has policies
  -- applied to it at all regardless of the simulated JWT claims GUC. Each
  -- "as <caller>" section ends with RESET ROLE so the following setup/
  -- cleanup statements can write as postgres again.

  -- Test 1: Rep A1 sees Rep A2's profile (same manager) but NOT Rep A2's
  -- draft report, and does NOT see Rep B1 (different manager) at all.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_rep_a1)::text, true);
  SET LOCAL ROLE authenticated;

  SELECT count(*) INTO v_count FROM public.profiles WHERE id = v_rep_a2;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'SELF_TEST_FAILED: Rep A1 could not see teammate Rep A2''s profile';
  END IF;

  SELECT count(*) INTO v_count FROM public.rep_reports WHERE rep_id = v_rep_a2 AND week_start_date = v_week;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'SELF_TEST_FAILED: Rep A1 could see teammate Rep A2''s DRAFT report — must be zero rows';
  END IF;

  SELECT count(*) INTO v_count FROM public.profiles WHERE id = v_rep_b1;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'SELF_TEST_FAILED: Rep A1 could see Rep B1''s profile — different manager, must be zero rows';
  END IF;

  SELECT count(*) INTO v_count FROM public.rep_reports WHERE rep_id = v_rep_b1 AND week_start_date = v_week;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'SELF_TEST_FAILED: Rep A1 could see Rep B1''s submitted report — different manager, must be zero rows';
  END IF;
  RESET ROLE;

  RAISE NOTICE 'SELF_TEST_PASSED: Rep A1 sees A2''s profile and submitted-only visibility, zero cross-team leakage';

  -- Test 2: a submitted report DOES become visible to a teammate.
  UPDATE public.rep_reports SET status = 'submitted', submission_source = 'manual', submitted_at = now(), first_submitted_at = now()
  WHERE rep_id = v_rep_a2 AND week_start_date = v_week;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_rep_a1)::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_count FROM public.rep_reports WHERE rep_id = v_rep_a2 AND week_start_date = v_week;
  RESET ROLE;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'SELF_TEST_FAILED: Rep A1 could not see teammate Rep A2''s SUBMITTED report';
  END IF;
  RAISE NOTICE 'SELF_TEST_PASSED: a teammate''s submitted report becomes visible once actually submitted';

  -- Test 3: a deactivated rep loses teammate visibility entirely, even
  -- though their assignment row itself still exists (never deleted).
  INSERT INTO public.rep_manager_assignments (rep_id, manager_id, assigned_by)
  VALUES (v_deactivated_rep, v_mgr_a, v_mgr_a);

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_deactivated_rep)::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_count FROM public.profiles WHERE id = v_rep_a1;
  RESET ROLE;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'SELF_TEST_FAILED: a deactivated rep could still see a teammate''s profile';
  END IF;
  RAISE NOTICE 'SELF_TEST_PASSED: a deactivated rep has zero teammate visibility';

  -- Test 4: the global report viewer sees every manager's reps and every
  -- submitted report, but never a draft.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_viewer)::text, true);
  SET LOCAL ROLE authenticated;

  SELECT count(*) INTO v_count FROM public.profiles WHERE id IN (v_rep_a1, v_rep_a2, v_rep_b1);
  IF v_count <> 3 THEN
    RAISE EXCEPTION 'SELF_TEST_FAILED: global viewer expected to see all 3 reps'' profiles, saw %', v_count;
  END IF;

  SELECT count(*) INTO v_count FROM public.rep_reports WHERE week_start_date = v_week AND status = 'submitted';
  IF v_count <> 3 THEN
    RAISE EXCEPTION 'SELF_TEST_FAILED: global viewer expected to see 3 submitted reports, saw %', v_count;
  END IF;
  RESET ROLE;
  RAISE NOTICE 'SELF_TEST_PASSED: global report viewer sees all managers'' reps and all submitted reports';

  -- Test 5: flipping the flag off removes access immediately — no stale
  -- grant survives a revocation.
  UPDATE public.profiles SET global_report_viewer = false WHERE id = v_viewer;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_viewer)::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_count FROM public.profiles WHERE id IN (v_rep_a1, v_rep_a2, v_rep_b1);
  RESET ROLE;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'SELF_TEST_FAILED: global viewer retained access after global_report_viewer was set back to false';
  END IF;
  RAISE NOTICE 'SELF_TEST_PASSED: revoking global_report_viewer removes access immediately';

  -- Cleanup — remove only the synthetic rows this block created.
  RESET request.jwt.claims;
  DELETE FROM public.rep_reports WHERE week_start_date = v_week AND rep_id IN (v_rep_a1, v_rep_a2, v_rep_b1);
  DELETE FROM public.rep_manager_assignments WHERE rep_id IN (v_rep_a1, v_rep_a2, v_rep_b1, v_deactivated_rep);
  DELETE FROM public.profiles WHERE id IN (v_mgr_a, v_mgr_b, v_rep_a1, v_rep_a2, v_rep_b1, v_viewer, v_deactivated_rep);
  DELETE FROM auth.users WHERE id IN (v_mgr_a, v_mgr_b, v_rep_a1, v_rep_a2, v_rep_b1, v_viewer, v_deactivated_rep);

  RAISE NOTICE 'SELF_TEST_PASSED: cleanup complete, no residual test data';
END;
$$;

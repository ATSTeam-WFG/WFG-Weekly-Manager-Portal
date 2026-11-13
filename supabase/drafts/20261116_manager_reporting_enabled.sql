-- DRAFT ONLY — do not move into supabase/migrations or apply until
-- reviewed and approved.
--
-- Dual-role support: a Sales Admin who ALSO completes their own Weekly
-- Manager Report (a dual-role Sales-Admin-as-Manager-submitter) — additive
-- only, following the exact precedent already shipped in
-- 20260922_submits_weekly_report.sql for a dual-role admin submitter. No
-- existing column is renamed or dropped, no existing RLS policy's text is
-- touched, and the only existing object whose BODY changes is
-- is_manager_or_admin_caller() (refined in place below, not replaced with a
-- new function, since the authorization condition itself must widen).
-- Every other object in this migration is new and additive.
--
-- manager_reporting_enabled is an explicit, separately-set boolean column
-- on BOTH approved_employees and profiles, mirroring submits_weekly_report
-- exactly. It is NEVER inferred from role: role still answers "what can
-- this person administer" (sales_admin keeps every existing Sales Admin
-- capability, completely unchanged), and manager_reporting_enabled answers
-- "does this person also have their own Weekly Manager Report to complete"
-- — a dual-role Sales Admin needs role='sales_admin' AND
-- manager_reporting_enabled=true, simultaneously, with neither implying
-- the other. Every existing Manager is unaffected (role='manager' alone
-- already grants this; see is_manager_capable() below). Every existing
-- Sales Admin is backfilled to false and stays false unless a specific
-- person is later, explicitly changed — this migration flags no one.
--
-- SCOPE, deliberately narrow (explicitly requested): this grants ONLY the
-- ability to complete/view the account's own Weekly Manager Report (the
-- `reports` table). It does NOT grant Sales Rep roster/assignment
-- management, and does not touch is_assigned_manager_of(), the Manager
-- self-service Add/Edit/Remove Sales Rep drafts, or
-- api/_lib/managerAuth.ts — those remain exactly as they are today,
-- disabled and unrelated to this change.

-- ---------------------------------------------------------------------------
-- 1) Schema — additive, NOT NULL with a safe default, identical shape to
--    submits_weekly_report.
-- ---------------------------------------------------------------------------
ALTER TABLE approved_employees ADD COLUMN IF NOT EXISTS manager_reporting_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS manager_reporting_enabled boolean NOT NULL DEFAULT false;

-- ---------------------------------------------------------------------------
-- 2) Helper function — same house style as is_admin()/is_sales_admin()
--    (SQL, STABLE, SECURITY DEFINER, reads only the caller's own row via
--    auth.uid()). True for an active Manager (unconditionally — unchanged
--    from today) or an active Sales Admin explicitly flagged
--    manager_reporting_enabled = true. False for every other role, and
--    false for an inactive profile regardless of role or flag.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_manager_capable() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.is_active = true
      AND (p.role = 'manager' OR (p.role = 'sales_admin' AND p.manager_reporting_enabled = true))
  )
$$;

REVOKE ALL ON FUNCTION public.is_manager_capable() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_manager_capable() FROM anon;
GRANT EXECUTE ON FUNCTION public.is_manager_capable() TO authenticated;

-- ---------------------------------------------------------------------------
-- 3) Widen is_manager_or_admin_caller() (defined in
--    20261027140100_reports_restrict_to_manager_admin.sql) — the single
--    RESTRICTIVE-policy helper that gates INSERT/UPDATE/SELECT on the
--    `reports` table (the Weekly Manager Report table) to Manager/Admin
--    only. This is the one and only authorization chokepoint that needs to
--    change for a dual-role Sales Admin to complete their own report:
--    the underlying PERMISSIVE ownership policies on `reports` only check
--    `manager_id = auth.uid()`, never role, so widening this one function
--    is sufficient — no policy text needs to be rediscovered or touched.
--    Previous body: role IN ('manager', 'admin') AND is_active = true.
--    New body: unchanged admin branch, OR is_manager_capable() (which
--    itself already covers the unchanged plain-Manager case).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_manager_or_admin_caller()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid()
      AND role = 'admin'
      AND is_active = true
  ) OR public.is_manager_capable();
$$;

-- REVOKE/GRANT unchanged from the original migration — restated for
-- certainty (CREATE OR REPLACE preserves existing grants for an unchanged
-- signature, but this makes it explicit rather than assumed).
REVOKE ALL ON FUNCTION public.is_manager_or_admin_caller() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_manager_or_admin_caller() FROM anon;
GRANT EXECUTE ON FUNCTION public.is_manager_or_admin_caller() TO authenticated;

-- ---------------------------------------------------------------------------
-- Self-verifying test. Fully synthetic — no real data touched. Confirms:
-- a plain sales_admin (flag false, the default/today's-state for every
-- existing Sales Admin) is unaffected; a sales_admin WITH the flag can
-- read/write their own `reports` row through the real authenticated role
-- (not just superuser); a plain manager is unaffected either way; the flag
-- alone, without role='sales_admin' or role='manager', grants nothing (an
-- inactive dual-role profile is denied); and is_manager_capable() itself
-- behaves correctly in isolation.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  fake_admin_id uuid := gen_random_uuid();
  fake_manager_id uuid := gen_random_uuid();
  fake_plain_sales_admin_id uuid := gen_random_uuid();
  fake_dual_sales_admin_id uuid := gen_random_uuid();
  fake_inactive_dual_sales_admin_id uuid := gen_random_uuid();
  v_count integer;
BEGIN
  BEGIN
    INSERT INTO auth.users (id) VALUES
      (fake_admin_id), (fake_manager_id), (fake_plain_sales_admin_id),
      (fake_dual_sales_admin_id), (fake_inactive_dual_sales_admin_id);
    INSERT INTO public.profiles (id, full_name, email, role, is_active, manager_reporting_enabled) VALUES
      (fake_admin_id, 'Manager-Reporting Test Admin', 'mgr-reporting-test-admin-' || fake_admin_id || '@example.invalid', 'admin', true, false),
      (fake_manager_id, 'Manager-Reporting Test Manager', 'mgr-reporting-test-mgr-' || fake_manager_id || '@example.invalid', 'manager', true, false),
      (fake_plain_sales_admin_id, 'Manager-Reporting Test Plain Sales Admin', 'mgr-reporting-test-plain-sa-' || fake_plain_sales_admin_id || '@example.invalid', 'sales_admin', true, false),
      (fake_dual_sales_admin_id, 'Manager-Reporting Test Dual Sales Admin', 'mgr-reporting-test-dual-sa-' || fake_dual_sales_admin_id || '@example.invalid', 'sales_admin', true, true),
      (fake_inactive_dual_sales_admin_id, 'Manager-Reporting Test Inactive Dual Sales Admin', 'mgr-reporting-test-inactive-dual-sa-' || fake_inactive_dual_sales_admin_id || '@example.invalid', 'sales_admin', false, true);
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIPPED manager_reporting_enabled self-test: could not create throwaway profiles (%).', SQLERRM;
    RETURN;
  END;

  -- is_manager_capable() in isolation, as superuser (just exercising its
  -- own SQL logic directly — no role simulation needed for a plain,
  -- non-SECURITY-DEFINER-caller-sensitive read of these specific rows).
  PERFORM set_config('request.jwt.claims', json_build_object('sub', fake_plain_sales_admin_id)::text, true);
  SET ROLE authenticated;
  IF public.is_manager_capable() IS NOT FALSE THEN
    RESET ROLE;
    RAISE EXCEPTION 'FAILED: is_manager_capable() returned true for a plain Sales Admin (flag false).';
  END IF;
  RESET ROLE;
  RAISE NOTICE 'PASSED: is_manager_capable() denies a plain Sales Admin (flag false).';

  PERFORM set_config('request.jwt.claims', json_build_object('sub', fake_dual_sales_admin_id)::text, true);
  SET ROLE authenticated;
  IF public.is_manager_capable() IS NOT TRUE THEN
    RESET ROLE;
    RAISE EXCEPTION 'FAILED: is_manager_capable() returned false for a dual-role Sales Admin (flag true, active).';
  END IF;
  RESET ROLE;
  RAISE NOTICE 'PASSED: is_manager_capable() permits an active Sales Admin with the flag set.';

  PERFORM set_config('request.jwt.claims', json_build_object('sub', fake_inactive_dual_sales_admin_id)::text, true);
  SET ROLE authenticated;
  IF public.is_manager_capable() IS NOT FALSE THEN
    RESET ROLE;
    RAISE EXCEPTION 'FAILED: is_manager_capable() returned true for an INACTIVE Sales Admin, even with the flag set.';
  END IF;
  RESET ROLE;
  RAISE NOTICE 'PASSED: is_manager_capable() denies an inactive profile regardless of the flag.';

  PERFORM set_config('request.jwt.claims', json_build_object('sub', fake_manager_id)::text, true);
  SET ROLE authenticated;
  IF public.is_manager_capable() IS NOT TRUE THEN
    RESET ROLE;
    RAISE EXCEPTION 'FAILED: is_manager_capable() returned false for a plain, active Manager — unrelated to this change.';
  END IF;
  RESET ROLE;
  RAISE NOTICE 'PASSED: a plain active Manager is unaffected (still permitted).';

  -- End-to-end through the real `reports` table, as the real authenticated
  -- role: a plain Sales Admin (flag false) cannot insert a reports row for
  -- themselves; a dual-role Sales Admin (flag true) can.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', fake_plain_sales_admin_id)::text, true);
  SET ROLE authenticated;
  BEGIN
    INSERT INTO public.reports (manager_id, week_start_date, status)
      VALUES (fake_plain_sales_admin_id, '2026-11-09', 'draft');
    RESET ROLE;
    RAISE EXCEPTION 'FAILED: a plain Sales Admin (flag false) was able to INSERT into reports.';
  EXCEPTION WHEN insufficient_privilege THEN
    RESET ROLE;
    RAISE NOTICE 'PASSED: a plain Sales Admin (flag false) cannot INSERT into reports — unchanged from today.';
  END;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', fake_dual_sales_admin_id)::text, true);
  SET ROLE authenticated;
  INSERT INTO public.reports (manager_id, week_start_date, status)
    VALUES (fake_dual_sales_admin_id, '2026-11-09', 'draft');
  RESET ROLE;
  SELECT count(*) INTO v_count FROM public.reports WHERE manager_id = fake_dual_sales_admin_id;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'FAILED: a dual-role Sales Admin (flag true) could not INSERT their own reports row.';
  END IF;
  RAISE NOTICE 'PASSED: a dual-role Sales Admin (flag true) can INSERT their own reports row, through the real authenticated role.';

  -- And can read it back.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', fake_dual_sales_admin_id)::text, true);
  SET ROLE authenticated;
  SELECT count(*) INTO v_count FROM public.reports WHERE manager_id = fake_dual_sales_admin_id;
  RESET ROLE;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'FAILED: a dual-role Sales Admin (flag true) could not SELECT their own reports row back.';
  END IF;
  RAISE NOTICE 'PASSED: a dual-role Sales Admin (flag true) can SELECT their own reports row back.';

  -- Cleanup.
  RESET request.jwt.claims;
  DELETE FROM public.reports WHERE manager_id IN (fake_dual_sales_admin_id, fake_plain_sales_admin_id);
  DELETE FROM public.profiles WHERE id IN (fake_admin_id, fake_manager_id, fake_plain_sales_admin_id, fake_dual_sales_admin_id, fake_inactive_dual_sales_admin_id);
  DELETE FROM auth.users WHERE id IN (fake_admin_id, fake_manager_id, fake_plain_sales_admin_id, fake_dual_sales_admin_id, fake_inactive_dual_sales_admin_id);
  RAISE NOTICE 'Cleanup PASSED: no residual synthetic rows remain.';
END $$;

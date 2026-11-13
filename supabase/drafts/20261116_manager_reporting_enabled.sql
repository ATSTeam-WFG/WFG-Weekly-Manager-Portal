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
--
-- ALREADY APPLIED to Preview (asojatcycijoikeovibs) and Production
-- (sfkscotirqwlbdaeywii) — verified in both. Kept here for documentation
-- and so a fresh environment reaches the same schema from scratch.

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

-- No embedded self-test in this file by request — verify with the
-- separate, read-only query provided alongside this migration instead of
-- a DO $$ block that creates temporary auth.users/reports rows.

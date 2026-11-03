-- ---------------------------------------------------------------------------
-- Sales Admin — a new, distinct, least-privilege role. NOT a widening of
-- is_admin()/'admin': is_admin() stays admin-only everywhere, unchanged, in
-- this migration. Every existing policy/RPC that keys off is_admin() (the
-- rep_reports/rep_report_review_history/governance-table SELECT policies,
-- review_rep_report, grant_rep_report_late_submission_exception) continues
-- to treat a sales_admin exactly like any other non-admin caller — which is
-- exactly the required behavior (Sales Admin must never approve/reject a
-- report or grant a late exception).
--
-- This migration adds a brand new, separate helper (is_sales_admin()) and
-- grants it access ONLY where explicitly required:
--   - profiles:   read ALL sales_rep rows (not just assigned ones) — never
--                 manager/admin rows (Manager names for the assignment
--                 selector are served through the existing, already-narrow
--                 list-managers.ts/listActiveManagers() service-role-backed
--                 endpoint instead — {id, fullName} only, no RLS grant
--                 needed or added here).
--   - rep_reports: read ALL rows (any rep, any manager) — read-only; no
--                 write policy is added, and review_rep_report's own
--                 authorization (is_assigned_manager_of OR is_admin) is
--                 untouched, so a sales_admin still cannot approve/reject.
--   - assign_sales_rep / unassign_sales_rep: CREATE OR REPLACE with the
--                 exact same bodies as 20261027140200_rep_manager_assignments.sql,
--                 with the single authorization line widened from
--                 "is_admin()" to "is_admin() OR is_sales_admin()". Nothing
--                 else in either function changes.
--
-- Deliberately schema-only — no DO block, no synthetic data of any kind, no
-- INSERT/UPDATE/DELETE against any table. The behavioral self-test that
-- exercises this role (assign/reassign, cross-role read boundaries, the
-- approve/reject and late-exception denials) lives entirely outside this
-- migration, in supabase/phase1a-behavioral-tests/sales_admin_role_self_test.sql
-- — a LOCAL-ONLY script, run only against a disposable/local Postgres
-- instance, never pasted into PREVIEW or production. This keeps the actual
-- PREVIEW deployment transaction free of any synthetic auth.users/profiles/
-- rep_manager_assignments/rep_reports rows and free of any DO block that
-- could, on an early setup failure, interact with real data mid-transaction.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. Widen the role constraints to accept 'sales_admin'.
-- ---------------------------------------------------------------------------
ALTER TABLE public.profiles
  DROP CONSTRAINT profiles_role_check;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_role_check
  CHECK ((role = ANY (ARRAY['manager'::text, 'admin'::text, 'sales_rep'::text, 'sales_admin'::text])));

ALTER TABLE public.approved_employees
  DROP CONSTRAINT approved_employees_portal_role_check;
ALTER TABLE public.approved_employees
  ADD CONSTRAINT approved_employees_portal_role_check
  CHECK ((portal_role = ANY (ARRAY['manager'::text, 'admin'::text, 'sales_rep'::text, 'sales_admin'::text])));

-- ---------------------------------------------------------------------------
-- 2. is_sales_admin() — mirrors is_admin()'s exact shape (STABLE SECURITY
-- DEFINER, re-checks role AND is_active live, every call), but for a
-- distinct role. Deliberately NOT a change to is_admin() itself.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_sales_admin() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'sales_admin' AND p.is_active = true
  )
$$;

REVOKE ALL ON FUNCTION public.is_sales_admin() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_sales_admin() FROM anon;
GRANT EXECUTE ON FUNCTION public.is_sales_admin() TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. profiles — additive SELECT policy: a Sales Admin may read ANY
-- sales_rep profile row (full roster visibility, per the approved
-- requirements), and nothing else. The two pre-existing policies
-- ("Admins can view all profiles", "Users can view their own profile") and
-- the Manager-assigned-rep policy from 20261102090000 are untouched.
-- ---------------------------------------------------------------------------
CREATE POLICY "Sales Admins can view all Sales Rep profiles"
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (
    role = 'sales_rep'
    AND public.is_sales_admin()
  );

-- ---------------------------------------------------------------------------
-- 4. rep_reports — additive, read-only SELECT policy for Sales Admin,
-- mirroring the shape of rep_reports_select_admin but keyed off
-- is_sales_admin() instead of is_admin(). No write policy, no change to
-- review_rep_report's own authorization check (still is_assigned_manager_of
-- OR is_admin only) — a Sales Admin can read any report's content and
-- status, never approve/reject one.
-- ---------------------------------------------------------------------------
CREATE POLICY rep_reports_select_sales_admin
  ON public.rep_reports
  FOR SELECT
  TO authenticated
  USING (public.is_sales_admin());

-- ---------------------------------------------------------------------------
-- 5. assign_sales_rep / unassign_sales_rep — CREATE OR REPLACE with
-- identical bodies to 20261027140200_rep_manager_assignments.sql, widening
-- only the single authorization check on each. Every other line (target-row
-- validation, advisory-lock serialization, history-preserving UPDATE/INSERT
-- shape) is reproduced verbatim, unchanged.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.assign_sales_rep(
  p_rep_id uuid,
  p_manager_id uuid
)
RETURNS public.rep_manager_assignments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_rep_role text;
  v_manager_role text;
  v_manager_active boolean;
  v_existing public.rep_manager_assignments;
  v_result public.rep_manager_assignments;
BEGIN
  IF NOT (public.is_admin() OR public.is_sales_admin()) THEN
    RAISE EXCEPTION 'FORBIDDEN: Only an admin or sales admin may assign a sales rep to a manager.';
  END IF;

  SELECT role INTO v_rep_role FROM public.profiles WHERE id = p_rep_id;
  IF v_rep_role IS DISTINCT FROM 'sales_rep' THEN
    RAISE EXCEPTION 'INVALID_REP: The target profile is not a sales_rep.';
  END IF;

  SELECT role, is_active INTO v_manager_role, v_manager_active FROM public.profiles WHERE id = p_manager_id;
  IF v_manager_role IS DISTINCT FROM 'manager' OR v_manager_active IS NOT TRUE THEN
    RAISE EXCEPTION 'INVALID_MANAGER: The target profile is not an active manager.';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(p_rep_id::text));

  SELECT * INTO v_existing
  FROM public.rep_manager_assignments
  WHERE rep_id = p_rep_id AND unassigned_at IS NULL;

  IF v_existing.id IS NOT NULL AND v_existing.manager_id = p_manager_id THEN
    RETURN v_existing;
  END IF;

  UPDATE public.rep_manager_assignments
  SET unassigned_at = clock_timestamp(), unassigned_by = v_caller
  WHERE rep_id = p_rep_id AND unassigned_at IS NULL;

  INSERT INTO public.rep_manager_assignments (rep_id, manager_id, assigned_by, assigned_at)
  VALUES (p_rep_id, p_manager_id, v_caller, clock_timestamp())
  RETURNING * INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.assign_sales_rep(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.assign_sales_rep(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.assign_sales_rep(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.unassign_sales_rep(p_rep_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_updated integer;
BEGIN
  IF NOT (public.is_admin() OR public.is_sales_admin()) THEN
    RAISE EXCEPTION 'FORBIDDEN: Only an admin or sales admin may unassign a sales rep.';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(p_rep_id::text));

  UPDATE public.rep_manager_assignments
  SET unassigned_at = clock_timestamp(), unassigned_by = v_caller
  WHERE rep_id = p_rep_id AND unassigned_at IS NULL;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated = 1;
END;
$$;

REVOKE ALL ON FUNCTION public.unassign_sales_rep(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.unassign_sales_rep(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.unassign_sales_rep(uuid) TO authenticated;

-- DRAFT ONLY — do not move into supabase/migrations or apply unless this
-- rollback is actually needed and reviewed and approved for the specific
-- environment it will run against.
--
-- ROLLBACK for 20261116_manager_reporting_enabled.sql. Reverses, in the
-- required order:
--   1. Restore public.is_manager_or_admin_caller() to its original,
--      Manager/Admin-only body (the exact text from
--      20261027140100_reports_restrict_to_manager_admin.sql — verified
--      against that file before writing this rollback).
--   2. Only after that restore is confirmed in place, drop
--      public.is_manager_capable().
--   3. Only after that, drop the manager_reporting_enabled columns from
--      profiles and approved_employees.
--
-- WHY THIS ORDER IS MANDATORY (not just a style preference): if the
-- columns were dropped first, public.is_manager_capable() would start
-- throwing "column does not exist" on its very next call, and since
-- is_manager_or_admin_caller() calls it, EVERY Manager and Admin —
-- not just a dual-role Sales Admin — would immediately lose all read/
-- write access to the `reports` table (the Weekly Manager Report table).
-- Doing these three steps in this file's order, inside one transaction,
-- makes that failure mode structurally impossible: by the time any column
-- is dropped, nothing in the schema still reads it.
--
-- WHAT THIS DOES NOT TOUCH: no row in profiles, approved_employees,
-- reports, or any other table is inserted, updated, or deleted by this
-- file — only the two added columns and the two added/modified functions
-- are reverted. Every existing report, every existing account, and every
-- existing Manager/Admin/Sales Admin/Sales Rep's access is unaffected by
-- running this (Manager/Admin access is restored to its pre-migration
-- form; Sales Rep and plain-Sales-Admin access was never touched by the
-- forward migration in the first place).
--
-- Transactional: every statement below runs inside one BEGIN/COMMIT. If
-- any safety check raises, the whole rollback aborts and the database is
-- left exactly as it was — never a partial rollback.

BEGIN;

-- ---------------------------------------------------------------------------
-- Step 1 — restore is_manager_or_admin_caller() to its exact original body.
-- Signature is unchanged (still no parameters, still RETURNS boolean), so
-- this CREATE OR REPLACE preserves the function's existing grants and its
-- use by the three reports_restrict_* RESTRICTIVE policies automatically —
-- those policies are not touched, re-created, or even referenced here.
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
      AND role IN ('manager', 'admin')
      AND is_active = true
  );
$$;

REVOKE ALL ON FUNCTION public.is_manager_or_admin_caller() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_manager_or_admin_caller() FROM anon;
GRANT EXECUTE ON FUNCTION public.is_manager_or_admin_caller() TO authenticated;

-- ---------------------------------------------------------------------------
-- Safety check A — confirm the restore in Step 1 actually took effect,
-- and that no OTHER function anywhere in the public schema still calls
-- is_manager_capable(), before Step 2 removes it. Reads pg_proc's own
-- stored source text directly (the authoritative, current definition),
-- not this file's own text, so it would catch a function added by some
-- unrelated later change that started depending on is_manager_capable()
-- in the meantime.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_still_referencing text;
BEGIN
  IF (
    SELECT prosrc FROM pg_proc
    WHERE proname = 'is_manager_or_admin_caller'
      AND pronamespace = 'public'::regnamespace
  ) LIKE '%is_manager_capable%' THEN
    RAISE EXCEPTION 'ROLLBACK ABORTED: is_manager_or_admin_caller() still references is_manager_capable() after Step 1 — the restore did not take effect as expected.';
  END IF;

  SELECT string_agg(proname, ', ') INTO v_still_referencing
  FROM pg_proc
  WHERE pronamespace = 'public'::regnamespace
    AND proname <> 'is_manager_capable'
    AND prosrc LIKE '%is_manager_capable%';

  IF v_still_referencing IS NOT NULL THEN
    RAISE EXCEPTION 'ROLLBACK ABORTED: is_manager_capable() is still referenced by: %. Resolve that dependency before dropping it.', v_still_referencing;
  END IF;

  RAISE NOTICE 'Safety check A PASSED: is_manager_or_admin_caller() is restored and nothing else references is_manager_capable().';
END $$;

-- ---------------------------------------------------------------------------
-- Step 2 — drop is_manager_capable(), only now that Safety check A has
-- confirmed nothing depends on it. IF EXISTS makes this safe to re-run.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.is_manager_capable();

-- ---------------------------------------------------------------------------
-- Safety check B — before dropping the columns, refuse to silently
-- discard a currently-granted dual-role Sales Admin's access. If anyone
-- has manager_reporting_enabled = true right now, this is a conscious
-- decision (losing that specific person's Manager Reporting access), not
-- a side effect — abort and surface exactly who, rather than quietly
-- deleting the column (and its data) out from under them.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_flagged_profiles text;
  v_flagged_roster text;
BEGIN
  SELECT string_agg(id::text || ' (' || coalesce(full_name, email, 'unknown') || ')', ', ')
    INTO v_flagged_profiles
    FROM public.profiles
    WHERE manager_reporting_enabled = true;

  IF v_flagged_profiles IS NOT NULL THEN
    RAISE EXCEPTION 'ROLLBACK ABORTED: the following profile(s) currently have manager_reporting_enabled = true and would silently lose that access if this rollback proceeds: %. Explicitly decide what should happen to them (e.g. revert their flag first, with their own sign-off) before re-running this rollback.', v_flagged_profiles;
  END IF;

  -- Checked separately from profiles above — these two flags are meant to
  -- always be set together (same dual-write convention used throughout
  -- this project for submits_weekly_report), but this check does not
  -- assume they're in sync; it catches drift instead of trusting it away.
  SELECT string_agg(id::text || ' (' || coalesce(full_name, email, 'unknown') || ')', ', ')
    INTO v_flagged_roster
    FROM public.approved_employees
    WHERE manager_reporting_enabled = true;

  IF v_flagged_roster IS NOT NULL THEN
    RAISE EXCEPTION 'ROLLBACK ABORTED: the following approved_employees row(s) currently have manager_reporting_enabled = true and would silently lose that data if this rollback proceeds: %. Explicitly decide what should happen to them before re-running this rollback.', v_flagged_roster;
  END IF;

  RAISE NOTICE 'Safety check B PASSED: no profile or roster row currently has manager_reporting_enabled = true.';
END $$;

-- ---------------------------------------------------------------------------
-- Step 3 — drop the columns last, only now that both safety checks have
-- passed. IF EXISTS makes this safe to re-run. No row in either table is
-- deleted — only this one column is removed from each.
-- ---------------------------------------------------------------------------
ALTER TABLE public.approved_employees DROP COLUMN IF EXISTS manager_reporting_enabled;
ALTER TABLE public.profiles DROP COLUMN IF EXISTS manager_reporting_enabled;

COMMIT;

-- PRODUCTION-ONLY SQL for dual-role support — an Admin who also submits
-- their own weekly report. No synthetic data, no test transactions,
-- no simulated JWTs, no self-verification, no cleanup statements. Additive
-- only, EXCEPT for one deliberate in-place refinement of the body of an
-- already-existing function (reports_enforce_manager_edit_cutoff, from
-- 20260918_manager_edit_lock.sql) — the trigger itself, its name, and its
-- timing are all unchanged; only the admin-exemption condition inside the
-- function body changes. Nothing else here alters, drops, disables, or
-- replaces any existing column, trigger, RLS policy, or function.
--
-- Not run. Companion to supabase/migrations/20260922_submits_weekly_report.sql
-- (which additionally contains a self-verifying test block, intended for a
-- staging/local run, not production).
--
-- submits_weekly_report is explicit and separately-set on both
-- approved_employees and profiles — never inferred from role, never
-- inferred from whether a report row exists. See that file's header for the
-- full rationale.

-- 1) Schema — additive NOT NULL columns with a safe `false` default.
ALTER TABLE approved_employees ADD COLUMN IF NOT EXISTS submits_weekly_report boolean NOT NULL DEFAULT false;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS submits_weekly_report boolean NOT NULL DEFAULT false;

-- 2) Backfill — every existing Manager becomes a submitter; every existing
--    Admin-only row is explicitly left at/set to false.
UPDATE approved_employees SET submits_weekly_report = true WHERE portal_role = 'manager';
UPDATE approved_employees SET submits_weekly_report = false WHERE portal_role = 'admin';
UPDATE profiles SET submits_weekly_report = true WHERE role = 'manager';
UPDATE profiles SET submits_weekly_report = false WHERE role = 'admin';

-- 3) Refined admin-exemption condition inside the existing Friday-cutoff
--    trigger function. See 20260922_submits_weekly_report.sql for the full
--    explanation of the change; the body below is byte-for-byte identical
--    to that file's version.
CREATE OR REPLACE FUNCTION reports_enforce_manager_edit_cutoff()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  acting_role text;
  acting_submits boolean;
  friday_date date;
  new_report_cutoff timestamptz;
  edit_cutoff timestamptz;
  row_exists boolean;
BEGIN
  SELECT role, submits_weekly_report INTO acting_role, acting_submits
  FROM public.profiles WHERE id = auth.uid();

  IF acting_role = 'admin' AND NOT (coalesce(acting_submits, false) AND NEW.manager_id = auth.uid()) THEN
    RETURN NEW;
  END IF;

  friday_date := NEW.week_start_date + 4;
  new_report_cutoff := (friday_date + time '15:00') AT TIME ZONE 'America/New_York';
  edit_cutoff := (friday_date + time '15:30') AT TIME ZONE 'America/New_York';

  row_exists := TG_OP = 'UPDATE'
    OR EXISTS (
      SELECT 1 FROM public.reports
      WHERE manager_id = NEW.manager_id AND week_start_date = NEW.week_start_date
    );

  IF NOT row_exists THEN
    IF now() >= new_report_cutoff THEN
      RAISE EXCEPTION 'MANAGER_NEW_REPORT_LOCKED: The submission deadline has passed for this reporting week.';
    END IF;
  ELSE
    IF now() >= edit_cutoff THEN
      RAISE EXCEPTION 'MANAGER_EDIT_LOCKED: Editing is closed for this reporting week.';
    END IF;

    IF TG_OP = 'UPDATE' AND OLD.status = 'submitted' AND NEW.status IS DISTINCT FROM 'submitted' THEN
      RAISE EXCEPTION 'MANAGER_STATUS_REGRESSION_BLOCKED: An already-submitted report cannot be changed back to draft.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- The existing reports_manager_edit_cutoff trigger (from
-- 20260918_manager_edit_lock.sql) already calls this function by name — no
-- DROP TRIGGER / CREATE TRIGGER is needed or included here. CREATE OR
-- REPLACE FUNCTION above is sufficient: Postgres updates the function body
-- in place and the already-installed trigger picks up the new behavior on
-- its very next invocation.

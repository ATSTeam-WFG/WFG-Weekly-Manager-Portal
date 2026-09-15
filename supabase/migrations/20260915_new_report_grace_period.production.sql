-- PRODUCTION-ONLY SQL for the Friday grace-period business-rule change:
-- there is now ONE Manager write cutoff — Friday 3:30 PM America/New_York —
-- instead of two. A Not Started manager (no report row yet) is no longer
-- blocked at 3:00 PM; they get the same 3:00-3:29:59 PM grace period an
-- existing Draft/Submitted report already had. At/after 3:30 PM, every
-- Manager write locks — new or existing, no exception, exactly as before.
-- The weekend lock is unaffected, since it was always this same cutoff
-- persisting through the rest of the week, never a separate rule.
--
-- No synthetic data, no test transactions, no simulated JWTs, no
-- self-verification, no cleanup statements. The ONLY change is an in-place
-- refinement of the body of the already-existing
-- reports_enforce_manager_edit_cutoff() function — the trigger itself, its
-- name, and its timing are unchanged. No column, RLS policy, or other
-- function is touched, and nothing here modifies api/auto-submit.ts, its
-- Friday 3:00-3:14 PM scheduler window, api/reminders.ts, or
-- REMINDER_ACTIONS_ENABLED.
--
-- Not run. Companion to supabase/migrations/20260915_new_report_grace_period.sql
-- (which additionally contains a self-verifying test block, intended for a
-- staging/local run, not production). The function body below is
-- byte-for-byte identical to that file's version.
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
  edit_cutoff timestamptz;
BEGIN
  SELECT role, submits_weekly_report INTO acting_role, acting_submits
  FROM public.profiles WHERE id = auth.uid();

  IF acting_role = 'admin' AND NOT (coalesce(acting_submits, false) AND NEW.manager_id = auth.uid()) THEN
    RETURN NEW;
  END IF;

  friday_date := NEW.week_start_date + 4;
  edit_cutoff := (friday_date + time '15:30') AT TIME ZONE 'America/New_York';

  IF now() >= edit_cutoff THEN
    RAISE EXCEPTION 'MANAGER_EDIT_LOCKED: Editing is closed for this reporting week.';
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.status = 'submitted' AND NEW.status IS DISTINCT FROM 'submitted' THEN
    RAISE EXCEPTION 'MANAGER_STATUS_REGRESSION_BLOCKED: An already-submitted report cannot be changed back to draft.';
  END IF;

  RETURN NEW;
END;
$$;

-- The existing reports_manager_edit_cutoff trigger already calls this
-- function by name — no DROP TRIGGER / CREATE TRIGGER is needed or
-- included here. CREATE OR REPLACE FUNCTION above is sufficient: Postgres
-- updates the function body in place and the already-installed trigger
-- picks up the new behavior on its very next invocation.

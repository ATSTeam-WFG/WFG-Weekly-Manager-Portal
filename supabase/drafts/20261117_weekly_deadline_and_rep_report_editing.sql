-- Beta feedback (2026-11-16, boundary fix 2026-11-18), two related
-- business-rule changes, bundled together because they touch overlapping
-- functions:
--
-- 1. The weekly deadline moves from a Friday split (3:00 PM Manager
--    submission-display / 4:00 PM Manager edit-lock / 2:00 PM Sales Rep
--    submission) to a SINGLE Thursday 11:59 PM America/New_York cutoff,
--    shared by every role and by both submission and editing. "11:59 PM"
--    is inclusive of the entire minute — users may submit/edit at any
--    point during 11:59:00–11:59:59 PM Thursday; the lock begins at the
--    very next instant, 12:00:00 AM Friday. Every cutoff check below is
--    therefore expressed as "now() >= Friday 00:00:00 Eastern", never as
--    "(Thursday + time '23:59') compared with >=" (that form would lock
--    one minute too early). This is a DRAFT migration — review and apply
--    explicitly; do not run against Preview or Production without
--    separate approval.
--
-- 2. A Sales Rep may now edit their own already-submitted report's content
--    (previously blocked unless review_status = 'rejected') up until that
--    same cutoff — mirroring exactly how a Manager already edits their own
--    submitted `reports` row today (a plain content-only UPDATE, status/
--    submitted_at/first_submitted_at never touched, never a second row).
--
-- Nothing here deletes any existing column, table, row, or prior migration.
-- resubmit_rejected_rep_report, rep_report_resubmission_events, and every
-- approve/reject/review_status value already recorded are left completely
-- in place — resubmission via that specific function simply becomes one
-- path among several now that save_rep_report_draft also allows editing a
-- submitted report directly, rather than the only one.

-- ---------------------------------------------------------------------------
-- 1a. reports_enforce_manager_edit_cutoff() — Manager `reports` table
-- trigger. Day/time constant changes from Friday 16:00 to the "Thursday
-- 11:59 PM, inclusive" deadline — expressed as "locked once now() reaches
-- Friday 00:00:00 Eastern", NOT as "(Thursday + time '23:59') AT TIME ZONE
-- ... compared with >=" — the latter would lock starting at the FIRST
-- instant of the 23:59 minute (11:59:00 PM), one minute too early. Using
-- the exact next-day-midnight instant instead needs no minute-granularity
-- special-casing: any instant through 11:59:59.999... PM Thursday is
-- strictly before Friday 00:00:00, and the lock begins there exactly.
-- Admin-exemption and status-regression logic are byte-for-byte unchanged
-- from 20260917_manager_edit_cutoff_4pm.sql.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION reports_enforce_manager_edit_cutoff()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  acting_role text;
  acting_submits boolean;
  lock_start_date date;
  edit_cutoff timestamptz;
BEGIN
  SELECT role, submits_weekly_report INTO acting_role, acting_submits
  FROM public.profiles WHERE id = auth.uid();

  IF acting_role = 'admin' AND NOT (coalesce(acting_submits, false) AND NEW.manager_id = auth.uid()) THEN
    RETURN NEW;
  END IF;

  -- Monday + 4 = Friday; the lock begins at that Friday's midnight, i.e.
  -- immediately after Thursday's (Monday + 3) 11:59 PM ends.
  lock_start_date := NEW.week_start_date + 4;
  edit_cutoff := (lock_start_date + time '00:00') AT TIME ZONE 'America/New_York';

  IF now() >= edit_cutoff THEN
    RAISE EXCEPTION 'MANAGER_EDIT_LOCKED: Editing is closed for this reporting week.';
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.status = 'submitted' AND NEW.status IS DISTINCT FROM 'submitted' THEN
    RAISE EXCEPTION 'MANAGER_STATUS_REGRESSION_BLOCKED: An already-submitted report cannot be changed back to draft.';
  END IF;

  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- 1b. manager_report_edit_cutoff_passed() — standalone predicate used by
-- import_rep_report_for_consolidation. Same "locked at Friday 00:00:00
-- Eastern" formula as 1a (see its comment for why this, not a literal
-- "Thursday 23:59" instant compared with >=).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.manager_report_edit_cutoff_passed(
  p_week_start_date date,
  p_now timestamptz DEFAULT clock_timestamp()
)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT p_now >= ((p_week_start_date + 4 + time '00:00') AT TIME ZONE 'America/New_York');
$$;

-- ---------------------------------------------------------------------------
-- 1c. rep_report_submission_cutoff_passed() — now ALSO the Sales Rep's
-- editing cutoff (see save_rep_report_draft below), not just submission's;
-- renamed conceptually but not literally, to minimize call-site churn in
-- submit_rep_report/resubmit_rejected_rep_report/save_rep_report_draft,
-- all of which already call it by this name. Same "locked at Friday
-- 00:00:00 Eastern" formula as 1a/1b.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rep_report_submission_cutoff_passed(
  p_week_start_date date,
  p_now timestamptz DEFAULT clock_timestamp()
)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT p_now >= ((p_week_start_date + 4 + time '00:00') AT TIME ZONE 'America/New_York');
$$;

-- ---------------------------------------------------------------------------
-- 2. save_rep_report_draft() — two changes from the prior version:
--   a) now deadline-gated (previously drafts were never time-gated at all;
--      kept symmetric with the Manager side, where the write lock applies
--      to a brand-new report exactly as it does to an existing one — see
--      src/lib/managerEditLock.ts's own comment to that effect).
--   b) a report already at status='submitted' (any review_status, not just
--      'rejected' as before) is now editable: a content-only UPDATE that
--      never touches status/submitted_at/first_submitted_at/review_status/
--      reviewed_by/reviewed_at/owning_assignment_id — the exact same
--      guarantee reportsService.ts's updateReportSectionsV2 already gives
--      a Manager editing their own submitted `reports` row.
-- Never creates a second row for the same rep/week either way (still a
-- single UPDATE-or-upsert keyed by the same (rep_id, week_start_date)
-- unique constraint this function already relied on).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.save_rep_report_draft(
  p_week_start_date date,
  p_content jsonb
)
RETURNS public.rep_reports
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_role text;
  v_active boolean;
  v_existing public.rep_reports;
  v_result public.rep_reports;
BEGIN
  SELECT role, is_active INTO v_role, v_active FROM public.profiles WHERE id = v_caller;
  IF v_role IS DISTINCT FROM 'sales_rep' OR v_active IS NOT TRUE THEN
    RAISE EXCEPTION 'FORBIDDEN: Only an active sales_rep may save their own report.';
  END IF;

  IF public.rep_report_submission_cutoff_passed(p_week_start_date) THEN
    RAISE EXCEPTION 'EDIT_LOCKED: Editing is closed for this reporting week.';
  END IF;

  SELECT * INTO v_existing FROM public.rep_reports
  WHERE rep_id = v_caller AND week_start_date = p_week_start_date;

  IF v_existing IS NOT NULL AND v_existing.status = 'submitted' THEN
    UPDATE public.rep_reports
    SET content = p_content, updated_at = now()
    WHERE id = v_existing.id
    RETURNING * INTO v_result;
  ELSE
    INSERT INTO public.rep_reports (rep_id, week_start_date, status, content, submission_source, owning_assignment_id)
    VALUES (v_caller, p_week_start_date, 'draft', p_content, NULL, public.current_assignment_id_for_rep(v_caller))
    ON CONFLICT (rep_id, week_start_date) DO UPDATE SET
      content    = EXCLUDED.content,
      updated_at = now()
    RETURNING * INTO v_result;
  END IF;

  RETURN v_result;
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. submit_rep_report() / resubmit_rejected_rep_report() — error message
-- text updated to "Thursday 11:59 PM Eastern"; the deadline check itself
-- already goes through rep_report_submission_cutoff_passed (1c above), so
-- no behavioral change here beyond the corrected Friday-00:00:00 timing
-- that function now returns.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.submit_rep_report(p_week_start_date date)
RETURNS public.rep_reports
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_role text;
  v_active boolean;
  v_existing public.rep_reports;
  v_cutoff_passed boolean;
  v_exception public.rep_report_late_submission_exceptions;
  v_result public.rep_reports;
BEGIN
  SELECT role, is_active INTO v_role, v_active FROM public.profiles WHERE id = v_caller;
  IF v_role IS DISTINCT FROM 'sales_rep' OR v_active IS NOT TRUE THEN
    RAISE EXCEPTION 'FORBIDDEN: Only an active sales_rep may submit their own report.';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('rep_report_submit:' || v_caller::text || ':' || p_week_start_date::text));

  SELECT * INTO v_existing FROM public.rep_reports
  WHERE rep_id = v_caller AND week_start_date = p_week_start_date AND status = 'draft';

  IF v_existing IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: No draft report exists for this rep/week to submit.';
  END IF;

  v_cutoff_passed := public.rep_report_submission_cutoff_passed(p_week_start_date);

  IF v_cutoff_passed THEN
    SELECT * INTO v_exception FROM public.rep_report_late_submission_exceptions
    WHERE report_id = v_existing.id AND consumed_at IS NULL
    ORDER BY granted_at ASC
    LIMIT 1
    FOR UPDATE;

    IF v_exception IS NULL THEN
      RAISE EXCEPTION 'SUBMISSION_DEADLINE_PASSED: The Thursday 11:59 PM Eastern deadline for this reporting week has passed. An admin-authorized exception is required to submit now.';
    END IF;

    UPDATE public.rep_report_late_submission_exceptions
    SET consumed_at = clock_timestamp(), consumed_by = v_caller, consumed_by_operation = 'submit'
    WHERE id = v_exception.id;
  END IF;

  UPDATE public.rep_reports
  SET status             = 'submitted',
      submission_source  = 'manual',
      submitted_at       = clock_timestamp(),
      first_submitted_at = clock_timestamp(),
      updated_at         = now()
  WHERE id = v_existing.id
  RETURNING * INTO v_result;

  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.resubmit_rejected_rep_report(p_week_start_date date)
RETURNS public.rep_reports
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_role text;
  v_active boolean;
  v_existing public.rep_reports;
  v_cutoff_passed boolean;
  v_first_was_on_time boolean;
  v_exception public.rep_report_late_submission_exceptions;
  v_basis text;
  v_used_exception_id uuid;
  v_result public.rep_reports;
BEGIN
  SELECT role, is_active INTO v_role, v_active FROM public.profiles WHERE id = v_caller;
  IF v_role IS DISTINCT FROM 'sales_rep' OR v_active IS NOT TRUE THEN
    RAISE EXCEPTION 'FORBIDDEN: Only an active sales_rep may resubmit their own rejected report.';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('rep_report_submit:' || v_caller::text || ':' || p_week_start_date::text));

  SELECT * INTO v_existing FROM public.rep_reports
  WHERE rep_id = v_caller AND week_start_date = p_week_start_date;

  IF v_existing IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: No report exists for this rep/week.';
  END IF;

  IF v_existing.status <> 'submitted' OR v_existing.review_status <> 'rejected' THEN
    RAISE EXCEPTION 'INVALID_STATE: Only a rejected, submitted report can be resubmitted.';
  END IF;

  v_cutoff_passed := public.rep_report_submission_cutoff_passed(p_week_start_date);

  IF NOT v_cutoff_passed THEN
    v_basis := 'on_time_window';
  ELSE
    v_first_was_on_time := NOT public.rep_report_submission_cutoff_passed(p_week_start_date, v_existing.first_submitted_at);

    IF v_first_was_on_time THEN
      v_basis := 'on_time_original_exemption';
    ELSE
      SELECT * INTO v_exception FROM public.rep_report_late_submission_exceptions
      WHERE report_id = v_existing.id AND consumed_at IS NULL
      ORDER BY granted_at ASC
      LIMIT 1
      FOR UPDATE;

      IF v_exception IS NULL THEN
        RAISE EXCEPTION 'SUBMISSION_DEADLINE_PASSED: The Thursday 11:59 PM Eastern deadline for this reporting week has passed. An admin-authorized exception is required to resubmit now.';
      END IF;

      UPDATE public.rep_report_late_submission_exceptions
      SET consumed_at = clock_timestamp(), consumed_by = v_caller, consumed_by_operation = 'resubmit'
      WHERE id = v_exception.id;

      v_basis := 'admin_exception';
      v_used_exception_id := v_exception.id;
    END IF;
  END IF;

  UPDATE public.rep_reports
  SET review_status = 'pending',
      reviewed_by   = NULL,
      reviewed_at   = NULL,
      submitted_at  = clock_timestamp(),
      updated_at    = now()
  WHERE id = v_existing.id
  RETURNING * INTO v_result;

  INSERT INTO public.rep_report_resubmission_events
    (report_id, rep_id, previous_review_status, new_review_status, cutoff_was_passed, authorization_basis, used_exception_id)
  VALUES
    (v_existing.id, v_caller, 'rejected', 'pending', v_cutoff_passed, v_basis, v_used_exception_id);

  RETURN v_result;
END;
$$;

-- ---------------------------------------------------------------------------
-- Self-test: cutoff boundary (EST + EDT) and the content-only edit path.
-- Not exhaustive (the original migrations' own self-test blocks already
-- cover DST/advisory-lock/exception edge cases for the surrounding
-- machinery untouched here) — this focuses on what actually changed.
--
-- Beta feedback (2026-11-18): the boundary is "locked once now() reaches
-- Friday 00:00:00 Eastern" — every instant through Thursday 11:59:59.999
-- PM must still read as NOT passed, including the entire 11:59 PM minute
-- itself (previously this incorrectly locked starting at 11:59:00 PM).
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_week date := '2026-01-05'; -- Monday; deadline Thu 2026-01-08, lock begins Fri 2026-01-09 00:00:00
  v_at_1159_00 timestamptz := (v_week + 3 + time '23:59:00') AT TIME ZONE 'America/New_York';
  v_at_1159_59 timestamptz := (v_week + 3 + time '23:59:59') AT TIME ZONE 'America/New_York';
  v_at_midnight timestamptz := (v_week + 4 + time '00:00:00') AT TIME ZONE 'America/New_York';
BEGIN
  IF public.rep_report_submission_cutoff_passed(v_week, v_at_1159_00) THEN
    RAISE EXCEPTION 'SELF_TEST_FAILED: cutoff reported passed at the START of the 11:59 PM Thursday minute (EST) — must stay open through the whole minute';
  END IF;
  IF public.rep_report_submission_cutoff_passed(v_week, v_at_1159_59) THEN
    RAISE EXCEPTION 'SELF_TEST_FAILED: cutoff reported passed at the END of the 11:59 PM Thursday minute (EST) — must stay open through the whole minute';
  END IF;
  IF NOT public.rep_report_submission_cutoff_passed(v_week, v_at_midnight) THEN
    RAISE EXCEPTION 'SELF_TEST_FAILED: cutoff reported NOT passed exactly at Friday 00:00:00 (EST) — the lock must begin here';
  END IF;

  -- EDT (summer) week: Monday 2026-07-06, deadline Thu 2026-07-09, lock begins Fri 2026-07-10 00:00:00.
  IF public.rep_report_submission_cutoff_passed(
    '2026-07-06'::date,
    ('2026-07-09'::date + time '23:59:00') AT TIME ZONE 'America/New_York'
  ) THEN
    RAISE EXCEPTION 'SELF_TEST_FAILED: cutoff reported passed at the START of the 11:59 PM Thursday minute (EDT) — must stay open through the whole minute';
  END IF;
  IF public.rep_report_submission_cutoff_passed(
    '2026-07-06'::date,
    ('2026-07-09'::date + time '23:59:59') AT TIME ZONE 'America/New_York'
  ) THEN
    RAISE EXCEPTION 'SELF_TEST_FAILED: cutoff reported passed at the END of the 11:59 PM Thursday minute (EDT) — must stay open through the whole minute';
  END IF;
  IF NOT public.rep_report_submission_cutoff_passed(
    '2026-07-06'::date,
    ('2026-07-10'::date + time '00:00:00') AT TIME ZONE 'America/New_York'
  ) THEN
    RAISE EXCEPTION 'SELF_TEST_FAILED: cutoff reported NOT passed exactly at Friday 00:00:00 (EDT) — the lock must begin here';
  END IF;

  -- manager_report_edit_cutoff_passed() and reports_enforce_manager_edit_cutoff()
  -- share the identical formula — spot-check the standalone predicate too,
  -- so a future edit to only one of the two can never silently diverge.
  IF public.manager_report_edit_cutoff_passed(v_week, v_at_1159_59) THEN
    RAISE EXCEPTION 'SELF_TEST_FAILED: manager_report_edit_cutoff_passed reported passed during the 11:59 PM Thursday minute (EST)';
  END IF;
  IF NOT public.manager_report_edit_cutoff_passed(v_week, v_at_midnight) THEN
    RAISE EXCEPTION 'SELF_TEST_FAILED: manager_report_edit_cutoff_passed reported NOT passed exactly at Friday 00:00:00 (EST)';
  END IF;

  RAISE NOTICE 'SELF_TEST_PASSED: weekly_deadline_and_rep_report_editing cutoff boundary (EST + EDT), inclusive of the full 11:59 PM Thursday minute';
END;
$$;

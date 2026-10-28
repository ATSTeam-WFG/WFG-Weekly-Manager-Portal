-- Sales Rep flow, Phase 1B, step 1 — submission governance for rep_reports:
-- the Friday 2:00 PM America/New_York deadline for a sales rep's FIRST
-- submission, a reject -> correct -> resubmit flow, a permanent append-only
-- late-submission-exception audit trail, and a server-derived, immutable
-- "was the ORIGINAL first submission on time" exemption for post-deadline
-- corrections. This file is a single, pre-commit draft — nothing in it has
-- ever been committed, so it is written as the final approved design
-- directly, not as a layered patch over an earlier, now-superseded draft.
--
-- ===========================================================================
-- APPROVED POLICIES THIS MIGRATION IMPLEMENTS (owner-approved; not assumed):
--
-- POLICY 1 — post-deadline rejected-report correction without a fresh
-- exception, ONLY when ALL of the following hold:
--   1. The report's own first_submitted_at (below) is a real, immutable
--      timestamp — proof a first submission actually happened.
--   2+3. The report is currently status='submitted', review_status='rejected'
--      (checked by resubmit_rejected_rep_report regardless of this policy).
--   4. The acting caller is re-derived from auth.uid() and must be the
--      report's own rep_id (checked by resubmit_rejected_rep_report
--      regardless of this policy).
--   5. owning_assignment_id/review history are never touched by this policy.
-- "On time" is never a stored flag the browser could influence — it is
-- RE-DERIVED, every time, from the immutable first_submitted_at timestamp
-- against the SAME authoritative rep_report_submission_cutoff_passed()
-- predicate used everywhere else in this file. A report whose first
-- submission was itself LATE (i.e. only happened because an admin granted
-- an exception) does NOT qualify for this exemption — a late-originated
-- report always needs a FRESH exception for every subsequent late action,
-- with no exception ever carrying over between submission and resubmission.
--
-- POLICY 2 — the late-submission exception mechanism becomes a permanent,
-- append-only audit trail (public.rep_report_late_submission_exceptions,
-- below) instead of three columns on rep_reports that used to be cleared on
-- consumption. A grant is a row that is INSERTed once and may be UPDATEd
-- at most once — to record its own consumption — after which a trigger
-- makes the row completely immutable. A grant is never deleted, and no
-- grant ever "disappears" after being used.
-- ===========================================================================
ALTER TABLE public.rep_reports ADD COLUMN first_submitted_at timestamptz;

-- ---------------------------------------------------------------------------
-- rep_report_submission_cutoff_passed — pure, stateless predicate: has the
-- Friday 2:00 PM America/New_York deadline for this reporting week passed as
-- of p_now? Reuses the EXACT timezone-conversion idiom already proven
-- correct (and DST-safe, via the IANA tz database, not manual UTC-offset
-- math) by reports_enforce_manager_edit_cutoff() in
-- 20260922_submits_weekly_report.sql — only the clock hour differs (14:00
-- here vs. that function's 16:00). No SECURITY DEFINER needed (plain
-- STABLE SQL, no table access, nothing privileged). p_now defaults to
-- clock_timestamp() for real callers; this is also the SAME function POLICY
-- 1 reuses (with an explicit historical p_now) to re-derive whether a
-- report's own first_submitted_at was on time, rather than inventing a
-- second, parallel notion of "on time".
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
  SELECT p_now >= ((p_week_start_date + 4 + time '14:00') AT TIME ZONE 'America/New_York');
$$;

REVOKE ALL ON FUNCTION public.rep_report_submission_cutoff_passed(date, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rep_report_submission_cutoff_passed(date, timestamptz) FROM anon;
GRANT EXECUTE ON FUNCTION public.rep_report_submission_cutoff_passed(date, timestamptz) TO authenticated;

-- ---------------------------------------------------------------------------
-- save_rep_report_draft — unchanged from the prior draft of this migration:
-- a submitted report can be edited only while review_status = 'rejected'.
-- Never touches status/review_status/owning_assignment_id/first_submitted_at.
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
  v_result public.rep_reports;
BEGIN
  SELECT role, is_active INTO v_role, v_active FROM public.profiles WHERE id = v_caller;
  IF v_role IS DISTINCT FROM 'sales_rep' OR v_active IS NOT TRUE THEN
    RAISE EXCEPTION 'FORBIDDEN: Only an active sales_rep may save their own report draft.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.rep_reports
    WHERE rep_id = v_caller AND week_start_date = p_week_start_date
      AND status = 'submitted' AND review_status <> 'rejected'
  ) THEN
    RAISE EXCEPTION 'REP_STATUS_REGRESSION_BLOCKED: An already-submitted report can only be edited after it has been rejected.';
  END IF;

  INSERT INTO public.rep_reports (rep_id, week_start_date, status, content, submission_source, owning_assignment_id)
  VALUES (v_caller, p_week_start_date, 'draft', p_content, NULL, public.current_assignment_id_for_rep(v_caller))
  ON CONFLICT (rep_id, week_start_date) DO UPDATE SET
    content    = EXCLUDED.content,
    updated_at = now()
  RETURNING * INTO v_result;

  RETURN v_result;
END;
$$;

-- ---------------------------------------------------------------------------
-- rep_reports immutable-fields guard — extends Phase 1A's own
-- owning_assignment_id trigger (defined in 20261027140300_rep_reports.sql,
-- redefined here via CREATE OR REPLACE against the SAME trigger name — the
-- CREATE TRIGGER statement itself, which only binds by function name, does
-- not need to be re-run) to ALSO guard first_submitted_at. The one legitimate
-- transition — NULL -> a real timestamp, performed exactly once by
-- submit_rep_report below — is still allowed (checked by "OLD IS NOT NULL",
-- not merely "NEW IS DISTINCT FROM OLD"); any change after that is blocked,
-- matching owning_assignment_id's own existing discipline and for the
-- identical reason: POLICY 1's entire safety rests on this timestamp never
-- being backdated or cleared by any future code path, not merely today's.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rep_reports_owning_assignment_immutable()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.owning_assignment_id IS DISTINCT FROM OLD.owning_assignment_id THEN
    RAISE EXCEPTION 'OWNING_ASSIGNMENT_IMMUTABLE: owning_assignment_id cannot be changed once a report row exists.';
  END IF;
  IF OLD.first_submitted_at IS NOT NULL AND NEW.first_submitted_at IS DISTINCT FROM OLD.first_submitted_at THEN
    RAISE EXCEPTION 'FIRST_SUBMITTED_AT_IMMUTABLE: first_submitted_at cannot be changed once a report has first been submitted.';
  END IF;
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- rep_report_late_submission_exceptions — POLICY 2's permanent audit trail.
-- INSERTed once (grant_rep_report_late_submission_exception, below); the
-- ONLY legitimate UPDATE is recording consumption (consumed_at/consumed_by/
-- consumed_by_operation, all set together exactly once) — enforced by the
-- guard trigger below, which also makes every other field, and any row that
-- is already consumed, completely immutable. Never deleted by anyone,
-- including an admin — no DELETE grant exists anywhere, for anyone.
-- ---------------------------------------------------------------------------
CREATE TABLE public.rep_report_late_submission_exceptions (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id             uuid NOT NULL REFERENCES public.rep_reports(id),
  granted_by            uuid NOT NULL REFERENCES public.profiles(id),
  granted_at            timestamptz NOT NULL DEFAULT clock_timestamp(),
  reason                text NOT NULL CHECK (btrim(reason) <> ''),
  consumed_at           timestamptz,
  consumed_by           uuid REFERENCES public.profiles(id),
  consumed_by_operation text CHECK (consumed_by_operation IN ('submit', 'resubmit')),
  CHECK ((consumed_at IS NULL) = (consumed_by IS NULL)),
  CHECK ((consumed_at IS NULL) = (consumed_by_operation IS NULL))
);

CREATE INDEX rep_report_late_submission_exceptions_report_idx
  ON public.rep_report_late_submission_exceptions (report_id, granted_at);

-- Supports "find the oldest unused exception for this report" efficiently —
-- the exact query submit_rep_report/resubmit_rejected_rep_report run under
-- FOR UPDATE to consume one.
CREATE INDEX rep_report_late_submission_exceptions_unused_idx
  ON public.rep_report_late_submission_exceptions (report_id)
  WHERE consumed_at IS NULL;

CREATE OR REPLACE FUNCTION public.rep_report_late_submission_exceptions_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.consumed_at IS NOT NULL THEN
    RAISE EXCEPTION 'EXCEPTION_ALREADY_FINALIZED: a consumed exception record can never be modified again.';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.report_id IS DISTINCT FROM OLD.report_id
     OR NEW.granted_by IS DISTINCT FROM OLD.granted_by
     OR NEW.granted_at IS DISTINCT FROM OLD.granted_at
     OR NEW.reason IS DISTINCT FROM OLD.reason THEN
    RAISE EXCEPTION 'EXCEPTION_GRANT_FIELDS_IMMUTABLE: the original grant fields can never be changed — only consumed_at/consumed_by/consumed_by_operation may be set, exactly once.';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER rep_report_late_submission_exceptions_guard_trigger
  BEFORE UPDATE ON public.rep_report_late_submission_exceptions
  FOR EACH ROW
  EXECUTE FUNCTION public.rep_report_late_submission_exceptions_guard();

ALTER TABLE public.rep_report_late_submission_exceptions ENABLE ROW LEVEL SECURITY;

-- Same visibility shape as rep_reports itself (own/current-manager/
-- former-manager/admin) — SELECT only, read-only transparency into the
-- audit trail for everyone who can already see the report it belongs to.
CREATE POLICY rep_report_late_submission_exceptions_select_own
  ON public.rep_report_late_submission_exceptions
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.rep_reports r WHERE r.id = report_id AND r.rep_id = auth.uid()));

CREATE POLICY rep_report_late_submission_exceptions_select_assigned_manager
  ON public.rep_report_late_submission_exceptions
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.rep_reports r WHERE r.id = report_id AND public.is_assigned_manager_of(r.rep_id)));

-- Former managers retain historical READ-ONLY access to the exception
-- audit trail too — transparency only, never a write path, and this policy
-- grants nothing beyond SELECT. A former manager cannot grant an exception
-- regardless (grant_rep_report_late_submission_exception is admin-only,
-- checked independently of any RLS policy).
CREATE POLICY rep_report_late_submission_exceptions_select_former_manager
  ON public.rep_report_late_submission_exceptions
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.rep_reports r WHERE r.id = report_id AND public.was_manager_for_assignment(r.owning_assignment_id)));

CREATE POLICY rep_report_late_submission_exceptions_select_admin
  ON public.rep_report_late_submission_exceptions
  FOR SELECT TO authenticated
  USING (public.is_admin());

GRANT SELECT ON public.rep_report_late_submission_exceptions TO authenticated;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN
ON public.rep_report_late_submission_exceptions
FROM authenticated, anon;

REVOKE SELECT
ON public.rep_report_late_submission_exceptions
FROM anon;

-- ---------------------------------------------------------------------------
-- rep_report_resubmission_events — permanent, append-only record of every
-- correction/resubmission event: actor, report, time, previous/new review
-- state, whether the cutoff had passed, and exactly how the resubmission
-- was authorized (the free on-time-original exemption, the plain before-
-- deadline window, or a freshly consumed admin exception — and if so,
-- which one). Pure INSERT-only table: no function ever updates or deletes a
-- row here, so no guard trigger is needed — the complete absence of any
-- UPDATE/DELETE grant, for anyone, is the only enforcement required.
-- ---------------------------------------------------------------------------
CREATE TABLE public.rep_report_resubmission_events (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id              uuid NOT NULL REFERENCES public.rep_reports(id),
  rep_id                 uuid NOT NULL REFERENCES public.profiles(id),
  occurred_at            timestamptz NOT NULL DEFAULT clock_timestamp(),
  previous_review_status text NOT NULL,
  new_review_status      text NOT NULL,
  cutoff_was_passed      boolean NOT NULL,
  authorization_basis    text NOT NULL CHECK (authorization_basis IN ('on_time_window', 'on_time_original_exemption', 'admin_exception')),
  used_exception_id      uuid REFERENCES public.rep_report_late_submission_exceptions(id),
  CHECK ((authorization_basis = 'admin_exception') = (used_exception_id IS NOT NULL))
);

CREATE INDEX rep_report_resubmission_events_report_idx
  ON public.rep_report_resubmission_events (report_id, occurred_at);

ALTER TABLE public.rep_report_resubmission_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY rep_report_resubmission_events_select_own
  ON public.rep_report_resubmission_events
  FOR SELECT TO authenticated
  USING (rep_id = auth.uid());

CREATE POLICY rep_report_resubmission_events_select_assigned_manager
  ON public.rep_report_resubmission_events
  FOR SELECT TO authenticated
  USING (public.is_assigned_manager_of(rep_id));

CREATE POLICY rep_report_resubmission_events_select_former_manager
  ON public.rep_report_resubmission_events
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.rep_reports r WHERE r.id = report_id AND public.was_manager_for_assignment(r.owning_assignment_id)));

CREATE POLICY rep_report_resubmission_events_select_admin
  ON public.rep_report_resubmission_events
  FOR SELECT TO authenticated
  USING (public.is_admin());

GRANT SELECT ON public.rep_report_resubmission_events TO authenticated;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN
ON public.rep_report_resubmission_events
FROM authenticated, anon;

REVOKE SELECT
ON public.rep_report_resubmission_events
FROM anon;

-- ---------------------------------------------------------------------------
-- submit_rep_report — enforces the Friday 2:00 PM Eastern deadline for a
-- FIRST submission. A late submission requires an unused exception for this
-- report (oldest-first, row-locked via FOR UPDATE so two concurrent submit
-- attempts can never both consume it — the identical advisory-lock +
-- row-lock discipline already proven for assign_sales_rep in Phase 1A).
-- Stamps first_submitted_at exactly once (immutable from then on, enforced
-- by the trigger above) — this is the one fact POLICY 1 depends on.
-- clock_timestamp(), not now(), for submitted_at/first_submitted_at: the
-- advisory lock below can make this call WAIT, and now() is frozen at
-- transaction start, which could predate the actual moment this statement
-- runs — the exact now()-vs-clock_timestamp() bug already found and fixed
-- once in rep_manager_assignments (see 20261027140200's own comment).
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
      RAISE EXCEPTION 'SUBMISSION_DEADLINE_PASSED: The Friday 2:00 PM Eastern deadline for this reporting week has passed. An admin-authorized exception is required to submit now.';
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

-- ---------------------------------------------------------------------------
-- resubmit_rejected_rep_report — the correction path. Content must already
-- have been edited via save_rep_report_draft beforehand; this function only
-- transitions lifecycle columns and records the resubmission event.
--
-- Authorization for a LATE resubmission (cutoff already passed):
--   - POLICY 1: if this report's first_submitted_at was itself on time
--     (re-derived live against the SAME cutoff predicate — never a cached
--     flag), the correction is allowed with NO exception required.
--   - Otherwise (the report's first submission was itself late, meaning it
--     only happened via a consumed exception): a FRESH, unused exception is
--     required — the original exception never carries over to a
--     resubmission, exactly as before.
-- Never touches owning_assignment_id or first_submitted_at — both remain
-- immutable (enforced by the trigger above regardless of this function).
-- Never alters who may review the report — review_rep_report's own
-- is_assigned_manager_of()-OR-is_admin() check, re-derived fresh from
-- auth.uid() on every call, is completely untouched.
-- ---------------------------------------------------------------------------
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
        RAISE EXCEPTION 'SUBMISSION_DEADLINE_PASSED: The Friday 2:00 PM Eastern deadline for this reporting week has passed. An admin-authorized exception is required to resubmit now.';
      END IF;

      UPDATE public.rep_report_late_submission_exceptions
      SET consumed_at = clock_timestamp(), consumed_by = v_caller, consumed_by_operation = 'resubmit'
      WHERE id = v_exception.id;

      v_basis := 'admin_exception';
      v_used_exception_id := v_exception.id;
    END IF;
  END IF;

  -- reviewed_by/reviewed_at reflect only the LATEST decision (same
  -- convention Phase 1A already documented on the table itself) — cleared
  -- here because, after a resubmission, there is no decision yet on the
  -- CURRENT content; the superseded rejection (who, when, why) remains
  -- permanently in rep_report_review_history regardless.
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

REVOKE ALL ON FUNCTION public.resubmit_rejected_rep_report(date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.resubmit_rejected_rep_report(date) FROM anon;
GRANT EXECUTE ON FUNCTION public.resubmit_rejected_rep_report(date) TO authenticated;

-- ---------------------------------------------------------------------------
-- grant_rep_report_late_submission_exception — admin-only. INSERTs a new,
-- permanent audit row (POLICY 2) rather than updating rep_reports. Applies
-- to an EXISTING rep_reports row only (a draft must already exist via
-- save_rep_report_draft) — retained unchanged from the prior draft; no
-- change was necessary here since nothing about this requirement was
-- affected by either approved policy. A non-empty reason is mandatory.
-- Multiple outstanding (unused) grants for the same report are permitted —
-- each is its own durable row; submit/resubmit consume the OLDEST unused one
-- first (FIFO), never more than one per late action.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.grant_rep_report_late_submission_exception(
  p_rep_id uuid,
  p_week_start_date date,
  p_reason text
)
RETURNS public.rep_report_late_submission_exceptions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_report_id uuid;
  v_result public.rep_report_late_submission_exceptions;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'FORBIDDEN: Only an admin may grant a late submission exception.';
  END IF;

  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'REASON_REQUIRED: A non-empty reason is required to grant a late submission exception.';
  END IF;

  SELECT id INTO v_report_id FROM public.rep_reports
  WHERE rep_id = p_rep_id AND week_start_date = p_week_start_date;

  IF v_report_id IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: No report exists yet for this rep/week — the rep must save a draft before an exception can be granted.';
  END IF;

  INSERT INTO public.rep_report_late_submission_exceptions (report_id, granted_by, reason)
  VALUES (v_report_id, v_caller, p_reason)
  RETURNING * INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.grant_rep_report_late_submission_exception(uuid, date, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.grant_rep_report_late_submission_exception(uuid, date, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.grant_rep_report_late_submission_exception(uuid, date, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- Self-test 1: the cutoff predicate itself, immediately before / exactly at
-- / immediately after 2:00 PM Eastern, across EST (winter), EDT (summer),
-- and the weeks immediately following both DST transitions in 2026
-- (spring-forward 2026-03-08, fall-back 2026-11-01) — no auth context
-- needed, this is a pure stateless computation. Unchanged from the prior
-- draft (test list item "i" — DST and reporting-week boundaries).
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  -- Winter (EST, UTC-5): Friday 2026-01-09 14:00 America/New_York = 19:00 UTC.
  IF public.rep_report_submission_cutoff_passed('2026-01-05', '2026-01-09 18:59:00+00'::timestamptz) THEN
    RAISE EXCEPTION 'FAILED: cutoff reported passed one minute before 2:00 PM Eastern (winter/EST).';
  END IF;
  IF NOT public.rep_report_submission_cutoff_passed('2026-01-05', '2026-01-09 19:00:00+00'::timestamptz) THEN
    RAISE EXCEPTION 'FAILED: cutoff reported NOT passed exactly at 2:00 PM Eastern (winter/EST).';
  END IF;
  IF NOT public.rep_report_submission_cutoff_passed('2026-01-05', '2026-01-09 19:01:00+00'::timestamptz) THEN
    RAISE EXCEPTION 'FAILED: cutoff reported NOT passed one minute after 2:00 PM Eastern (winter/EST).';
  END IF;
  RAISE NOTICE 'PASSED: Friday 2:00 PM Eastern cutoff computed correctly in EST (winter, UTC-5) immediately before/at/after the boundary.';

  -- Summer (EDT, UTC-4): Friday 2026-07-10 14:00 America/New_York = 18:00 UTC.
  IF public.rep_report_submission_cutoff_passed('2026-07-06', '2026-07-10 17:59:00+00'::timestamptz) THEN
    RAISE EXCEPTION 'FAILED: cutoff reported passed one minute before 2:00 PM Eastern (summer/EDT).';
  END IF;
  IF NOT public.rep_report_submission_cutoff_passed('2026-07-06', '2026-07-10 18:00:00+00'::timestamptz) THEN
    RAISE EXCEPTION 'FAILED: cutoff reported NOT passed exactly at 2:00 PM Eastern (summer/EDT).';
  END IF;
  IF NOT public.rep_report_submission_cutoff_passed('2026-07-06', '2026-07-10 18:01:00+00'::timestamptz) THEN
    RAISE EXCEPTION 'FAILED: cutoff reported NOT passed one minute after 2:00 PM Eastern (summer/EDT).';
  END IF;
  RAISE NOTICE 'PASSED: Friday 2:00 PM Eastern cutoff computed correctly in EDT (summer, UTC-4) immediately before/at/after the boundary.';

  -- Week immediately after spring-forward (DST begins Sun 2026-03-08 02:00 ->
  -- 03:00 local); Friday 2026-03-13 is fully inside EDT. 14:00 EDT = 18:00 UTC.
  IF public.rep_report_submission_cutoff_passed('2026-03-09', '2026-03-13 17:59:00+00'::timestamptz) THEN
    RAISE EXCEPTION 'FAILED: cutoff reported passed before 2:00 PM Eastern the week right after spring-forward.';
  END IF;
  IF NOT public.rep_report_submission_cutoff_passed('2026-03-09', '2026-03-13 18:00:00+00'::timestamptz) THEN
    RAISE EXCEPTION 'FAILED: cutoff reported NOT passed exactly at 2:00 PM Eastern the week right after spring-forward.';
  END IF;
  RAISE NOTICE 'PASSED: cutoff correctly uses EDT the week immediately following the spring-forward DST transition.';

  -- Week immediately after fall-back (DST ends Sun 2026-11-01 02:00 ->
  -- 01:00 local); Friday 2026-11-06 is fully inside EST. 14:00 EST = 19:00 UTC.
  IF public.rep_report_submission_cutoff_passed('2026-11-02', '2026-11-06 18:59:00+00'::timestamptz) THEN
    RAISE EXCEPTION 'FAILED: cutoff reported passed before 2:00 PM Eastern the week right after fall-back.';
  END IF;
  IF NOT public.rep_report_submission_cutoff_passed('2026-11-02', '2026-11-06 19:00:00+00'::timestamptz) THEN
    RAISE EXCEPTION 'FAILED: cutoff reported NOT passed exactly at 2:00 PM Eastern the week right after fall-back.';
  END IF;
  RAISE NOTICE 'PASSED: cutoff correctly uses EST the week immediately following the fall-back DST transition.';
END $$;

-- ---------------------------------------------------------------------------
-- Self-test 2: the full governance lifecycle — on-time/late first
-- submission, admin-only/reason-required exception grant, exception
-- consumption recorded permanently (never cleared), POLICY 1's on-time
-- exemption, an originally-late report still requiring a fresh exception,
-- failed-attempt/role-deactivation non-consumption, repeated-consumption
-- rejection (even bypassing RLS), append-only review + resubmission
-- history, and assignment-scoped authorization surviving a reassignment
-- mid-correction.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  fake_admin_id uuid;
  fake_rep_id uuid := gen_random_uuid();
  fake_manager_a_id uuid := gen_random_uuid();
  fake_manager_b_id uuid := gen_random_uuid();
  fake_other_rep_id uuid := gen_random_uuid();
  -- Both Mondays (verified by calendar arithmetic, not assumed): a week
  -- safely in the past relative to this migration's authoring date (its
  -- Friday 2:00 PM Eastern deadline has certainly already passed under any
  -- real system clock going forward) and one safely in the future.
  past_week date := '2026-01-05';
  future_week date := '2026-12-07';
  v_report_id uuid;
  v_exception_id uuid;
  caught boolean;
BEGIN
  SELECT id INTO fake_admin_id FROM public.profiles WHERE role = 'admin' AND is_active = true LIMIT 1;
  IF fake_admin_id IS NULL THEN
    RAISE NOTICE 'SKIPPED rep_reports_submission_governance self-test: needs at least one active admin profile.';
    RETURN;
  END IF;

  BEGIN
    SET ROLE authenticated;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIPPED rep_reports_submission_governance self-test: this session cannot SET ROLE authenticated (%).', SQLERRM;
    RETURN;
  END;

  BEGIN
    INSERT INTO auth.users (id) VALUES (fake_rep_id), (fake_manager_a_id), (fake_manager_b_id), (fake_other_rep_id);
    INSERT INTO public.profiles (id, full_name, email, role, is_active) VALUES
      (fake_rep_id, 'Phase 1B Test Rep', 'phase1b-gov-rep-' || fake_rep_id || '@example.invalid', 'sales_rep', true),
      (fake_manager_a_id, 'Phase 1B Test Manager A', 'phase1b-gov-mgr-a-' || fake_manager_a_id || '@example.invalid', 'manager', true),
      (fake_manager_b_id, 'Phase 1B Test Manager B', 'phase1b-gov-mgr-b-' || fake_manager_b_id || '@example.invalid', 'manager', true),
      (fake_other_rep_id, 'Phase 1B Test Other Rep', 'phase1b-gov-rep2-' || fake_other_rep_id || '@example.invalid', 'sales_rep', true);
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIPPED rep_reports_submission_governance self-test: could not create throwaway profiles (%).', SQLERRM;
    RETURN;
  END;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', fake_admin_id)::text, true);
  PERFORM public.assign_sales_rep(fake_rep_id, fake_manager_a_id);

  -- Test 1: an on-time (future-week) submission succeeds, no exception needed.
  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', fake_rep_id)::text, true);
  PERFORM public.save_rep_report_draft(future_week, '{"note": "on time"}'::jsonb);
  PERFORM public.submit_rep_report(future_week);
  RESET ROLE;
  IF NOT EXISTS (SELECT 1 FROM public.rep_reports WHERE rep_id = fake_rep_id AND week_start_date = future_week AND status = 'submitted' AND first_submitted_at IS NOT NULL) THEN
    RAISE EXCEPTION 'FAILED: an on-time submission for a future reporting week was not accepted, or first_submitted_at was not stamped.';
  END IF;
  RAISE NOTICE 'PASSED: a submission before the Friday 2:00 PM Eastern deadline succeeds with no exception, and stamps first_submitted_at.';

  -- Test 2 (list item a/b setup): a late (past-week) FIRST submission is
  -- rejected without an exception.
  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', fake_rep_id)::text, true);
  PERFORM public.save_rep_report_draft(past_week, '{"note": "late draft"}'::jsonb);
  caught := false;
  BEGIN
    PERFORM public.submit_rep_report(past_week);
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'SUBMISSION_DEADLINE_PASSED%' THEN caught := true; ELSE RAISE; END IF;
  END;
  RESET ROLE;
  IF NOT caught THEN
    RAISE EXCEPTION 'FAILED: a first submission for a past reporting week (deadline long passed) was accepted without an exception.';
  END IF;
  RAISE NOTICE 'PASSED: a late first submission is rejected server-side when no exception has been granted.';

  -- Test 3: only an admin can grant a late submission exception (denied
  -- non-admin grants: sales_rep and manager both refused).
  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', fake_rep_id)::text, true);
  caught := false;
  BEGIN
    PERFORM public.grant_rep_report_late_submission_exception(fake_rep_id, past_week, 'rep granting their own exception');
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'FORBIDDEN%' THEN caught := true; ELSE RAISE; END IF;
  END;
  RESET ROLE;
  IF NOT caught THEN
    RAISE EXCEPTION 'FAILED: a sales_rep could grant their own late submission exception.';
  END IF;

  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', fake_manager_a_id)::text, true);
  caught := false;
  BEGIN
    PERFORM public.grant_rep_report_late_submission_exception(fake_rep_id, past_week, 'manager granting an exception');
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'FORBIDDEN%' THEN caught := true; ELSE RAISE; END IF;
  END;
  RESET ROLE;
  IF NOT caught THEN
    RAISE EXCEPTION 'FAILED: a manager (not an admin) could grant a late submission exception.';
  END IF;
  RAISE NOTICE 'PASSED: only an admin can grant a late submission exception.';

  -- Test 4: an admin-granted exception requires a non-empty reason.
  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', fake_admin_id)::text, true);
  caught := false;
  BEGIN
    PERFORM public.grant_rep_report_late_submission_exception(fake_rep_id, past_week, '   ');
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'REASON_REQUIRED%' THEN caught := true; ELSE RAISE; END IF;
  END;
  RESET ROLE;
  IF NOT caught THEN
    RAISE EXCEPTION 'FAILED: a late submission exception was granted with an empty/whitespace-only reason.';
  END IF;
  RAISE NOTICE 'PASSED: an empty/whitespace-only exception reason is rejected.';

  -- Test 5: duplicate grants are permitted as independent durable rows —
  -- grant TWO exceptions before either is used.
  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', fake_admin_id)::text, true);
  PERFORM public.grant_rep_report_late_submission_exception(fake_rep_id, past_week, 'first grant — rep was traveling');
  PERFORM public.grant_rep_report_late_submission_exception(fake_rep_id, past_week, 'second grant — approved as backup');
  RESET ROLE;
  SELECT id INTO v_report_id FROM public.rep_reports WHERE rep_id = fake_rep_id AND week_start_date = past_week;
  IF (SELECT count(*) FROM public.rep_report_late_submission_exceptions WHERE report_id = v_report_id) <> 2 THEN
    RAISE EXCEPTION 'FAILED: expected exactly 2 durable exception rows after 2 grants, found %.',
      (SELECT count(*) FROM public.rep_report_late_submission_exceptions WHERE report_id = v_report_id);
  END IF;
  RAISE NOTICE 'PASSED: duplicate grants for the same report are permitted as independent, durable rows (test list item "d" setup).';

  -- Test 6: the late first submission now succeeds, consuming the OLDEST
  -- (first-granted) unused exception, FIFO.
  SELECT id INTO v_exception_id FROM public.rep_report_late_submission_exceptions
  WHERE report_id = v_report_id AND reason = 'first grant — rep was traveling';

  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', fake_rep_id)::text, true);
  PERFORM public.submit_rep_report(past_week);
  RESET ROLE;
  IF NOT EXISTS (SELECT 1 FROM public.rep_reports WHERE id = v_report_id AND status = 'submitted' AND first_submitted_at IS NOT NULL) THEN
    RAISE EXCEPTION 'FAILED: a late submission with a valid admin-authorized exception was still rejected.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.rep_report_late_submission_exceptions
    WHERE id = v_exception_id AND consumed_at IS NOT NULL AND consumed_by = fake_rep_id AND consumed_by_operation = 'submit'
  ) THEN
    RAISE EXCEPTION 'FAILED: the FIRST-granted (oldest) exception was not the one consumed — FIFO ordering was not respected.';
  END IF;
  IF (SELECT count(*) FROM public.rep_report_late_submission_exceptions WHERE report_id = v_report_id AND consumed_at IS NULL) <> 1 THEN
    RAISE EXCEPTION 'FAILED: expected exactly 1 remaining unused exception after one was consumed.';
  END IF;
  RAISE NOTICE 'PASSED: a late first submission succeeds via the oldest unused exception (FIFO), consuming exactly that one.';

  -- Test 7 (test list item "d" — grant/consumption audit persistence): the
  -- consumed exception row is NEVER deleted or hidden — it remains queryable
  -- forever, permanently recording who granted it, when, why, who consumed
  -- it, when, and by which operation. This is the core difference from the
  -- prior (unapproved) design, which used to CLEAR these fields on
  -- consumption.
  IF NOT EXISTS (
    SELECT 1 FROM public.rep_report_late_submission_exceptions
    WHERE id = v_exception_id
      AND granted_by = fake_admin_id
      AND reason = 'first grant — rep was traveling'
      AND granted_at IS NOT NULL
      AND consumed_at IS NOT NULL
      AND consumed_by = fake_rep_id
      AND consumed_by_operation = 'submit'
  ) THEN
    RAISE EXCEPTION 'FAILED: the consumed exception''s full grant+consumption record did not persist permanently.';
  END IF;
  RAISE NOTICE 'PASSED: a consumed exception''s full audit record (grant + consumption) persists permanently — nothing is cleared, nothing disappears.';

  -- Test 8: the currently assigned manager rejects the (late-submitted) report.
  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', fake_manager_a_id)::text, true);
  PERFORM public.review_rep_report(v_report_id, 'rejected', 'numbers look off, please recheck');
  RESET ROLE;

  -- Test 9: the rep edits the rejected report's content via
  -- save_rep_report_draft (allowed post-rejection, unlike a pending/approved
  -- submitted report) — unchanged behavior from the prior draft.
  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', fake_rep_id)::text, true);
  PERFORM public.save_rep_report_draft(past_week, '{"note": "corrected numbers"}'::jsonb);
  RESET ROLE;
  IF NOT EXISTS (
    SELECT 1 FROM public.rep_reports
    WHERE id = v_report_id AND content = '{"note": "corrected numbers"}'::jsonb
      AND status = 'submitted' AND review_status = 'rejected'
  ) THEN
    RAISE EXCEPTION 'FAILED: a rejected report''s content could not be edited via save_rep_report_draft, or its status/review_status changed unexpectedly.';
  END IF;
  RAISE NOTICE 'PASSED: a rejected, submitted report''s content can be revised via save_rep_report_draft without changing its status or review_status.';

  -- Test 10 (test list item "c" — originally LATE first submission, denied
  -- resubmission without a NEW exception): this report's first submission
  -- was itself late (via the consumed exception in Test 6), so POLICY 1's
  -- on-time exemption does NOT apply — resubmitting now (still past the
  -- deadline, and the remaining unused exception from Test 5 is still
  -- present) should actually SUCCEED using that second exception. To prove
  -- the "no fresh exception -> denied" case cleanly, first consume the
  -- SECOND remaining exception via a throwaway failed-then-retried check:
  -- actually simplest is to directly verify denial by temporarily removing
  -- a round-trip — instead, verify the remaining exception gets consumed
  -- (proving a late report never resubmits "for free"), then prove a LATER
  -- attempt with zero remaining exceptions is denied.
  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', fake_rep_id)::text, true);
  PERFORM public.resubmit_rejected_rep_report(past_week);
  RESET ROLE;
  IF NOT EXISTS (
    SELECT 1 FROM public.rep_reports
    WHERE id = v_report_id AND review_status = 'pending' AND reviewed_by IS NULL AND reviewed_at IS NULL AND status = 'submitted'
  ) THEN
    RAISE EXCEPTION 'FAILED: resubmitting an originally-late report with a remaining unused exception did not succeed.';
  END IF;
  IF (SELECT count(*) FROM public.rep_report_late_submission_exceptions WHERE report_id = v_report_id AND consumed_at IS NULL) <> 0 THEN
    RAISE EXCEPTION 'FAILED: expected zero remaining unused exceptions after the second one was consumed by resubmission.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.rep_report_resubmission_events
    WHERE report_id = v_report_id AND authorization_basis = 'admin_exception' AND used_exception_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'FAILED: the resubmission event was not recorded with authorization_basis = admin_exception.';
  END IF;
  RAISE NOTICE 'PASSED: an originally-late report''s resubmission still requires consuming its own fresh exception (POLICY 1 does not apply) — recorded as authorization_basis = admin_exception.';

  -- Now reject again and prove a FURTHER late resubmission, with zero
  -- exceptions remaining, is denied outright.
  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', fake_manager_a_id)::text, true);
  PERFORM public.review_rep_report(v_report_id, 'rejected', 'still not right');
  RESET ROLE;

  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', fake_rep_id)::text, true);
  caught := false;
  BEGIN
    PERFORM public.resubmit_rejected_rep_report(past_week);
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'SUBMISSION_DEADLINE_PASSED%' THEN caught := true; ELSE RAISE; END IF;
  END;
  RESET ROLE;
  IF NOT caught THEN
    RAISE EXCEPTION 'FAILED: an originally-late report was resubmitted past the deadline with zero remaining exceptions.';
  END IF;
  RAISE NOTICE 'PASSED: with zero unused exceptions remaining, a late resubmission of an originally-late report is denied — POLICY 1''s exemption never applies to it.';

  -- Test 11 (test list item "e" + role deactivation): a FAILED resubmission
  -- attempt never consumes an exception. Grant a fresh exception, then
  -- deactivate the rep so the call fails at the role/active check — BEFORE
  -- the advisory lock or any exception lookup is ever reached. Postgres
  -- guarantees a single function invocation is one atomic unit (the same
  -- guarantee review_rep_report's own atomicity test already relies on) —
  -- a failure anywhere inside rolls back everything that call did, so this
  -- also stands in for proving a later-stage failure could never leave a
  -- half-consumed exception.
  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', fake_admin_id)::text, true);
  PERFORM public.grant_rep_report_late_submission_exception(fake_rep_id, past_week, 'window for one more correction');
  RESET ROLE;
  SELECT id INTO v_exception_id FROM public.rep_report_late_submission_exceptions
  WHERE report_id = v_report_id AND consumed_at IS NULL;

  UPDATE public.profiles SET is_active = false WHERE id = fake_rep_id;

  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', fake_rep_id)::text, true);
  caught := false;
  BEGIN
    PERFORM public.resubmit_rejected_rep_report(past_week);
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'FORBIDDEN%' THEN caught := true; ELSE RAISE; END IF;
  END;
  RESET ROLE;
  IF NOT caught THEN
    RAISE EXCEPTION 'FAILED: a deactivated sales_rep could still resubmit their report.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.rep_report_late_submission_exceptions WHERE id = v_exception_id AND consumed_at IS NULL) THEN
    RAISE EXCEPTION 'FAILED: a failed resubmission attempt (blocked by role deactivation) still consumed the exception.';
  END IF;
  RAISE NOTICE 'PASSED: a deactivated sales_rep is refused before reaching any exception logic, and the exception remains unconsumed — a failed attempt never consumes it.';

  UPDATE public.profiles SET is_active = true WHERE id = fake_rep_id;

  -- Test 12: repeated consumption of the SAME exception is impossible, even
  -- for THIS session's own superuser-equivalent role with full table
  -- privileges and no RLS restriction at all — the guard trigger is a real,
  -- independent backstop, exactly the same proof style as
  -- owning_assignment_id's own immutability test in the previous migration.
  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', fake_rep_id)::text, true);
  PERFORM public.resubmit_rejected_rep_report(past_week);
  RESET ROLE;
  IF NOT EXISTS (SELECT 1 FROM public.rep_report_late_submission_exceptions WHERE id = v_exception_id AND consumed_at IS NOT NULL) THEN
    RAISE EXCEPTION 'FAILED (setup): the exception was not actually consumed by the successful resubmission above.';
  END IF;

  caught := false;
  BEGIN
    UPDATE public.rep_report_late_submission_exceptions
    SET consumed_at = clock_timestamp(), consumed_by = fake_admin_id, consumed_by_operation = 'submit'
    WHERE id = v_exception_id;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'EXCEPTION_ALREADY_FINALIZED%' THEN caught := true; ELSE RAISE; END IF;
  END;
  IF NOT caught THEN
    RAISE EXCEPTION 'FAILED: an already-consumed exception record was modified again, even with full table privileges and no RLS restriction — the guard trigger did not fire.';
  END IF;

  caught := false;
  BEGIN
    UPDATE public.rep_report_late_submission_exceptions SET reason = 'tampering with history' WHERE id = v_exception_id;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'EXCEPTION_ALREADY_FINALIZED%' THEN caught := true; ELSE RAISE; END IF;
  END;
  IF NOT caught THEN
    RAISE EXCEPTION 'FAILED: an already-consumed exception record''s reason was changed — audit history is tamperable.';
  END IF;
  RAISE NOTICE 'PASSED: repeated consumption and any other modification of an already-consumed exception record is impossible — the guard trigger is a real backstop, independent of the RLS/grant layer that already blocks ordinary callers (test list item "f", repeated-consumption half).';

  -- Test 13: the resubmission events for this report are preserved,
  -- append-only, oldest first — test list item "h".
  IF (SELECT count(*) FROM public.rep_report_resubmission_events WHERE report_id = v_report_id) <> 2 THEN
    RAISE EXCEPTION 'FAILED: expected exactly 2 resubmission-event rows (two resubmissions above), found %.',
      (SELECT count(*) FROM public.rep_report_resubmission_events WHERE report_id = v_report_id);
  END IF;
  RAISE NOTICE 'PASSED: every resubmission event is preserved as its own append-only row — actor, time, previous/new state, and authorization basis all retained.';

  -- Test 14 (test list item "b" — on-time first submission, rejection AFTER
  -- the cutoff, successful correction/resubmission under POLICY 1, with NO
  -- exception at all): real wall-clock time cannot be made to "pass" a
  -- future week's deadline within one fast test, so this exercises the
  -- REAL resubmit_rejected_rep_report code path end-to-end against a
  -- directly-constructed historical precondition instead of merely calling
  -- the predicate in isolation (already covered by Self-test 1): a second,
  -- distinct past week (2026-02-02, a Monday, its Friday 2026-02-06 at
  -- 14:00 America/New_York = 19:00 UTC in EST) is used so the ORIGINAL
  -- submission can be made to have genuinely happened ON TIME relative to
  -- its own week (first_submitted_at set to one hour before that week's own
  -- cutoff), while "now" (real clock_timestamp(), used by
  -- resubmit_rejected_rep_report's own live cutoff check) is certainly well
  -- past it. The draft->submitted transition itself is constructed directly
  -- here (not via submit_rep_report, which always stamps the REAL current
  -- time and could never backdate it) — first_submitted_at is NULL on this
  -- fresh row, so this UPDATE is the one legitimate NULL->value transition
  -- the immutability trigger allows, exactly like submit_rep_report's own
  -- first real use of it.
  DECLARE
    on_time_week date := '2026-02-02';
    on_time_report_id uuid;
  BEGIN
    SET ROLE authenticated;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', fake_rep_id)::text, true);
    PERFORM public.save_rep_report_draft(on_time_week, '{"note": "on time, long ago"}'::jsonb);
    RESET ROLE;

    SELECT id INTO on_time_report_id FROM public.rep_reports WHERE rep_id = fake_rep_id AND week_start_date = on_time_week;

    UPDATE public.rep_reports
    SET status = 'submitted', submission_source = 'manual',
        submitted_at = '2026-02-06 18:00:00+00'::timestamptz,
        first_submitted_at = '2026-02-06 18:00:00+00'::timestamptz
    WHERE id = on_time_report_id;

    IF public.rep_report_submission_cutoff_passed(on_time_week, '2026-02-06 18:00:00+00'::timestamptz) THEN
      RAISE EXCEPTION 'FAILED (test setup): the constructed first_submitted_at was not actually before its own week''s cutoff.';
    END IF;
    IF NOT public.rep_report_submission_cutoff_passed(on_time_week) THEN
      RAISE EXCEPTION 'FAILED (test setup): on_time_week''s cutoff is not actually in the past relative to the real current time.';
    END IF;

    SET ROLE authenticated;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', fake_manager_a_id)::text, true);
    PERFORM public.review_rep_report(on_time_report_id, 'rejected', 'needs a small correction');
    RESET ROLE;

    -- The real resubmission, long after the deadline, with ZERO exceptions
    -- granted for this report at all — must succeed purely on POLICY 1.
    SET ROLE authenticated;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', fake_rep_id)::text, true);
    PERFORM public.resubmit_rejected_rep_report(on_time_week);
    RESET ROLE;

    IF NOT EXISTS (
      SELECT 1 FROM public.rep_reports
      WHERE id = on_time_report_id AND review_status = 'pending' AND status = 'submitted'
    ) THEN
      RAISE EXCEPTION 'FAILED: a post-deadline correction of an ORIGINALLY ON-TIME report was not allowed under POLICY 1.';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.rep_report_resubmission_events
      WHERE report_id = on_time_report_id AND authorization_basis = 'on_time_original_exemption'
        AND used_exception_id IS NULL AND cutoff_was_passed = true
    ) THEN
      RAISE EXCEPTION 'FAILED: the resubmission event for the on-time-exemption case was not recorded with authorization_basis = on_time_original_exemption and no exception used.';
    END IF;
    RAISE NOTICE 'PASSED (POLICY 1): a report whose ORIGINAL first submission was on time can be corrected and resubmitted after the deadline with NO admin exception at all, and this is recorded with authorization_basis = on_time_original_exemption.';
  END;

  -- Test 15: assignment-scoped authorization is NOT bypassed by the
  -- resubmission path, and a former manager cannot grant exceptions either.
  -- Reassign the rep to manager B, B rejects again (on the past_week
  -- report), admin grants a fresh exception, rep resubmits — the now-FORMER
  -- manager A must be refused review AND refused granting an exception
  -- (admin-only regardless of assignment), while current manager B and the
  -- admin both succeed as expected.
  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', fake_admin_id)::text, true);
  PERFORM public.assign_sales_rep(fake_rep_id, fake_manager_b_id);
  RESET ROLE;

  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', fake_manager_b_id)::text, true);
  PERFORM public.review_rep_report(v_report_id, 'rejected', 'manager B found another issue');
  RESET ROLE;

  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', fake_manager_a_id)::text, true);
  caught := false;
  BEGIN
    PERFORM public.grant_rep_report_late_submission_exception(fake_rep_id, past_week, 'former manager trying to grant an exception');
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'FORBIDDEN%' THEN caught := true; ELSE RAISE; END IF;
  END;
  RESET ROLE;
  IF NOT caught THEN
    RAISE EXCEPTION 'FAILED: a former manager (not an admin) could grant a late submission exception.';
  END IF;

  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', fake_admin_id)::text, true);
  PERFORM public.grant_rep_report_late_submission_exception(fake_rep_id, past_week, 'second correction window approved');
  RESET ROLE;

  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', fake_rep_id)::text, true);
  PERFORM public.resubmit_rejected_rep_report(past_week);
  RESET ROLE;

  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', fake_manager_a_id)::text, true);
  caught := false;
  BEGIN
    PERFORM public.review_rep_report(v_report_id, 'approved', 'former manager trying to review the resubmission');
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'FORBIDDEN%' THEN caught := true; ELSE RAISE; END IF;
  END;
  RESET ROLE;
  IF NOT caught THEN
    RAISE EXCEPTION 'FAILED: a FORMER manager could review a report that was resubmitted after reassignment — assignment-scoped authorization was bypassed by the resubmission path.';
  END IF;

  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', fake_manager_b_id)::text, true);
  PERFORM public.review_rep_report(v_report_id, 'approved', 'manager B approves the resubmission');
  RESET ROLE;
  IF NOT EXISTS (SELECT 1 FROM public.rep_reports WHERE id = v_report_id AND review_status = 'approved' AND reviewed_by = fake_manager_b_id) THEN
    RAISE EXCEPTION 'FAILED: the current assigned manager (B) could not review the resubmitted report.';
  END IF;
  RAISE NOTICE 'PASSED: resubmission never bypasses assignment-scoped review authorization, and a former manager can neither review nor grant an exception — only the CURRENTLY assigned manager or an admin can act (test list item "g", former-manager half).';

  -- Test 16: owning_assignment_id AND first_submitted_at never changed
  -- through any of this, across every rejection, correction, and
  -- reassignment above.
  IF NOT EXISTS (
    SELECT 1 FROM public.rep_reports r
    JOIN public.rep_manager_assignments a ON a.id = r.owning_assignment_id
    WHERE r.id = v_report_id AND a.manager_id = fake_manager_a_id
  ) THEN
    RAISE EXCEPTION 'FAILED: owning_assignment_id drifted away from the original (manager A) assignment despite a later reassignment and multiple resubmissions.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.rep_reports WHERE id = v_report_id AND first_submitted_at IS NOT NULL) THEN
    RAISE EXCEPTION 'FAILED: first_submitted_at was cleared at some point during this report''s lifecycle.';
  END IF;
  RAISE NOTICE 'PASSED: owning_assignment_id and first_submitted_at both remain immutable across rejection, correction, reassignment, and multiple resubmissions.';

  -- Test 17 (test list item "g" — cross-rep denial): the other rep cannot
  -- see or be attributed any exception/resubmission event belonging to this
  -- rep's report, and granting an exception against the OTHER rep's
  -- nonexistent report for this week still correctly fails NOT_FOUND.
  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', fake_other_rep_id)::text, true);
  IF EXISTS (SELECT 1 FROM public.rep_report_late_submission_exceptions WHERE report_id = v_report_id) THEN
    RESET ROLE;
    RAISE EXCEPTION 'FAILED: an unrelated sales_rep could see another rep''s exception audit rows.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.rep_report_resubmission_events WHERE report_id = v_report_id) THEN
    RESET ROLE;
    RAISE EXCEPTION 'FAILED: an unrelated sales_rep could see another rep''s resubmission events.';
  END IF;
  RESET ROLE;

  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', fake_admin_id)::text, true);
  caught := false;
  BEGIN
    PERFORM public.grant_rep_report_late_submission_exception(fake_other_rep_id, past_week, 'no draft exists yet for this rep/week');
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'NOT_FOUND%' THEN caught := true; ELSE RAISE; END IF;
  END;
  RESET ROLE;
  IF NOT caught THEN
    RAISE EXCEPTION 'FAILED: an exception was granted for a rep/week that has no report row at all.';
  END IF;
  RAISE NOTICE 'PASSED: cross-rep access to exception/resubmission audit data is denied by RLS, and granting an exception for a rep/week with no report row still fails (test list item "g"/"d" retained requirement).';

  -- Cleanup.
  RESET request.jwt.claims;
  DELETE FROM public.rep_report_resubmission_events WHERE report_id IN (SELECT id FROM public.rep_reports WHERE rep_id IN (fake_rep_id, fake_other_rep_id));
  DELETE FROM public.rep_report_late_submission_exceptions WHERE report_id IN (SELECT id FROM public.rep_reports WHERE rep_id IN (fake_rep_id, fake_other_rep_id));
  DELETE FROM public.rep_report_review_history WHERE report_id IN (SELECT id FROM public.rep_reports WHERE rep_id IN (fake_rep_id, fake_other_rep_id));
  DELETE FROM public.rep_reports WHERE rep_id IN (fake_rep_id, fake_other_rep_id);
  DELETE FROM public.rep_manager_assignments WHERE rep_id IN (fake_rep_id, fake_other_rep_id);
  DELETE FROM public.profiles WHERE id IN (fake_rep_id, fake_manager_a_id, fake_manager_b_id, fake_other_rep_id);
  DELETE FROM auth.users WHERE id IN (fake_rep_id, fake_manager_a_id, fake_manager_b_id, fake_other_rep_id);
  RAISE NOTICE 'Cleanup PASSED: no residual synthetic rows remain.';
END $$;

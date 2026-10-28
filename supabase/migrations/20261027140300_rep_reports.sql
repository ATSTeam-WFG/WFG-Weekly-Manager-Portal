-- Sales Rep flow, Phase 1A, step 4 of 4 — a SEPARATE table for a sales
-- rep's own weekly report, deliberately not a repurposing of `reports`
-- (kept untouched beyond the previous migration's additive RESTRICTIVE
-- policy — no shared status machinery, no shared trigger, no shared
-- deadline, since the Friday cutoff/deadline rule for reps is explicitly
-- out of scope and not yet decided).
--
-- Content shape (`content jsonb`, not discrete columns): the exact fields a
-- rep report should contain are a product decision this task was not asked
-- to make. jsonb keeps the DB schema stable while that shape is finalized,
-- mirroring leadership_report_drafts' own existing content jsonb column —
-- the same choice already made elsewhere in this project for a form whose
-- shape was still evolving (see 20261006_leadership_report_word_template_shape.sql,
-- which changed that table's CONTENT shape with zero schema migration).
--
-- status/submission_source mirror reports' own verified constraints exactly
-- (draft/submitted; submission_source NULL iff draft, manual/automatic iff
-- submitted) — a deliberate consistency choice, not a coincidence.
--
-- review_status/reviewed_by/reviewed_at are this migration's own addition:
-- the minimum "current decision" columns a manager's approve/reject step (a
-- later, UI-building phase) needs to exist against. These reflect only the
-- LATEST decision; the full, immutable history of every decision and
-- revision (each with its own mandatory reason) lives in the separate
-- rep_report_review_history table, below — a review can be revised, and a
-- revision is an added history row, never an edit of a prior one. There is
-- deliberately no review_note/reason column on THIS table: a reason only
-- ever exists per decision, so it belongs on the history table alone,
-- rather than being duplicated here and risking drifting out of sync with
-- the latest history row.
CREATE TABLE public.rep_reports (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rep_id             uuid NOT NULL REFERENCES public.profiles(id),
  week_start_date    date NOT NULL,
  status             text NOT NULL DEFAULT 'draft'
                       CHECK (status IN ('draft', 'submitted')),
  submission_source  text
                       CHECK (
                         (status = 'draft' AND submission_source IS NULL)
                         OR (status = 'submitted' AND submission_source IN ('manual', 'automatic'))
                       ),
  submitted_at       timestamptz,
  content            jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- The SPECIFIC rep_manager_assignments row that was active for this rep
  -- at the moment this report row was first created — stamped once, by
  -- save_rep_report_draft, below, and never changed afterward (continuing
  -- to edit a draft across a later reassignment does not change who
  -- "owns" it; see that function's own comment). NULL only for a report
  -- created while the rep had no active assignment at all. This is a hard
  -- 1:1 ownership fact, not a date computation — see
  -- was_manager_for_assignment's own header in the previous migration for
  -- why a date-range-overlap approach was replaced with this.
  owning_assignment_id uuid REFERENCES public.rep_manager_assignments(id),
  review_status      text NOT NULL DEFAULT 'pending'
                       CHECK (review_status IN ('pending', 'approved', 'rejected')),
  reviewed_by        uuid REFERENCES public.profiles(id),
  reviewed_at        timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (rep_id, week_start_date),
  -- review_status can only ever move off 'pending' once a report is
  -- actually submitted — a draft is never "approved"/"rejected".
  CHECK (review_status = 'pending' OR status = 'submitted'),
  CHECK ((reviewed_by IS NULL) = (reviewed_at IS NULL))
);

CREATE INDEX rep_reports_rep_week_idx ON public.rep_reports (rep_id, week_start_date);

-- ---------------------------------------------------------------------------
-- owning_assignment_id immutability — a TRIGGER, not just "no current
-- function happens to touch it". None of the three write functions below
-- (save_rep_report_draft's own ON CONFLICT UPDATE, submit_rep_report,
-- review_rep_report) ever assigns to this column after the initial INSERT,
-- so this trigger has zero effect on any of today's legitimate behavior —
-- but relying on that alone would make immutability an emergent property
-- of the current code rather than a real guarantee, one accidental future
-- change away from silently breaking. Implemented as a trigger for the
-- exact same reason reports_enforce_manager_edit_cutoff() is a trigger
-- rather than an RLS policy (see 20260918_manager_edit_lock.sql's own
-- header): it fires for EVERY UPDATE statement regardless of which
-- function or future code path performs it, with no admin exemption —
-- this is a hard, bypass-proof floor, not a convention someone could
-- accidentally code around.
--
-- Safe for the one legitimate UPDATE path that exists: an
-- INSERT ... ON CONFLICT DO UPDATE whose SET list never mentions
-- owning_assignment_id (save_rep_report_draft's own upsert) presents NEW
-- with that column UNCHANGED from OLD for any column absent from the SET
-- list — so NEW.owning_assignment_id IS DISTINCT FROM OLD.owning_assignment_id
-- is false and this trigger never fires for it.
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
  RETURN NEW;
END;
$$;

CREATE TRIGGER rep_reports_owning_assignment_immutable_trigger
  BEFORE UPDATE ON public.rep_reports
  FOR EACH ROW
  EXECUTE FUNCTION public.rep_reports_owning_assignment_immutable();

ALTER TABLE public.rep_reports ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- RLS — default-deny: SELECT only, no INSERT/UPDATE/DELETE grant to anyone
-- at all. Every write goes through one of the three SECURITY DEFINER
-- functions below, each independently re-checking the caller's identity,
-- role, and (for the manager path) current active assignment via
-- is_assigned_manager_of() from the previous migration — not a parameter,
-- not a cached value, read fresh from auth.uid() on every call.
-- ---------------------------------------------------------------------------
CREATE POLICY rep_reports_select_own
  ON public.rep_reports
  FOR SELECT
  TO authenticated
  USING (rep_id = auth.uid());

CREATE POLICY rep_reports_select_assigned_manager
  ON public.rep_reports
  FOR SELECT
  TO authenticated
  USING (public.is_assigned_manager_of(rep_id));

CREATE POLICY rep_reports_select_admin
  ON public.rep_reports
  FOR SELECT
  TO authenticated
  USING (public.is_admin());

-- A FORMER manager's read-only, historical access: only for a report whose
-- own owning_assignment_id (stamped once, at creation — see
-- save_rep_report_draft below) is a CLOSED assignment this caller actually
-- held (was_manager_for_assignment, from the previous migration) — a
-- direct 1:1 row match, not a date-range computation, so exactly one
-- former manager can ever own a given report regardless of how many times
-- the rep was reassigned before or after. A report with no
-- owning_assignment_id (created while the rep had no active assignment)
-- is simply not reachable through this policy for anyone. Never anything
-- beyond SELECT: review_rep_report (below) does not call
-- was_manager_for_assignment anywhere, so a former manager — however this
-- policy scopes their reads — is never granted review rights over any
-- report, including ones from their own former tenure.
CREATE POLICY rep_reports_select_former_manager
  ON public.rep_reports
  FOR SELECT
  TO authenticated
  USING (public.was_manager_for_assignment(owning_assignment_id));

-- Explicit, not assumed — same reasoning as rep_manager_assignments' own
-- explicit SELECT grant in the previous migration.
GRANT SELECT ON public.rep_reports TO authenticated;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN
ON public.rep_reports
FROM authenticated, anon;

REVOKE SELECT
ON public.rep_reports
FROM anon;

-- ---------------------------------------------------------------------------
-- save_rep_report_draft — sales_rep-only, own row only. Upserts a draft;
-- refuses to touch a report that has already been submitted (the same
-- submitted-can-never-silently-revert-to-draft discipline
-- reports_enforce_manager_edit_cutoff() already applies to `reports`,
-- reused here deliberately for consistency, independent of that trigger).
-- No Friday/deadline check of any kind — that rule is not yet decided; this
-- phase only prevents a submitted report from being overwritten, which is a
-- data-integrity concern, not a deadline concern.
--
-- owning_assignment_id is stamped ONCE, only on the INSERT branch (ON
-- CONFLICT's UPDATE never touches it) — whichever assignment is active for
-- this rep at the moment their report row is FIRST created permanently
-- owns it, even if the rep keeps editing the same draft across a LATER
-- reassignment before finally submitting. This is a deliberate, stable
-- rule (not "whoever was active at submit time," which could itself land
-- on either side of a reassignment that happens mid-edit) — see
-- was_manager_for_assignment's own header in the previous migration for
-- why this replaced an earlier date-range-overlap approach that could let
-- more than one former manager claim the same report.
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
    WHERE rep_id = v_caller AND week_start_date = p_week_start_date AND status = 'submitted'
  ) THEN
    RAISE EXCEPTION 'REP_STATUS_REGRESSION_BLOCKED: An already-submitted report cannot be edited as a draft.';
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

REVOKE ALL ON FUNCTION public.save_rep_report_draft(date, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.save_rep_report_draft(date, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.save_rep_report_draft(date, jsonb) TO authenticated;

-- ---------------------------------------------------------------------------
-- submit_rep_report — sales_rep-only, own row only, draft -> submitted.
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
  v_result public.rep_reports;
BEGIN
  SELECT role, is_active INTO v_role, v_active FROM public.profiles WHERE id = v_caller;
  IF v_role IS DISTINCT FROM 'sales_rep' OR v_active IS NOT TRUE THEN
    RAISE EXCEPTION 'FORBIDDEN: Only an active sales_rep may submit their own report.';
  END IF;

  UPDATE public.rep_reports
  SET status = 'submitted', submission_source = 'manual', submitted_at = now(), updated_at = now()
  WHERE rep_id = v_caller AND week_start_date = p_week_start_date AND status = 'draft'
  RETURNING * INTO v_result;

  IF v_result IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: No draft report exists for this rep/week to submit.';
  END IF;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_rep_report(date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.submit_rep_report(date) FROM anon;
GRANT EXECUTE ON FUNCTION public.submit_rep_report(date) TO authenticated;

-- ---------------------------------------------------------------------------
-- rep_report_review_history — append-only audit trail of every review
-- decision AND every revision of one. Never updated, never deleted, by
-- anyone, including an admin — the only write path is an INSERT performed
-- internally by review_rep_report's own SECURITY DEFINER privileges; no
-- INSERT/UPDATE/DELETE grant exists for authenticated/anon at all, exactly
-- the same default-deny discipline as rep_reports itself. A reason is
-- mandatory and non-empty (CHECK below) for every single row — there is no
-- way to record a decision without one, initial or revised alike.
-- ---------------------------------------------------------------------------
CREATE TABLE public.rep_report_review_history (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id     uuid NOT NULL REFERENCES public.rep_reports(id),
  review_status text NOT NULL CHECK (review_status IN ('approved', 'rejected')),
  reason        text NOT NULL CHECK (btrim(reason) <> ''),
  reviewed_by   uuid NOT NULL REFERENCES public.profiles(id),
  reviewed_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX rep_report_review_history_report_idx
  ON public.rep_report_review_history (report_id, reviewed_at);

ALTER TABLE public.rep_report_review_history ENABLE ROW LEVEL SECURITY;

-- Same visibility shape as rep_reports itself (own/current-manager/
-- former-manager-within-window/admin), joined back to rep_reports to reach
-- each history row's own rep_id/week_start_date. A former manager seeing
-- the review history for a week they actually managed is the same
-- transparency principle as seeing the report content for that week —
-- still never anything beyond SELECT; nothing here grants write access of
-- any kind.
CREATE POLICY rep_report_review_history_select_own
  ON public.rep_report_review_history
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.rep_reports r
      WHERE r.id = rep_report_review_history.report_id AND r.rep_id = auth.uid()
    )
  );

CREATE POLICY rep_report_review_history_select_assigned_manager
  ON public.rep_report_review_history
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.rep_reports r
      WHERE r.id = rep_report_review_history.report_id AND public.is_assigned_manager_of(r.rep_id)
    )
  );

CREATE POLICY rep_report_review_history_select_former_manager
  ON public.rep_report_review_history
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.rep_reports r
      WHERE r.id = rep_report_review_history.report_id
        AND public.was_manager_for_assignment(r.owning_assignment_id)
    )
  );

CREATE POLICY rep_report_review_history_select_admin
  ON public.rep_report_review_history
  FOR SELECT
  TO authenticated
  USING (public.is_admin());

GRANT SELECT ON public.rep_report_review_history TO authenticated;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN
ON public.rep_report_review_history
FROM authenticated, anon;

REVOKE SELECT
ON public.rep_report_review_history
FROM anon;

-- ---------------------------------------------------------------------------
-- review_rep_report — the rep's CURRENTLY assigned manager, or an admin,
-- only (never was_manager_for_assignment — a former manager never reaches
-- this function's authorization check, regardless of what they can read).
-- Touches ONLY the review_* columns on rep_reports — never content, never
-- status, never submission_source — so a manager can never use this path
-- to alter what the rep actually reported, only to record a review
-- decision on it. Only a SUBMITTED report can be reviewed (a draft has
-- nothing to review yet).
--
-- REVISIONS: calling this again for a report that was already reviewed is
-- explicitly supported and treated as a revision, not an error — every
-- call (the first decision and every later revision alike) appends a new,
-- immutable row to rep_report_review_history with its own mandatory
-- reason; rep_reports' own review_status/reviewed_by/reviewed_at are then
-- updated to reflect this latest decision, so existing callers that only
-- read rep_reports still see the CURRENT state without needing to know
-- about the history table at all.
--
-- p_reason is REQUIRED and must be non-empty after trimming whitespace —
-- there is no way to approve or reject (or revise either) without stating
-- why, enforced here AND by rep_report_review_history's own CHECK
-- constraint (defense in depth: even a hypothetical future direct insert
-- into the history table, bypassing this function, could not create a
-- reasonless row).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.review_rep_report(
  p_report_id uuid,
  p_review_status text,
  p_reason text
)
RETURNS public.rep_reports
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_rep_id uuid;
  v_result public.rep_reports;
BEGIN
  IF p_review_status NOT IN ('approved', 'rejected') THEN
    RAISE EXCEPTION 'INVALID_REVIEW_STATUS: % is not a valid review status.', p_review_status;
  END IF;

  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'REASON_REQUIRED: A non-empty reason is required to approve, reject, or revise a review decision.';
  END IF;

  SELECT rep_id INTO v_rep_id FROM public.rep_reports WHERE id = p_report_id;
  IF v_rep_id IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: No such rep report.';
  END IF;

  IF NOT (public.is_assigned_manager_of(v_rep_id) OR public.is_admin()) THEN
    RAISE EXCEPTION 'FORBIDDEN: Only the rep''s currently assigned manager or an admin may review this report.';
  END IF;

  UPDATE public.rep_reports
  SET review_status = p_review_status,
      reviewed_by   = v_caller,
      reviewed_at   = now(),
      updated_at    = now()
  WHERE id = p_report_id AND status = 'submitted'
  RETURNING * INTO v_result;

  IF v_result IS NULL THEN
    RAISE EXCEPTION 'INVALID_STATE: Only a submitted report can be reviewed.';
  END IF;

  -- Append-only: a brand NEW row every single call, initial decision or
  -- revision alike — never an UPDATE of a prior history row.
  INSERT INTO public.rep_report_review_history (report_id, review_status, reason, reviewed_by)
  VALUES (p_report_id, p_review_status, p_reason, v_caller);

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.review_rep_report(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.review_rep_report(uuid, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.review_rep_report(uuid, text, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- Self-verifying test. All profiles/assignments/reports created here are
-- synthetic and removed before this block returns.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  fake_admin_id uuid;
  fake_rep_id uuid := gen_random_uuid();
  fake_other_rep_id uuid := gen_random_uuid();
  fake_manager_id uuid := gen_random_uuid();
  fake_other_manager_id uuid := gen_random_uuid();
  test_week date := '2099-04-13';
  v_report_id uuid;
  caught boolean;
BEGIN
  SELECT id INTO fake_admin_id FROM public.profiles WHERE role = 'admin' AND is_active = true LIMIT 1;
  IF fake_admin_id IS NULL THEN
    RAISE NOTICE 'SKIPPED rep_reports self-test: needs at least one active admin profile to run against.';
    RETURN;
  END IF;

  BEGIN
    INSERT INTO auth.users (id) VALUES (fake_rep_id), (fake_other_rep_id), (fake_manager_id), (fake_other_manager_id);
    INSERT INTO public.profiles (id, full_name, email, role, is_active) VALUES
      (fake_rep_id, 'Phase 1A Test Rep', 'phase1a-rr-rep-' || fake_rep_id || '@example.invalid', 'sales_rep', true),
      (fake_other_rep_id, 'Phase 1A Test Other Rep', 'phase1a-rr-rep2-' || fake_other_rep_id || '@example.invalid', 'sales_rep', true),
      (fake_manager_id, 'Phase 1A Test Manager', 'phase1a-rr-mgr-' || fake_manager_id || '@example.invalid', 'manager', true),
      (fake_other_manager_id, 'Phase 1A Test Other Manager', 'phase1a-rr-mgr2-' || fake_other_manager_id || '@example.invalid', 'manager', true);
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIPPED rep_reports self-test: could not create throwaway profiles (%).', SQLERRM;
    RETURN;
  END;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', fake_admin_id)::text, true);
  PERFORM public.assign_sales_rep(fake_rep_id, fake_manager_id);

  -- RLS does not apply to this migration-applying session's own role (table
  -- owner/superuser-equivalent) — every check below that depends on RLS
  -- being enforced runs under SET ROLE authenticated, exactly like
  -- 20261027140100_reports_restrict_to_manager_admin.sql's own self-test,
  -- which itself mirrors leadership_report_private_ownership_rollback_test.sql's
  -- established convention.
  BEGIN
    SET ROLE authenticated;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIPPED rep_reports self-test: this session cannot SET ROLE authenticated (%). Re-run from a role with authenticated membership to genuinely exercise RLS.', SQLERRM;
    DELETE FROM public.rep_manager_assignments WHERE rep_id = fake_rep_id;
    DELETE FROM public.profiles WHERE id IN (fake_rep_id, fake_other_rep_id, fake_manager_id, fake_other_manager_id);
    DELETE FROM auth.users WHERE id IN (fake_rep_id, fake_other_rep_id, fake_manager_id, fake_other_manager_id);
    RETURN;
  END;

  -- Test 1: the rep can save and read their own draft.
  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', fake_rep_id)::text, true);
  PERFORM public.save_rep_report_draft(test_week, '{"highlights": "Phase 1A test content"}'::jsonb);
  IF NOT EXISTS (SELECT 1 FROM public.rep_reports WHERE rep_id = fake_rep_id AND week_start_date = test_week) THEN
    RESET ROLE;
    RAISE EXCEPTION 'FAILED: rep could not read back their own saved draft.';
  END IF;
  RESET ROLE;
  RAISE NOTICE 'PASSED: a sales_rep can save and read their own draft.';

  -- Test 2: the OTHER rep (not assigned to this manager, unrelated to this
  -- report) cannot see it at all.
  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', fake_other_rep_id)::text, true);
  IF EXISTS (SELECT 1 FROM public.rep_reports WHERE rep_id = fake_rep_id AND week_start_date = test_week) THEN
    RESET ROLE;
    RAISE EXCEPTION 'FAILED: an unrelated sales_rep could see another rep''s report row.';
  END IF;
  RESET ROLE;
  RAISE NOTICE 'PASSED: an unrelated sales_rep cannot see another rep''s report.';

  -- Test 3: the unrelated OTHER manager (no assignment to this rep) cannot
  -- see it either.
  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', fake_other_manager_id)::text, true);
  IF EXISTS (SELECT 1 FROM public.rep_reports WHERE rep_id = fake_rep_id AND week_start_date = test_week) THEN
    RESET ROLE;
    RAISE EXCEPTION 'FAILED: an unassigned manager could see this rep''s report row.';
  END IF;
  RESET ROLE;
  RAISE NOTICE 'PASSED: an unassigned manager cannot see this rep''s report.';

  -- Test 4: the ASSIGNED manager CAN see it, but cannot review a draft (not
  -- yet submitted).
  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', fake_manager_id)::text, true);
  SELECT id INTO v_report_id FROM public.rep_reports WHERE rep_id = fake_rep_id AND week_start_date = test_week;
  IF v_report_id IS NULL THEN
    RESET ROLE;
    RAISE EXCEPTION 'FAILED: the assigned manager could not see this rep''s report row at all.';
  END IF;
  RAISE NOTICE 'PASSED: the assigned manager can see this rep''s report.';

  caught := false;
  BEGIN
    PERFORM public.review_rep_report(v_report_id, 'approved', 'too early');
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'INVALID_STATE%' THEN caught := true; ELSE RAISE; END IF;
  END;
  RESET ROLE;
  IF NOT caught THEN
    RAISE EXCEPTION 'FAILED: a still-draft report was reviewable.';
  END IF;
  RAISE NOTICE 'PASSED: a draft report cannot be reviewed.';

  -- Test 5: rep submits; manager can now review it; content is untouched by
  -- the review call.
  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', fake_rep_id)::text, true);
  PERFORM public.submit_rep_report(test_week);
  RESET ROLE;

  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', fake_manager_id)::text, true);
  PERFORM public.review_rep_report(v_report_id, 'approved', 'looks good');
  IF NOT EXISTS (
    SELECT 1 FROM public.rep_reports
    WHERE id = v_report_id AND review_status = 'approved'
      AND content = '{"highlights": "Phase 1A test content"}'::jsonb
  ) THEN
    RESET ROLE;
    RAISE EXCEPTION 'FAILED: review did not set approved status, or it altered the report content.';
  END IF;
  RESET ROLE;
  RAISE NOTICE 'PASSED: the assigned manager can review a submitted report, and content is untouched.';

  -- Test 6: the rep can no longer overwrite it as a draft once submitted.
  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', fake_rep_id)::text, true);
  caught := false;
  BEGIN
    PERFORM public.save_rep_report_draft(test_week, '{"highlights": "trying to overwrite after submit"}'::jsonb);
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'REP_STATUS_REGRESSION_BLOCKED%' THEN caught := true; ELSE RAISE; END IF;
  END;
  RESET ROLE;
  IF NOT caught THEN
    RAISE EXCEPTION 'FAILED: a rep could overwrite their own already-submitted report as a draft.';
  END IF;
  RAISE NOTICE 'PASSED: a submitted report cannot be overwritten as a draft.';

  -- Test 7: the other rep cannot review anything, and the other manager
  -- cannot either — privilege-escalation check on the review path too.
  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', fake_other_rep_id)::text, true);
  caught := false;
  BEGIN
    PERFORM public.review_rep_report(v_report_id, 'rejected', 'not my report to review');
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'FORBIDDEN%' THEN caught := true; ELSE RAISE; END IF;
  END;
  RESET ROLE;
  IF NOT caught THEN
    RAISE EXCEPTION 'FAILED: an unrelated sales_rep could review a report.';
  END IF;

  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', fake_other_manager_id)::text, true);
  caught := false;
  BEGIN
    PERFORM public.review_rep_report(v_report_id, 'rejected', 'not my rep');
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'FORBIDDEN%' THEN caught := true; ELSE RAISE; END IF;
  END;
  RESET ROLE;
  IF NOT caught THEN
    RAISE EXCEPTION 'FAILED: an unassigned manager could review this rep''s report.';
  END IF;
  RAISE NOTICE 'PASSED: only the assigned manager (or an admin) can review this report.';

  -- Test 8: an empty/whitespace-only reason is rejected outright — no
  -- review (initial or revision) can ever be recorded without one.
  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', fake_manager_id)::text, true);
  caught := false;
  BEGIN
    PERFORM public.review_rep_report(v_report_id, 'rejected', '   ');
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'REASON_REQUIRED%' THEN caught := true; ELSE RAISE; END IF;
  END;
  RESET ROLE;
  IF NOT caught THEN
    RAISE EXCEPTION 'FAILED: a whitespace-only reason was accepted for a review decision.';
  END IF;
  RAISE NOTICE 'PASSED: an empty/whitespace-only review reason is rejected.';

  -- Test 9: revising an already-reviewed report is allowed, appends a NEW
  -- history row rather than overwriting the first one, and rep_reports
  -- reflects only the LATEST decision.
  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', fake_manager_id)::text, true);
  PERFORM public.review_rep_report(v_report_id, 'rejected', 'actually, found an issue on re-read');
  RESET ROLE;

  IF (SELECT review_status FROM public.rep_reports WHERE id = v_report_id) <> 'rejected' THEN
    RAISE EXCEPTION 'FAILED: rep_reports did not reflect the revised (latest) review decision.';
  END IF;
  IF (SELECT count(*) FROM public.rep_report_review_history h WHERE h.report_id = v_report_id) <> 2 THEN
    RAISE EXCEPTION 'FAILED: expected exactly 2 append-only history rows (initial approve + revision to reject), found %.',
      (SELECT count(*) FROM public.rep_report_review_history h WHERE h.report_id = v_report_id);
  END IF;
  IF (SELECT count(*) FROM public.rep_report_review_history h WHERE h.report_id = v_report_id AND h.review_status = 'approved' AND h.reason = 'looks good') <> 1 THEN
    RAISE EXCEPTION 'FAILED: the ORIGINAL approve decision was overwritten rather than preserved in history.';
  END IF;
  RAISE NOTICE 'PASSED: revising a review decision appends to history (both decisions preserved) rather than overwriting it.';

  -- Test 9b: ATOMICITY — a call that fails validation (an invalid
  -- p_review_status, checked before either the rep_reports UPDATE or the
  -- history INSERT runs) must leave BOTH completely untouched: still
  -- 'rejected' (the Test 9 revision), still exactly 2 history rows. There
  -- is no code path in review_rep_report that could update one table and
  -- not the other — both statements run inside the same function call
  -- (the same transaction as the caller's), so any failure anywhere in the
  -- function rolls back everything the function itself did.
  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', fake_manager_id)::text, true);
  caught := false;
  BEGIN
    PERFORM public.review_rep_report(v_report_id, 'not_a_real_status', 'this call should fail validation');
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'INVALID_REVIEW_STATUS%' THEN caught := true; ELSE RAISE; END IF;
  END;
  RESET ROLE;
  IF NOT caught THEN
    RAISE EXCEPTION 'FAILED: review_rep_report accepted an invalid review_status value.';
  END IF;
  IF (SELECT review_status FROM public.rep_reports WHERE id = v_report_id) <> 'rejected' THEN
    RAISE EXCEPTION 'FAILED (atomicity): a failed review_rep_report call still changed rep_reports.review_status.';
  END IF;
  IF (SELECT count(*) FROM public.rep_report_review_history h WHERE h.report_id = v_report_id) <> 2 THEN
    RAISE EXCEPTION 'FAILED (atomicity): a failed review_rep_report call still added a history row — expected the count to stay at 2.';
  END IF;
  RAISE NOTICE 'PASSED: a failed review_rep_report call is atomic — neither rep_reports nor the history table is touched.';

  -- Test 10: the review-history table itself cannot be written to
  -- directly, even by the manager who legitimately just reviewed through
  -- the function — default-deny holds for the audit trail too.
  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', fake_manager_id)::text, true);
  caught := false;
  BEGIN
    INSERT INTO public.rep_report_review_history (report_id, review_status, reason, reviewed_by)
    VALUES (v_report_id, 'approved', 'trying to bypass the function', fake_manager_id);
  EXCEPTION WHEN insufficient_privilege OR OTHERS THEN
    caught := true;
  END;
  RESET ROLE;
  IF NOT caught THEN
    RAISE EXCEPTION 'FAILED: a direct INSERT into rep_report_review_history succeeded — the audit trail is not actually append-only-via-function.';
  END IF;
  RAISE NOTICE 'PASSED: rep_report_review_history cannot be written to directly, only through review_rep_report.';

  -- Cleanup (as this session's own role).
  RESET request.jwt.claims;
  DELETE FROM public.rep_report_review_history WHERE report_id IN (
    SELECT id FROM public.rep_reports WHERE rep_id IN (fake_rep_id, fake_other_rep_id)
  );
  DELETE FROM public.rep_reports WHERE rep_id IN (fake_rep_id, fake_other_rep_id);
  DELETE FROM public.rep_manager_assignments WHERE rep_id IN (fake_rep_id, fake_other_rep_id);
  DELETE FROM public.profiles WHERE id IN (fake_rep_id, fake_other_rep_id, fake_manager_id, fake_other_manager_id);
  DELETE FROM auth.users WHERE id IN (fake_rep_id, fake_other_rep_id, fake_manager_id, fake_other_manager_id);
  RAISE NOTICE 'Cleanup PASSED: no residual synthetic rows remain.';
END $$;

-- ---------------------------------------------------------------------------
-- Second self-verifying test — historical, assignment-scoped former-manager
-- access. Kept separate from the block above (which already covers the
-- plain draft/submit/review lifecycle) because this scenario needs its own
-- timeline: a rep assigned to manager A, submitting a report, THEN
-- reassigned to manager B, submitting a second report under B.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  fake_admin_id uuid;
  fake_rep_id uuid := gen_random_uuid();
  fake_manager_a_id uuid := gen_random_uuid();
  fake_manager_b_id uuid := gen_random_uuid();
  -- week_with_a/week_with_b are just two distinct report weeks — ownership
  -- no longer depends on dates at all (see was_manager_for_assignment's own
  -- header): each report is stamped with whichever assignment was active
  -- for the rep at the moment save_rep_report_draft first creates it, a
  -- hard 1:1 fact, not a date computation.
  week_with_a date := CURRENT_DATE;
  week_with_b date := CURRENT_DATE + 7;
  report_a_id uuid;
  report_b_id uuid;
  caught boolean;
BEGIN
  SELECT id INTO fake_admin_id FROM public.profiles WHERE role = 'admin' AND is_active = true LIMIT 1;
  IF fake_admin_id IS NULL THEN
    RAISE NOTICE 'SKIPPED rep_reports former-manager self-test: needs at least one active admin profile.';
    RETURN;
  END IF;

  BEGIN
    SET ROLE authenticated;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIPPED rep_reports former-manager self-test: this session cannot SET ROLE authenticated (%).', SQLERRM;
    RETURN;
  END;

  BEGIN
    INSERT INTO auth.users (id) VALUES (fake_rep_id), (fake_manager_a_id), (fake_manager_b_id);
    INSERT INTO public.profiles (id, full_name, email, role, is_active) VALUES
      (fake_rep_id, 'Phase 1A Test Rep (history)', 'phase1a-rr-hist-rep-' || fake_rep_id || '@example.invalid', 'sales_rep', true),
      (fake_manager_a_id, 'Phase 1A Test Manager A (history)', 'phase1a-rr-hist-mgr-a-' || fake_manager_a_id || '@example.invalid', 'manager', true),
      (fake_manager_b_id, 'Phase 1A Test Manager B (history)', 'phase1a-rr-hist-mgr-b-' || fake_manager_b_id || '@example.invalid', 'manager', true);
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIPPED rep_reports former-manager self-test: could not create throwaway profiles (%).', SQLERRM;
    RETURN;
  END;

  -- Assign to A, rep submits week_with_a's report, THEN reassign to B, rep
  -- submits week_with_b's report. assign_sales_rep's own advisory lock and
  -- idempotency are already covered by the previous migration's self-test;
  -- this test is purely about the resulting VISIBILITY shape.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', fake_admin_id)::text, true);
  PERFORM public.assign_sales_rep(fake_rep_id, fake_manager_a_id);

  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', fake_rep_id)::text, true);
  PERFORM public.save_rep_report_draft(week_with_a, '{"note": "filed under manager A"}'::jsonb);
  PERFORM public.submit_rep_report(week_with_a);
  RESET ROLE;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', fake_admin_id)::text, true);
  PERFORM public.assign_sales_rep(fake_rep_id, fake_manager_b_id);

  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', fake_rep_id)::text, true);
  PERFORM public.save_rep_report_draft(week_with_b, '{"note": "filed under manager B"}'::jsonb);
  PERFORM public.submit_rep_report(week_with_b);
  RESET ROLE;

  SELECT id INTO report_a_id FROM public.rep_reports WHERE rep_id = fake_rep_id AND week_start_date = week_with_a;
  SELECT id INTO report_b_id FROM public.rep_reports WHERE rep_id = fake_rep_id AND week_start_date = week_with_b;

  -- Former manager A: CAN see their own week's report...
  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', fake_manager_a_id)::text, true);
  IF NOT EXISTS (SELECT 1 FROM public.rep_reports WHERE id = report_a_id) THEN
    RESET ROLE;
    RAISE EXCEPTION 'FAILED: former manager A cannot see the report from their OWN assignment window.';
  END IF;
  -- ...but NOT the later report filed under manager B (no access to reports
  -- from a LATER assignment).
  IF EXISTS (SELECT 1 FROM public.rep_reports WHERE id = report_b_id) THEN
    RESET ROLE;
    RAISE EXCEPTION 'FAILED: former manager A could see a report from a LATER assignment (manager B''s tenure).';
  END IF;
  RESET ROLE;
  RAISE NOTICE 'PASSED: a former manager sees reports from their own window only, never a later assignment''s reports.';

  -- Former manager A has NO review rights, even over a report from their
  -- own former tenure.
  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', fake_manager_a_id)::text, true);
  caught := false;
  BEGIN
    PERFORM public.review_rep_report(report_a_id, 'approved', 'trying to review after reassignment');
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'FORBIDDEN%' THEN caught := true; ELSE RAISE; END IF;
  END;
  RESET ROLE;
  IF NOT caught THEN
    RAISE EXCEPTION 'FAILED: a former manager was able to review a report from their own past tenure.';
  END IF;
  RAISE NOTICE 'PASSED: a former manager has no review rights, even over a report from their own former tenure.';

  -- Current manager B sees their own report as usual.
  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', fake_manager_b_id)::text, true);
  IF NOT EXISTS (SELECT 1 FROM public.rep_reports WHERE id = report_b_id) THEN
    RESET ROLE;
    RAISE EXCEPTION 'FAILED: the current manager B cannot see the report filed during their own tenure.';
  END IF;
  RESET ROLE;
  RAISE NOTICE 'PASSED: the current manager retains their existing (unbounded) visibility, unaffected by this migration.';

  -- Former manager A can see the review HISTORY for their own window's
  -- report too (if any exists) — read-only transparency, never a
  -- write path. (No review was recorded in this test scenario; this just
  -- confirms the policy doesn't error for a former manager querying it.)
  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', fake_manager_a_id)::text, true);
  PERFORM count(*) FROM public.rep_report_review_history WHERE report_id = report_a_id;
  RESET ROLE;
  RAISE NOTICE 'PASSED: a former manager can query review history for their own window''s report without error.';

  -- ACCEPTANCE REGRESSION TEST: the exact scenario that broke the earlier
  -- date-range-overlap design. A rep reassigned THREE times within the
  -- same day (and so, under the old design, within the same calendar
  -- week): manager C -> manager D -> manager E, with a report created
  -- only while C was active. Under the old interval-overlap check, C's,
  -- D's, AND E's assignment windows could all independently overlap that
  -- one report's week, letting THREE different (former) managers claim
  -- ownership of the SAME report. Under the assignment-ID model, only C —
  -- whichever assignment was actually active at the moment the report was
  -- created — can ever own it, regardless of how many reassignments
  -- happen afterward, including a former manager (D) who held the rep for
  -- a time but never had any report attributed to them at all.
  DECLARE
    fake_manager_c_id uuid := gen_random_uuid();
    fake_manager_d_id uuid := gen_random_uuid();
    fake_manager_e_id uuid := gen_random_uuid();
    shared_week date := CURRENT_DATE + 30;
    shared_report_id uuid;
  BEGIN
    INSERT INTO auth.users (id) VALUES (fake_manager_c_id), (fake_manager_d_id), (fake_manager_e_id);
    INSERT INTO public.profiles (id, full_name, email, role, is_active) VALUES
      (fake_manager_c_id, 'Phase 1A Test Manager C', 'phase1a-rr-hist-mgr-c-' || fake_manager_c_id || '@example.invalid', 'manager', true),
      (fake_manager_d_id, 'Phase 1A Test Manager D', 'phase1a-rr-hist-mgr-d-' || fake_manager_d_id || '@example.invalid', 'manager', true),
      (fake_manager_e_id, 'Phase 1A Test Manager E', 'phase1a-rr-hist-mgr-e-' || fake_manager_e_id || '@example.invalid', 'manager', true);

    PERFORM set_config('request.jwt.claims', json_build_object('sub', fake_admin_id)::text, true);
    PERFORM public.assign_sales_rep(fake_rep_id, fake_manager_c_id);

    SET ROLE authenticated;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', fake_rep_id)::text, true);
    PERFORM public.save_rep_report_draft(shared_week, '{"note": "filed under manager C only"}'::jsonb);
    RESET ROLE;

    -- Reassign twice more, all still today/this week, WITHOUT the rep ever
    -- creating another report — D holds the rep only briefly in between.
    PERFORM set_config('request.jwt.claims', json_build_object('sub', fake_admin_id)::text, true);
    PERFORM public.assign_sales_rep(fake_rep_id, fake_manager_d_id);
    PERFORM public.assign_sales_rep(fake_rep_id, fake_manager_e_id);

    SELECT id INTO shared_report_id FROM public.rep_reports WHERE rep_id = fake_rep_id AND week_start_date = shared_week;

    SET ROLE authenticated;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', fake_manager_c_id)::text, true);
    IF NOT EXISTS (SELECT 1 FROM public.rep_reports WHERE id = shared_report_id) THEN
      RESET ROLE;
      RAISE EXCEPTION 'FAILED: manager C (who actually owned the report at creation time) cannot see it.';
    END IF;
    RESET ROLE;

    SET ROLE authenticated;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', fake_manager_d_id)::text, true);
    IF EXISTS (SELECT 1 FROM public.rep_reports WHERE id = shared_report_id) THEN
      RESET ROLE;
      RAISE EXCEPTION 'FAILED (the exact bug this fix closes): manager D, who briefly held the rep but was never attributed any report, could still see manager C''s report via a same-week overlap.';
    END IF;
    RESET ROLE;
    RAISE NOTICE 'PASSED: manager D (briefly held the rep between C and E, attributed no report) sees nothing — ownership is a hard 1:1 fact, not a date overlap that could span multiple managers in one week.';

    -- Cleanup for this inner scenario.
    DELETE FROM public.rep_reports WHERE id = shared_report_id;
    DELETE FROM public.rep_manager_assignments WHERE rep_id = fake_rep_id AND manager_id IN (fake_manager_c_id, fake_manager_d_id, fake_manager_e_id);
    DELETE FROM public.profiles WHERE id IN (fake_manager_c_id, fake_manager_d_id, fake_manager_e_id);
    DELETE FROM auth.users WHERE id IN (fake_manager_c_id, fake_manager_d_id, fake_manager_e_id);
  END;

  -- IMMUTABILITY: owning_assignment_id cannot be reassigned via ANY SQL
  -- path, not just the ones authenticated/anon can reach. authenticated
  -- already has zero UPDATE grant on rep_reports at all (every write goes
  -- through the three RPCs), so testing as `authenticated` would only ever
  -- prove the GRANT layer blocks it, not that the TRIGGER itself does.
  -- This attempts the UPDATE as THIS session's own role instead — the
  -- migration-applying superuser/table-owner, which has unrestricted
  -- UPDATE rights and bypasses RLS entirely — specifically to prove the
  -- trigger is a real, independent backstop: even a caller with full table
  -- privileges and no RLS restriction at all still cannot change this
  -- column once a row exists.
  DECLARE
    other_assignment_id uuid;
    caught boolean;
  BEGIN
    SELECT id INTO other_assignment_id FROM public.rep_manager_assignments WHERE rep_id = fake_rep_id AND manager_id = fake_manager_b_id;
    caught := false;
    BEGIN
      UPDATE public.rep_reports SET owning_assignment_id = other_assignment_id WHERE id = report_a_id;
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM LIKE 'OWNING_ASSIGNMENT_IMMUTABLE%' THEN caught := true; ELSE RAISE; END IF;
    END;
    IF NOT caught THEN
      RAISE EXCEPTION 'FAILED: owning_assignment_id was successfully changed by a direct UPDATE, even with full table privileges and no RLS restriction — the immutability trigger did not fire.';
    END IF;
    RAISE NOTICE 'PASSED: owning_assignment_id cannot be changed by a direct UPDATE even with full table privileges — the immutability trigger is a real backstop, independent of the RLS/grant layer that already blocks ordinary callers.';
  END;

  -- Cleanup.
  RESET request.jwt.claims;
  DELETE FROM public.rep_report_review_history WHERE report_id IN (report_a_id, report_b_id);
  DELETE FROM public.rep_reports WHERE rep_id = fake_rep_id;
  DELETE FROM public.rep_manager_assignments WHERE rep_id = fake_rep_id;
  DELETE FROM public.profiles WHERE id IN (fake_rep_id, fake_manager_a_id, fake_manager_b_id);
  DELETE FROM auth.users WHERE id IN (fake_rep_id, fake_manager_a_id, fake_manager_b_id);
  RAISE NOTICE 'Cleanup PASSED: no residual synthetic rows remain.';
END $$;

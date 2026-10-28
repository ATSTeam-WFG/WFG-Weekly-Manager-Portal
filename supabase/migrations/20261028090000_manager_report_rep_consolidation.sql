-- Sales Rep flow, Phase 1C — lets a manager pull SELECTED fields from their
-- currently-assigned reps' APPROVED weekly reports into their own Weekly
-- Leadership Update, with server-rechecked authorization and a permanent,
-- traceable import record. Deliberately the smallest integration that
-- satisfies the approved requirements:
--
--   - The existing `reports` table, its columns, its triggers
--     (reports_enforce_manager_edit_cutoff — the Friday 4:00 PM deadline),
--     and every existing manager/leadership RPC are UNTOUCHED by this
--     migration. Consolidation never writes to `reports` directly — it only
--     ever hands the manager's own client code a block of text to merge
--     into their own in-memory draft, which then flows through the EXACT
--     SAME save_rep_report_draft-shaped path (saveReportV2 on the client
--     side) that already existed, so the Friday cutoff, the autosave
--     coordination, and everything else about how a manager's report is
--     persisted is completely unaffected.
--
--   - PRODUCT DECISION (flagged for owner approval, not assumed): imported
--     content lands exclusively in `other_notable_items` (a free-text,
--     uncapped field — "Anything important that does not fit above"), never
--     in whatMattersNow/lookingAroundCorner/nextWeekPriorities. Those three
--     sections are hard-capped at 3 bullets each on the client
--     (reportValidation.ts's capBullets — a plain array .slice(0, 3)) with
--     no overflow signal at all: appending imported content into an
--     already-full section would silently DROP either the manager's own
--     existing item or the newly imported one, which is exactly the
--     "silently overwrite" outcome this phase was explicitly told to avoid.
--     Routing everything into the one unbounded field sidesteps that risk
--     entirely while still satisfying every literal requirement (view,
--     select, preview, apply, edit afterward, submit normally). Structured
--     per-section placement with real overflow handling is a reasonable
--     Phase 1D enhancement, not attempted here.
--
--   - This table only RECORDS that an import happened and exactly what was
--     imported (for traceability and idempotency) — it does not itself
--     store or modify any manager report content. The actual text merge
--     into the manager's otherNotableItems happens entirely client-side,
--     the same way existing voice-dictation results are already appended
--     to that same field (see ReportForm.tsx's handleVoiceResult) — this is
--     reusing an established append pattern, not inventing a new one.
CREATE TABLE public.manager_report_rep_imports (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  manager_id           uuid NOT NULL REFERENCES public.profiles(id),
  rep_report_id        uuid NOT NULL REFERENCES public.rep_reports(id),
  -- The rep_reports.updated_at AT THE MOMENT OF IMPORT — the "version"
  -- identifier POLICY-equivalent traceability depends on. rep_reports has
  -- no content history of its own (unlike review decisions, which DO have
  -- rep_report_review_history), so if the source is edited again later,
  -- its old content becomes unrecoverable from rep_reports itself — which
  -- is exactly why imported_content (below) snapshots the selected values
  -- at import time, rather than relying on being able to re-derive them
  -- later from the live row.
  rep_report_updated_at timestamptz NOT NULL,
  week_start_date      date NOT NULL,
  -- Which of the 6 SalesRepReportSections keys were included in this
  -- specific import action (e.g. {accomplishments, pipelineUpdates}) — a
  -- manager can import a different subset later (a NEW row, not a
  -- duplicate) without that being treated as the same action twice.
  selected_fields      text[] NOT NULL CHECK (array_length(selected_fields, 1) > 0),
  -- Canonical, sorted, comma-joined form of selected_fields — exists purely
  -- so the UNIQUE constraint below has something order-independent to key
  -- on (two imports naming the same fields in a different array order must
  -- still be recognized as the same action).
  selected_fields_key  text NOT NULL,
  -- The EXACT values of the selected fields, sliced directly from
  -- rep_reports.content at import time — the durable, traceable snapshot
  -- of what was actually imported, independent of whatever the source row
  -- contains now or later.
  imported_content     jsonb NOT NULL,
  imported_at          timestamptz NOT NULL DEFAULT clock_timestamp(),
  -- Prevents a genuine double-click (or a retried request) of the SAME
  -- action (same manager, same report VERSION, same field selection) from
  -- ever recording twice — handled via INSERT ... ON CONFLICT DO NOTHING in
  -- the RPC below, not a check-then-insert (which would itself race under
  -- true concurrency). A revision of the source report changes
  -- rep_report_updated_at, and a different field selection changes
  -- selected_fields_key — either one naturally produces a NEW, distinct,
  -- legitimately-importable row rather than being blocked as a duplicate.
  UNIQUE (manager_id, rep_report_id, rep_report_updated_at, selected_fields_key)
);

COMMENT ON TABLE public.manager_report_rep_imports IS
  'Permanent audit trail of Sales Rep content a manager chose to import into their own weekly report. '
  'This is NOT proof the resulting text was ever saved into reports.other_notable_items — this table is '
  'written by import_rep_report_for_consolidation() independently of, and before, any save of the '
  'manager''s own report, which happens entirely client-side afterward through the existing manager '
  'report save path. A row here records that an import ACTION was taken and authorized; it never implies '
  'the manager''s report was successfully persisted as a result. Client code must never use a row''s '
  'existence as evidence of successful persistence — see ImportRepReportsPanel.tsx''s own '
  'currentOtherNotableItems handling, which checks the manager''s actual current report text instead.';

CREATE INDEX manager_report_rep_imports_manager_week_idx
  ON public.manager_report_rep_imports (manager_id, week_start_date);

ALTER TABLE public.manager_report_rep_imports ENABLE ROW LEVEL SECURITY;

-- Visible to the importing manager (permanently — this is a record of what
-- THEY did, independent of whether they still manage the rep in question)
-- and to admins. Reps and other managers never see another manager's
-- import records — this is an internal manager-authorship audit trail, not
-- part of the rep's own visibility surface.
CREATE POLICY manager_report_rep_imports_select_own
  ON public.manager_report_rep_imports
  FOR SELECT TO authenticated
  USING (manager_id = auth.uid());

CREATE POLICY manager_report_rep_imports_select_admin
  ON public.manager_report_rep_imports
  FOR SELECT TO authenticated
  USING (public.is_admin());

GRANT SELECT ON public.manager_report_rep_imports TO authenticated;

-- No UPDATE/DELETE grant to anyone, including via a function — nothing in
-- this migration ever updates or deletes a row here; the RPC below only
-- ever INSERTs (or, on a genuine duplicate, returns the existing row
-- unchanged). A permanent, append-only audit trail, same discipline as
-- rep_report_resubmission_events.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN
ON public.manager_report_rep_imports
FROM authenticated, anon;

REVOKE SELECT
ON public.manager_report_rep_imports
FROM anon;

-- ---------------------------------------------------------------------------
-- manager_report_edit_cutoff_passed — pure, stateless predicate mirroring
-- the manager's OWN Friday 4:00 PM America/New_York edit cutoff, the same
-- idiom (and the same literal 16:00 constant EDIT_CUTOFF_HOUR/MINUTE in
-- src/lib/managerEditLock.ts) already proven by
-- reports_enforce_manager_edit_cutoff() — added here as a standalone,
-- independently callable function (that trigger's own logic lives inside a
-- BEFORE INSERT/UPDATE trigger body with its own NEW/OLD/admin-exemption
-- semantics specific to writing a `reports` row, and is intentionally left
-- completely untouched) because import_rep_report_for_consolidation, below,
-- needs the SAME fact — "has this manager's own edit window for this week
-- already closed" — without writing to `reports` at all.
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
  SELECT p_now >= ((p_week_start_date + 4 + time '16:00') AT TIME ZONE 'America/New_York');
$$;

REVOKE ALL ON FUNCTION public.manager_report_edit_cutoff_passed(date, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.manager_report_edit_cutoff_passed(date, timestamptz) FROM anon;
GRANT EXECUTE ON FUNCTION public.manager_report_edit_cutoff_passed(date, timestamptz) TO authenticated;

-- ---------------------------------------------------------------------------
-- import_rep_report_for_consolidation — manager-only. Re-verifies, entirely
-- server-side (never trusting that the UI only showed eligible reports):
--   1. caller is an active manager;
--   2. the MANAGER'S OWN Friday 4:00 PM edit window for this week has not
--      already closed — otherwise this would permanently record an import
--      "ledger" entry for a report the manager can never actually save or
--      submit again, a misleading record of an action with no way to ever
--      take effect. Checked before anything else, so a closed window
--      refuses the action regardless of which rep report was targeted.
--   3. the target rep report is status='submitted' AND review_status=
--      'approved' — a draft, a pending, or a REJECTED report can never be
--      imported, regardless of what a crafted client request claims;
--   4. the caller is the rep's CURRENTLY assigned manager (is_assigned_
--      manager_of — the same current-assignment-only check review_rep_report
--      uses; a FORMER manager's read-only historical access never extends to
--      importing into their own current report);
--   5. the rep report's own week_start_date matches the manager's own
--      p_week_start_date (same-week matching — defense in depth: nothing in
--      today's UI lets a manager edit any week but their current one, but
--      this is independently enforced here rather than merely assumed).
-- Idempotent and concurrency-safe via INSERT ... ON CONFLICT DO NOTHING on
-- the table's own UNIQUE constraint, never a separate check-then-insert.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.import_rep_report_for_consolidation(
  p_rep_report_id uuid,
  p_week_start_date date,
  p_selected_fields text[]
)
RETURNS public.manager_report_rep_imports
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_role text;
  v_active boolean;
  v_rep_report public.rep_reports;
  v_fields_key text;
  v_imported_content jsonb;
  v_result public.manager_report_rep_imports;
BEGIN
  SELECT role, is_active INTO v_role, v_active FROM public.profiles WHERE id = v_caller;
  IF v_role IS DISTINCT FROM 'manager' OR v_active IS NOT TRUE THEN
    RAISE EXCEPTION 'FORBIDDEN: Only an active manager may import a sales rep report into their own weekly report.';
  END IF;

  IF public.manager_report_edit_cutoff_passed(p_week_start_date) THEN
    RAISE EXCEPTION 'MANAGER_EDIT_LOCKED: Your own report edit window for this week has closed — this content can no longer be added to it.';
  END IF;

  IF p_selected_fields IS NULL OR array_length(p_selected_fields, 1) IS NULL THEN
    RAISE EXCEPTION 'NO_FIELDS_SELECTED: At least one field must be selected to import.';
  END IF;

  SELECT * INTO v_rep_report FROM public.rep_reports WHERE id = p_rep_report_id;
  IF v_rep_report IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: No such sales rep report.';
  END IF;

  IF v_rep_report.status <> 'submitted' OR v_rep_report.review_status <> 'approved' THEN
    RAISE EXCEPTION 'NOT_APPROVED: Only an approved, submitted sales rep report can be imported into a manager report.';
  END IF;

  IF NOT public.is_assigned_manager_of(v_rep_report.rep_id) THEN
    RAISE EXCEPTION 'FORBIDDEN: You are not the currently assigned manager for this sales rep.';
  END IF;

  IF v_rep_report.week_start_date <> p_week_start_date THEN
    RAISE EXCEPTION 'WEEK_MISMATCH: This sales rep report is for a different reporting week than the one being edited.';
  END IF;

  SELECT string_agg(f, ',' ORDER BY f) INTO v_fields_key FROM unnest(p_selected_fields) AS f;

  SELECT jsonb_object_agg(kv.key, kv.value) INTO v_imported_content
  FROM jsonb_each(v_rep_report.content) AS kv
  WHERE kv.key = ANY(p_selected_fields);

  INSERT INTO public.manager_report_rep_imports
    (manager_id, rep_report_id, rep_report_updated_at, week_start_date, selected_fields, selected_fields_key, imported_content)
  VALUES
    (v_caller, p_rep_report_id, v_rep_report.updated_at, p_week_start_date, p_selected_fields, v_fields_key, COALESCE(v_imported_content, '{}'::jsonb))
  ON CONFLICT (manager_id, rep_report_id, rep_report_updated_at, selected_fields_key) DO NOTHING
  RETURNING * INTO v_result;

  IF v_result IS NULL THEN
    SELECT * INTO v_result FROM public.manager_report_rep_imports
    WHERE manager_id = v_caller
      AND rep_report_id = p_rep_report_id
      AND rep_report_updated_at = v_rep_report.updated_at
      AND selected_fields_key = v_fields_key;
  END IF;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.import_rep_report_for_consolidation(uuid, date, text[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.import_rep_report_for_consolidation(uuid, date, text[]) FROM anon;
GRANT EXECUTE ON FUNCTION public.import_rep_report_for_consolidation(uuid, date, text[]) TO authenticated;

-- ---------------------------------------------------------------------------
-- Self-test: approved-only, current-assignment-only (former/other manager
-- denied), same-week matching, idempotent double-click, a distinct field
-- selection and a genuine source revision each producing a legitimately
-- separate importable row, content-snapshot fidelity, and the table's own
-- default-deny write grants.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  fake_admin_id uuid;
  fake_rep_id uuid := gen_random_uuid();
  fake_manager_a_id uuid := gen_random_uuid();
  fake_manager_b_id uuid := gen_random_uuid();
  test_week date := '2026-12-07';
  v_report_id uuid;
  v_import_id uuid;
  caught boolean;
BEGIN
  SELECT id INTO fake_admin_id FROM public.profiles WHERE role = 'admin' AND is_active = true LIMIT 1;
  IF fake_admin_id IS NULL THEN
    RAISE NOTICE 'SKIPPED manager_report_rep_consolidation self-test: needs at least one active admin profile.';
    RETURN;
  END IF;

  BEGIN
    SET ROLE authenticated;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIPPED manager_report_rep_consolidation self-test: this session cannot SET ROLE authenticated (%).', SQLERRM;
    RETURN;
  END;

  BEGIN
    INSERT INTO auth.users (id) VALUES (fake_rep_id), (fake_manager_a_id), (fake_manager_b_id);
    INSERT INTO public.profiles (id, full_name, email, role, is_active) VALUES
      (fake_rep_id, 'Phase 1C Test Rep', 'phase1c-rep-' || fake_rep_id || '@example.invalid', 'sales_rep', true),
      (fake_manager_a_id, 'Phase 1C Test Manager A', 'phase1c-mgr-a-' || fake_manager_a_id || '@example.invalid', 'manager', true),
      (fake_manager_b_id, 'Phase 1C Test Manager B', 'phase1c-mgr-b-' || fake_manager_b_id || '@example.invalid', 'manager', true);
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIPPED manager_report_rep_consolidation self-test: could not create throwaway profiles (%).', SQLERRM;
    RETURN;
  END;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', fake_admin_id)::text, true);
  PERFORM public.assign_sales_rep(fake_rep_id, fake_manager_a_id);

  -- A draft (not yet submitted) can never be imported.
  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', fake_rep_id)::text, true);
  PERFORM public.save_rep_report_draft(
    test_week,
    '{"accomplishments": ["Closed 3 deals"], "salesMetrics": ["$50k booked"], "pipelineUpdates": ["2 new leads"], "blockers": ["Waiting on legal"], "nextWeekPriorities": ["Follow up with ACME"], "managerSupportNeeded": "Need pricing approval"}'::jsonb
  );
  RESET ROLE;
  SELECT id INTO v_report_id FROM public.rep_reports WHERE rep_id = fake_rep_id AND week_start_date = test_week;

  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', fake_manager_a_id)::text, true);
  caught := false;
  BEGIN
    PERFORM public.import_rep_report_for_consolidation(v_report_id, test_week, ARRAY['accomplishments']);
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'NOT_APPROVED%' THEN caught := true; ELSE RAISE; END IF;
  END;
  RESET ROLE;
  IF NOT caught THEN
    RAISE EXCEPTION 'FAILED: a draft (unsubmitted) sales rep report was importable.';
  END IF;

  -- Submitted but still pending review — still not importable.
  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', fake_rep_id)::text, true);
  PERFORM public.submit_rep_report(test_week);
  RESET ROLE;

  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', fake_manager_a_id)::text, true);
  caught := false;
  BEGIN
    PERFORM public.import_rep_report_for_consolidation(v_report_id, test_week, ARRAY['accomplishments']);
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'NOT_APPROVED%' THEN caught := true; ELSE RAISE; END IF;
  END;
  RESET ROLE;
  IF NOT caught THEN
    RAISE EXCEPTION 'FAILED: a submitted-but-still-pending sales rep report was importable.';
  END IF;

  -- Rejected — still not importable.
  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', fake_manager_a_id)::text, true);
  PERFORM public.review_rep_report(v_report_id, 'rejected', 'needs more detail');
  caught := false;
  BEGIN
    PERFORM public.import_rep_report_for_consolidation(v_report_id, test_week, ARRAY['accomplishments']);
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'NOT_APPROVED%' THEN caught := true; ELSE RAISE; END IF;
  END;
  RESET ROLE;
  IF NOT caught THEN
    RAISE EXCEPTION 'FAILED: a REJECTED sales rep report was importable.';
  END IF;
  RAISE NOTICE 'PASSED: a draft, a pending, and a rejected sales rep report are all refused — only approved, submitted reports can be imported.';

  -- Approve it — only now does it become importable.
  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', fake_manager_a_id)::text, true);
  PERFORM public.review_rep_report(v_report_id, 'approved', 'looks good now');
  RESET ROLE;

  -- A different manager (never assigned to this rep at all) is refused.
  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', fake_manager_b_id)::text, true);
  caught := false;
  BEGIN
    PERFORM public.import_rep_report_for_consolidation(v_report_id, test_week, ARRAY['accomplishments']);
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'FORBIDDEN%' THEN caught := true; ELSE RAISE; END IF;
  END;
  RESET ROLE;
  IF NOT caught THEN
    RAISE EXCEPTION 'FAILED: an unrelated manager (never assigned to this rep) could import their approved report.';
  END IF;

  -- Same-week matching: the correct manager, but claiming the wrong week.
  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', fake_manager_a_id)::text, true);
  caught := false;
  BEGIN
    PERFORM public.import_rep_report_for_consolidation(v_report_id, test_week + 7, ARRAY['accomplishments']);
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'WEEK_MISMATCH%' THEN caught := true; ELSE RAISE; END IF;
  END;
  RESET ROLE;
  IF NOT caught THEN
    RAISE EXCEPTION 'FAILED: importing against a week that does not match the rep report''s own week_start_date was allowed.';
  END IF;
  RAISE NOTICE 'PASSED: same-week matching and current-assignment authorization are both enforced server-side, independent of any UI filtering.';

  -- The real import, by the correctly assigned manager, matching week.
  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', fake_manager_a_id)::text, true);
  PERFORM public.import_rep_report_for_consolidation(v_report_id, test_week, ARRAY['accomplishments', 'salesMetrics']);
  RESET ROLE;
  SELECT id INTO v_import_id FROM public.manager_report_rep_imports
  WHERE manager_id = fake_manager_a_id AND rep_report_id = v_report_id;
  IF v_import_id IS NULL THEN
    RAISE EXCEPTION 'FAILED: a legitimate import by the assigned manager of an approved report did not record.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.manager_report_rep_imports
    WHERE id = v_import_id
      AND imported_content = '{"accomplishments": ["Closed 3 deals"], "salesMetrics": ["$50k booked"]}'::jsonb
  ) THEN
    RAISE EXCEPTION 'FAILED: imported_content did not faithfully snapshot exactly the selected fields'' values.';
  END IF;
  RAISE NOTICE 'PASSED: a legitimate import records a faithful snapshot of exactly the selected fields'' values.';

  -- Test list "repeat import/idempotency": clicking Apply again with the
  -- EXACT SAME selection must not create a second row.
  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', fake_manager_a_id)::text, true);
  PERFORM public.import_rep_report_for_consolidation(v_report_id, test_week, ARRAY['accomplishments', 'salesMetrics']);
  PERFORM public.import_rep_report_for_consolidation(v_report_id, test_week, ARRAY['salesMetrics', 'accomplishments']); -- same fields, different array order
  RESET ROLE;
  IF (SELECT count(*) FROM public.manager_report_rep_imports WHERE manager_id = fake_manager_a_id AND rep_report_id = v_report_id) <> 1 THEN
    RAISE EXCEPTION 'FAILED: re-importing the identical selection (even in a different array order) created a duplicate row — expected exactly 1, found %.',
      (SELECT count(*) FROM public.manager_report_rep_imports WHERE manager_id = fake_manager_a_id AND rep_report_id = v_report_id);
  END IF;
  RAISE NOTICE 'PASSED: re-importing the exact same report version + field selection (a double-click) is idempotent — no duplicate row, regardless of selection array order.';

  -- A DIFFERENT field selection on the SAME still-unrevised report is a
  -- legitimately separate, additional import, not a blocked duplicate.
  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', fake_manager_a_id)::text, true);
  PERFORM public.import_rep_report_for_consolidation(v_report_id, test_week, ARRAY['blockers']);
  RESET ROLE;
  IF (SELECT count(*) FROM public.manager_report_rep_imports WHERE manager_id = fake_manager_a_id AND rep_report_id = v_report_id) <> 2 THEN
    RAISE EXCEPTION 'FAILED: importing a DIFFERENT field selection from the same report was blocked as a duplicate instead of recorded separately.';
  END IF;
  RAISE NOTICE 'PASSED: a different field selection from the same report version is a separate, legitimate import, not a blocked duplicate.';

  -- Test list "source revision after import": the rep revises their
  -- (still-approved... no, revising requires going through rejection first
  -- per Phase 1B's own rules, so simulate a realistic revision cycle) report
  -- after it was imported — rejected, corrected, resubmitted, re-approved —
  -- and prove the EARLIER import record is untouched (still points at the
  -- OLD version/content) while a fresh import now captures the NEW content
  -- as its own additional row.
  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', fake_manager_a_id)::text, true);
  PERFORM public.review_rep_report(v_report_id, 'rejected', 'one more correction needed');
  RESET ROLE;

  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', fake_rep_id)::text, true);
  PERFORM public.save_rep_report_draft(test_week, '{"accomplishments": ["Closed 5 deals (revised)"], "salesMetrics": ["$80k booked"], "pipelineUpdates": ["2 new leads"], "blockers": ["Waiting on legal"], "nextWeekPriorities": ["Follow up with ACME"], "managerSupportNeeded": "Need pricing approval"}'::jsonb);
  PERFORM public.resubmit_rejected_rep_report(test_week);
  RESET ROLE;

  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', fake_manager_a_id)::text, true);
  PERFORM public.review_rep_report(v_report_id, 'approved', 'revised numbers look right');
  RESET ROLE;

  -- This entire self-test runs as ONE transaction (a single anonymous code
  -- block is one statement), so now() — used for rep_reports.updated_at throughout
  -- save_rep_report_draft/submit_rep_report/resubmit_rejected_rep_report/
  -- review_rep_report — is frozen at this transaction's own start for its
  -- whole duration, regardless of how many of those calls run above. In
  -- real usage this is a non-issue (each RPC call from the client is its
  -- own separate transaction with its own fresh now()), but it means this
  -- self-test cannot observe a genuinely later updated_at purely by calling
  -- the real functions in sequence. A direct, explicitly-labeled test-only
  -- bump simulates the real-world elapsed time a second, separate
  -- transaction would naturally have produced, so the assertion below is
  -- testing the IMPORT function's own version-comparison logic (the thing
  -- actually new to Phase 1C), not re-litigating the already-established
  -- now()-vs-clock_timestamp() distinction this project has fixed once
  -- before (see 20261027140200_rep_manager_assignments.sql).
  UPDATE public.rep_reports SET updated_at = updated_at + interval '1 second' WHERE id = v_report_id;

  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', fake_manager_a_id)::text, true);
  PERFORM public.import_rep_report_for_consolidation(v_report_id, test_week, ARRAY['accomplishments', 'salesMetrics']);
  RESET ROLE;

  IF NOT EXISTS (
    SELECT 1 FROM public.manager_report_rep_imports
    WHERE id = v_import_id AND imported_content = '{"accomplishments": ["Closed 3 deals"], "salesMetrics": ["$50k booked"]}'::jsonb
  ) THEN
    RAISE EXCEPTION 'FAILED: the ORIGINAL import record was altered after the source report was later revised — traceability to the original version was lost.';
  END IF;
  IF (SELECT count(*) FROM public.manager_report_rep_imports WHERE manager_id = fake_manager_a_id AND rep_report_id = v_report_id AND selected_fields_key = 'accomplishments,salesMetrics') <> 2 THEN
    RAISE EXCEPTION 'FAILED: expected exactly 2 rows for the accomplishments+salesMetrics selection (pre-revision and post-revision versions) — the revision did not produce a legitimately new, separate import.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.manager_report_rep_imports
    WHERE manager_id = fake_manager_a_id AND rep_report_id = v_report_id
      AND selected_fields_key = 'accomplishments,salesMetrics'
      AND imported_content = '{"accomplishments": ["Closed 5 deals (revised)"], "salesMetrics": ["$80k booked"]}'::jsonb
  ) THEN
    RAISE EXCEPTION 'FAILED: re-importing after a genuine source revision did not capture the NEW content.';
  END IF;
  RAISE NOTICE 'PASSED: after the source rep report is revised (rejected, corrected, resubmitted, re-approved), the EARLIER import record is untouched (still traces to the original content) and a fresh import captures the new content as its own additional row.';

  -- MANAGER'S OWN FRIDAY 4:00 PM EDIT CUTOFF: the import RPC must refuse to
  -- create a ledger record for a week whose own manager-report edit window
  -- has already closed — otherwise it would permanently record an import
  -- action that can never actually be reflected in a report the manager can
  -- no longer save. Uses a PAST week (manager cutoff has long since passed)
  -- distinct from test_week (future) used everywhere else in this file. The
  -- rep-side submit/approve mechanics are deliberately bypassed via a direct
  -- UPDATE (as this session's own privileged role) since the REP's own
  -- Friday 2:00 PM cutoff is not what this test is about.
  DECLARE
    past_manager_week date := '2026-01-05';
    past_week_report_id uuid;
  BEGIN
    SET ROLE authenticated;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', fake_rep_id)::text, true);
    PERFORM public.save_rep_report_draft(past_manager_week, '{"accomplishments": ["Old week accomplishment"]}'::jsonb);
    RESET ROLE;

    SELECT id INTO past_week_report_id FROM public.rep_reports WHERE rep_id = fake_rep_id AND week_start_date = past_manager_week;

    UPDATE public.rep_reports
    SET status = 'submitted', submission_source = 'manual',
        submitted_at = clock_timestamp(), first_submitted_at = clock_timestamp(),
        review_status = 'approved', reviewed_by = fake_manager_a_id, reviewed_at = clock_timestamp()
    WHERE id = past_week_report_id;

    SET ROLE authenticated;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', fake_manager_a_id)::text, true);
    caught := false;
    BEGIN
      PERFORM public.import_rep_report_for_consolidation(past_week_report_id, past_manager_week, ARRAY['accomplishments']);
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM LIKE 'MANAGER_EDIT_LOCKED%' THEN caught := true; ELSE RAISE; END IF;
    END;
    RESET ROLE;
    IF NOT caught THEN
      RAISE EXCEPTION 'FAILED: importing was allowed for a week whose manager edit cutoff has already passed — a misleading, unusable ledger record could be created.';
    END IF;
    IF EXISTS (SELECT 1 FROM public.manager_report_rep_imports WHERE rep_report_id = past_week_report_id) THEN
      RAISE EXCEPTION 'FAILED: a ledger row was recorded despite the manager edit cutoff check refusing the import.';
    END IF;
    RAISE NOTICE 'PASSED: the import RPC refuses to create a ledger record once the manager''s OWN Friday 4:00 PM edit window for that week has closed, even for an otherwise fully valid, approved, correctly-assigned rep report.';

    DELETE FROM public.rep_reports WHERE id = past_week_report_id;
  END;

  -- Former manager: reassign the rep, confirm manager A (now former) can no
  -- longer import, even though the report is still approved and they can
  -- still read it historically.
  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', fake_admin_id)::text, true);
  PERFORM public.assign_sales_rep(fake_rep_id, fake_manager_b_id);
  RESET ROLE;

  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', fake_manager_a_id)::text, true);
  caught := false;
  BEGIN
    PERFORM public.import_rep_report_for_consolidation(v_report_id, test_week, ARRAY['nextWeekPriorities']);
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'FORBIDDEN%' THEN caught := true; ELSE RAISE; END IF;
  END;
  -- Confirm they can still READ it historically — the denial above is
  -- specifically about importing, not about visibility.
  IF NOT EXISTS (SELECT 1 FROM public.rep_reports WHERE id = v_report_id) THEN
    RESET ROLE;
    RAISE EXCEPTION 'FAILED: the former manager lost read access entirely, which is a DIFFERENT (pre-existing, Phase 1A) guarantee this test also depends on.';
  END IF;
  RESET ROLE;
  IF NOT caught THEN
    RAISE EXCEPTION 'FAILED: a FORMER manager (reassigned away) could still import from a report they can only read historically — current-assignment rules were not respected.';
  END IF;
  RAISE NOTICE 'PASSED: a former manager retains historical read access but cannot import — current assignment, not historical access, gates consolidation.';

  -- No direct write to the table is possible, even by a sales_rep or manager.
  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', fake_manager_b_id)::text, true);
  caught := false;
  BEGIN
    INSERT INTO public.manager_report_rep_imports
      (manager_id, rep_report_id, rep_report_updated_at, week_start_date, selected_fields, selected_fields_key, imported_content)
    VALUES (fake_manager_b_id, v_report_id, now(), test_week, ARRAY['blockers'], 'blockers', '{}'::jsonb);
  EXCEPTION WHEN insufficient_privilege OR OTHERS THEN
    caught := true;
  END;
  RESET ROLE;
  IF NOT caught THEN
    RAISE EXCEPTION 'FAILED: a direct INSERT into manager_report_rep_imports succeeded — writes must go exclusively through import_rep_report_for_consolidation.';
  END IF;
  RAISE NOTICE 'PASSED: manager_report_rep_imports cannot be written to directly by anyone, including the currently assigned manager — only the RPC may write to it.';

  -- Cleanup.
  RESET request.jwt.claims;
  DELETE FROM public.manager_report_rep_imports WHERE manager_id IN (fake_manager_a_id, fake_manager_b_id);
  DELETE FROM public.rep_report_review_history WHERE report_id = v_report_id;
  DELETE FROM public.rep_report_resubmission_events WHERE report_id = v_report_id;
  DELETE FROM public.rep_reports WHERE rep_id = fake_rep_id;
  DELETE FROM public.rep_manager_assignments WHERE rep_id = fake_rep_id;
  DELETE FROM public.profiles WHERE id IN (fake_rep_id, fake_manager_a_id, fake_manager_b_id);
  DELETE FROM auth.users WHERE id IN (fake_rep_id, fake_manager_a_id, fake_manager_b_id);
  RAISE NOTICE 'Cleanup PASSED: no residual synthetic rows remain.';
END $$;

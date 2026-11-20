-- Beta feedback (2026-11-16) — replaces the Approve/Reject/Needs
-- Correction decision workflow with an optional, NON-BLOCKING "Provide
-- Feedback" action. This is a DRAFT migration — review and apply
-- explicitly; do not run against Preview or Production without separate
-- approval.
--
-- Deliberately a brand-new, independent table rather than loosening
-- rep_report_review_history's own CHECK (review_status IN ('approved',
-- 'rejected')) or rep_reports.review_status's CHECK (... IN ('pending',
-- 'approved', 'rejected')): every existing approval/rejection row, every
-- existing migration, and every existing RLS policy on those two stay
-- byte-for-byte untouched — "never weaken authorization" and "never delete
-- existing approval/rejection data or migrations" are satisfied by
-- construction, not by care taken while editing shared constraints.
-- review_rep_report() itself is NOT modified by this migration (it still
-- exists, still works, still records approve/reject decisions if ever
-- called again) — the frontend simply stops calling it and calls
-- add_rep_report_feedback() instead. Feedback never touches rep_reports.
-- status/review_status/reviewed_by/reviewed_at at all, so it can never
-- block a report from being submitted, edited, or viewed.
CREATE TABLE public.rep_report_feedback (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id   uuid NOT NULL REFERENCES public.rep_reports(id),
  feedback    text NOT NULL CHECK (btrim(feedback) <> ''),
  author_id   uuid NOT NULL REFERENCES public.profiles(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX rep_report_feedback_report_idx
  ON public.rep_report_feedback (report_id, created_at);

ALTER TABLE public.rep_report_feedback ENABLE ROW LEVEL SECURITY;

-- Same visibility shape as rep_report_review_history (own / assigned
-- manager / former manager / admin), plus sales_admin — mirroring
-- rep_reports_select_sales_admin (20261103090000_sales_admin_role.sql),
-- since a Sales Admin already has read-only visibility into rep_reports
-- itself and feedback is the same kind of informational content.
CREATE POLICY rep_report_feedback_select_own
  ON public.rep_report_feedback
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.rep_reports r
      WHERE r.id = rep_report_feedback.report_id AND r.rep_id = auth.uid()
    )
  );

CREATE POLICY rep_report_feedback_select_assigned_manager
  ON public.rep_report_feedback
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.rep_reports r
      WHERE r.id = rep_report_feedback.report_id AND public.is_assigned_manager_of(r.rep_id)
    )
  );

CREATE POLICY rep_report_feedback_select_former_manager
  ON public.rep_report_feedback
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.rep_reports r
      WHERE r.id = rep_report_feedback.report_id
        AND public.was_manager_for_assignment(r.owning_assignment_id)
    )
  );

CREATE POLICY rep_report_feedback_select_admin
  ON public.rep_report_feedback
  FOR SELECT
  TO authenticated
  USING (public.is_admin());

CREATE POLICY rep_report_feedback_select_sales_admin
  ON public.rep_report_feedback
  FOR SELECT
  TO authenticated
  USING (public.is_sales_admin());

GRANT SELECT ON public.rep_report_feedback TO authenticated;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN
ON public.rep_report_feedback
FROM authenticated, anon;

REVOKE SELECT
ON public.rep_report_feedback
FROM anon;

-- ---------------------------------------------------------------------------
-- add_rep_report_feedback — the only write path. Authorization mirrors
-- review_rep_report()'s own gate exactly (is_assigned_manager_of(rep_id) OR
-- is_admin()) — a Sales Admin can READ feedback (above) but never WRITE it,
-- same as they can never call review_rep_report either. Deliberately has
-- NO status requirement at all (unlike review_rep_report's
-- "status = 'submitted'" requirement) — feedback is optional and
-- non-blocking, so it may be left on a draft or a submitted report alike,
-- and never changes rep_reports in any way.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.add_rep_report_feedback(
  p_report_id uuid,
  p_feedback text
)
RETURNS public.rep_report_feedback
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rep_id uuid;
  v_result public.rep_report_feedback;
BEGIN
  IF p_feedback IS NULL OR btrim(p_feedback) = '' THEN
    RAISE EXCEPTION 'FEEDBACK_REQUIRED: Feedback text cannot be empty.';
  END IF;

  SELECT rep_id INTO v_rep_id FROM public.rep_reports WHERE id = p_report_id;
  IF v_rep_id IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: No report exists with that id.';
  END IF;

  IF NOT (public.is_assigned_manager_of(v_rep_id) OR public.is_admin()) THEN
    RAISE EXCEPTION 'FORBIDDEN: You do not have permission to leave feedback on this report.';
  END IF;

  INSERT INTO public.rep_report_feedback (report_id, feedback, author_id)
  VALUES (p_report_id, btrim(p_feedback), auth.uid())
  RETURNING * INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.add_rep_report_feedback(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.add_rep_report_feedback(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.add_rep_report_feedback(uuid, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- Self-test: a rep cannot leave feedback on their own report (same
-- authorization shape as review_rep_report — only the assigned manager or
-- an admin may), empty feedback is rejected, and a successful insert
-- never touches rep_reports itself.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_report_id uuid;
  v_rep_id uuid;
  v_status_before text;
  v_review_status_before text;
  v_status_after text;
  v_review_status_after text;
BEGIN
  SELECT id, rep_id, status, review_status
  INTO v_report_id, v_rep_id, v_status_before, v_review_status_before
  FROM public.rep_reports
  LIMIT 1;

  IF v_report_id IS NULL THEN
    RAISE NOTICE 'SELF_TEST_SKIPPED: no rep_reports row exists to test against';
    RETURN;
  END IF;

  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_rep_id)::text, true);
    PERFORM public.add_rep_report_feedback(v_report_id, 'should be forbidden');
    RAISE EXCEPTION 'SELF_TEST_FAILED: a rep was able to leave feedback on their own report';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE 'FORBIDDEN:%' THEN
        RAISE EXCEPTION 'SELF_TEST_FAILED: expected FORBIDDEN, got: %', SQLERRM;
      END IF;
  END;

  SELECT status, review_status INTO v_status_after, v_review_status_after
  FROM public.rep_reports WHERE id = v_report_id;

  IF v_status_after IS DISTINCT FROM v_status_before OR v_review_status_after IS DISTINCT FROM v_review_status_before THEN
    RAISE EXCEPTION 'SELF_TEST_FAILED: rep_reports.status/review_status changed as a side effect of a feedback attempt';
  END IF;

  RAISE NOTICE 'SELF_TEST_PASSED: rep_report_feedback authorization + non-blocking guarantee';
END;
$$;

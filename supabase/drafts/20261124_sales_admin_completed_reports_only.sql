-- Reporting hierarchy & access phase (2026-11-24, continued) — restrict
-- Sales Admin's existing rep_reports access to SUBMITTED reports only,
-- while preserving the existing report-status monitoring (missing /
-- draft / submitted / completion-rate) that Sales Admin's own dashboards
-- already depend on. DRAFT — not applied to Preview or Production.
--
-- Background: rep_reports_select_sales_admin (20261103090000) was built,
-- deliberately, to give Sales Admin unconditional read access to every
-- report, draft included — approved at the time. Shannon has since asked
-- specifically for "all completed Sales Rep reports" for Gene/Joey; this
-- migration narrows Sales Admin's EXISTING role to match that going
-- forward (a real behavior change, not a bug fix — see the final report
-- for the explicit flag this raises).
--
-- This is a role-level change (every Sales Admin, not only Joey's
-- account) — Sales Admin's other responsibilities (Sales Rep account
-- management, assignment, monitoring who has/hasn't submitted) are
-- completely untouched.
--
-- 1. Tighten rep_reports_select_sales_admin to submitted-only. A direct
--    `select * from rep_reports` as a Sales Admin can now never return a
--    draft row's content, from the UI, an alternate RPC, a report export,
--    or a raw PostgREST/database request — enforced once, at the RLS
--    layer, not per call site.
DROP POLICY IF EXISTS rep_reports_select_sales_admin ON public.rep_reports;
CREATE POLICY rep_reports_select_sales_admin
  ON public.rep_reports
  FOR SELECT
  TO authenticated
  USING (public.is_sales_admin() AND status = 'submitted');

-- 2. sales_admin_rep_report_status(p_week_start_date) — the narrowly
--    scoped, metadata-only path the existing status/completion-rate
--    calculations need now that the policy above hides draft rows
--    entirely. Returns rep_id/status/submitted_at for EVERY report that
--    week, including drafts — but its RETURNS TABLE shape has no content
--    column at all, so a draft's narrative text can never come back
--    through this function regardless of what it's asked for. Available
--    to is_admin() too (a strict superset of what is_admin() can already
--    see via rep_reports_select_admin directly) purely so a single
--    status-only client call can be shared by both dashboards without an
--    extra role branch in application code.
CREATE OR REPLACE FUNCTION public.sales_admin_rep_report_status(p_week_start_date date)
RETURNS TABLE (rep_id uuid, status text, submitted_at timestamptz)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (public.is_admin() OR public.is_sales_admin()) THEN
    RAISE EXCEPTION 'FORBIDDEN: Only an admin or sales admin may read report status.';
  END IF;

  RETURN QUERY
  SELECT r.rep_id, r.status, r.submitted_at
  FROM public.rep_reports r
  WHERE r.week_start_date = p_week_start_date;
END;
$$;

REVOKE ALL ON FUNCTION public.sales_admin_rep_report_status(date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sales_admin_rep_report_status(date) FROM anon;
GRANT EXECUTE ON FUNCTION public.sales_admin_rep_report_status(date) TO authenticated;

-- ---------------------------------------------------------------------------
-- Self-test — a Sales Admin sees status for EVERY rep (including a
-- draft's status, never its content) via the new function, but the
-- direct table policy now hides the draft row completely.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_admin_caller uuid := gen_random_uuid();
  v_sales_admin uuid := gen_random_uuid();
  v_rep_draft uuid := gen_random_uuid();
  v_rep_submitted uuid := gen_random_uuid();
  v_week date := '2099-02-02';
  v_count int;
  v_draft_status text;
BEGIN
  INSERT INTO auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  SELECT x.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', x.id::text || '@salesadmincontenttest.invalid', '{}'::jsonb, '{}'::jsonb, now(), now()
  FROM (VALUES (v_admin_caller), (v_sales_admin), (v_rep_draft), (v_rep_submitted)) AS x(id);

  INSERT INTO public.profiles (id, full_name, email, role, is_active, submits_weekly_report)
  VALUES
    (v_sales_admin, 'Content-Test Sales Admin', v_sales_admin::text || '@salesadmincontenttest.invalid', 'sales_admin', true, false),
    (v_rep_draft, 'Content-Test Rep Draft', v_rep_draft::text || '@salesadmincontenttest.invalid', 'sales_rep', true, false),
    (v_rep_submitted, 'Content-Test Rep Submitted', v_rep_submitted::text || '@salesadmincontenttest.invalid', 'sales_rep', true, false);

  INSERT INTO public.rep_reports (rep_id, week_start_date, status, content)
  VALUES (v_rep_draft, v_week, 'draft', '{"accomplishments": ["SECRET draft narrative"]}'::jsonb);
  INSERT INTO public.rep_reports (rep_id, week_start_date, status, submission_source, submitted_at, first_submitted_at, content)
  VALUES (v_rep_submitted, v_week, 'submitted', 'manual', now(), now(), '{"accomplishments": ["Public submitted narrative"]}'::jsonb);

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_sales_admin)::text, true);
  SET LOCAL ROLE authenticated;

  -- Direct table access: only the submitted row, never the draft.
  SELECT count(*) INTO v_count FROM public.rep_reports WHERE week_start_date = v_week;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'SELF_TEST_FAILED: Sales Admin direct table access expected exactly 1 row (submitted only), got %', v_count;
  END IF;

  -- Metadata-only RPC: both rows, status visible, draft content never
  -- returned because the function's own return shape has no content
  -- column to return it through.
  SELECT count(*) INTO v_count FROM public.sales_admin_rep_report_status(v_week);
  IF v_count <> 2 THEN
    RAISE EXCEPTION 'SELF_TEST_FAILED: sales_admin_rep_report_status expected 2 rows (both reps), got %', v_count;
  END IF;

  SELECT status INTO v_draft_status FROM public.sales_admin_rep_report_status(v_week) WHERE rep_id = v_rep_draft;
  IF v_draft_status IS DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION 'SELF_TEST_FAILED: expected the draft rep''s status to read ''draft'', got %', v_draft_status;
  END IF;
  RESET ROLE;

  RAISE NOTICE 'SELF_TEST_PASSED: Sales Admin sees both reps'' status (including the draft''s) via the metadata-only function, but only the submitted row''s content through direct table access';

  -- A non-admin, non-sales-admin caller gets FORBIDDEN from the function
  -- outright (not merely zero rows) — the exception itself proves the
  -- authorization check runs, not just that RLS later filtered it to
  -- nothing.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_rep_draft)::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.sales_admin_rep_report_status(v_week);
    RAISE EXCEPTION 'SELF_TEST_FAILED: a plain Sales Rep caller was not forbidden from sales_admin_rep_report_status';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE 'FORBIDDEN:%' THEN
        RAISE EXCEPTION 'SELF_TEST_FAILED: expected FORBIDDEN, got: %', SQLERRM;
      END IF;
  END;
  RESET ROLE;
  RAISE NOTICE 'SELF_TEST_PASSED: a plain Sales Rep is forbidden from the status RPC entirely';

  DELETE FROM public.rep_reports WHERE week_start_date = v_week AND rep_id IN (v_rep_draft, v_rep_submitted);
  DELETE FROM public.profiles WHERE id IN (v_admin_caller, v_sales_admin, v_rep_draft, v_rep_submitted);
  DELETE FROM auth.users WHERE id IN (v_admin_caller, v_sales_admin, v_rep_draft, v_rep_submitted);
  RAISE NOTICE 'SELF_TEST_PASSED: cleanup complete, no residual test data';
END;
$$;

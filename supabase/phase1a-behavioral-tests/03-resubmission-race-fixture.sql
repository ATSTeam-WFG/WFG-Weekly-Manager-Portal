-- NOT a migration — creates one synthetic rep + one synthetic manager with
-- an ALREADY-LATE, rejected report and EXACTLY ONE unused late-submission
-- exception, for run.sh to fire two CONCURRENT resubmit_rejected_rep_report
-- calls against — a true overlapping-transaction race for the single
-- exception row, which a single serial DO $$ block cannot produce.
--
-- The report is constructed directly (not via the real submit_rep_report,
-- which always stamps the real current time) as already late — its own
-- first_submitted_at is set past its own week's Friday 2:00 PM Eastern
-- cutoff — specifically so POLICY 1's on-time exemption does NOT apply and
-- a fresh exception is strictly required for the resubmission this race
-- exercises. This mirrors the exact same direct-construction technique the
-- main migration's own self-test already uses for its on-time-exemption
-- scenario (there, on-time; here, deliberately late).
INSERT INTO auth.users (id) VALUES
  ('d0000000-0000-0000-0000-00000000000a'),
  ('d0000000-0000-0000-0000-00000000000b')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (id, full_name, email, role, is_active) VALUES
  ('d0000000-0000-0000-0000-00000000000a', 'Resubmission Race Rep', 'phase1b-resub-race-rep@example.invalid', 'sales_rep', true),
  ('d0000000-0000-0000-0000-00000000000b', 'Resubmission Race Manager', 'phase1b-resub-race-mgr@example.invalid', 'manager', true)
ON CONFLICT (id) DO NOTHING;

DO $$
DECLARE
  v_report_id uuid;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', 'a0000000-0000-0000-0000-000000000002')::text, true);
  PERFORM public.assign_sales_rep('d0000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-00000000000b');

  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', 'd0000000-0000-0000-0000-00000000000a')::text, true);
  PERFORM public.save_rep_report_draft('2026-02-02', '{"note": "race test"}'::jsonb);
  RESET ROLE;

  SELECT id INTO v_report_id FROM public.rep_reports
  WHERE rep_id = 'd0000000-0000-0000-0000-00000000000a' AND week_start_date = '2026-02-02';

  UPDATE public.rep_reports
  SET status = 'submitted',
      submission_source = 'manual',
      submitted_at = clock_timestamp(),
      first_submitted_at = clock_timestamp(),
      review_status = 'rejected',
      reviewed_by = 'd0000000-0000-0000-0000-00000000000b',
      reviewed_at = clock_timestamp()
  WHERE id = v_report_id;

  INSERT INTO public.rep_report_review_history (report_id, review_status, reason, reviewed_by)
  VALUES (v_report_id, 'rejected', 'race test setup', 'd0000000-0000-0000-0000-00000000000b');

  -- Exactly ONE unused exception — the entire point of this race.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', 'a0000000-0000-0000-0000-000000000002')::text, true);
  PERFORM public.grant_rep_report_late_submission_exception(
    'd0000000-0000-0000-0000-00000000000a', '2026-02-02', 'one-time correction window for the race test'
  );
END $$;

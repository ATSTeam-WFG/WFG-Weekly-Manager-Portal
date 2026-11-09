-- NOT a migration — the statement two independent, concurrently-run psql
-- processes (see run.sh) each execute, racing to resubmit the SAME rejected
-- report — both competing for the SAME single unused late-submission
-- exception row set up by 03-resubmission-race-fixture.sql.
--
-- set_config's third argument is `false` (session-scoped), same reasoning
-- as the existing assign_sales_rep race-call.sql: this file's statements
-- each run as their own autocommitted top-level transaction under psql.
SET ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub', 'd0000000-0000-0000-0000-00000000000a')::text, false);
SELECT public.resubmit_rejected_rep_report('2026-02-02');

-- NOT a migration — the statements two independent, concurrently-run psql
-- processes (see run.sh) each execute, racing to assign the SAME synthetic
-- rep (created by 02-concurrency-race.sql) to a DIFFERENT manager (the
-- target manager id is passed in as the :manager_id psql variable).
--
-- SET ROLE authenticated: this must be a real, non-bypassing role for the
-- advisory lock + RLS to mean anything, same discipline as every other
-- behavioral assertion in this test suite.
--
-- set_config's third argument is `false` (SESSION-scoped), deliberately
-- NOT `true` (transaction-scoped): psql runs each of these top-level
-- statements as its own separate, autocommitted implicit transaction (this
-- file is not wrapped in one explicit BEGIN/COMMIT, unlike the DO $$ blocks
-- elsewhere in this test suite, where every statement already shares the
-- block's own single transaction and `true` is the right, tighter scope).
-- A transaction-scoped value set here would revert before the final SELECT
-- ever ran, making auth.uid() resolve to NULL again.
SET ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub', 'a0000000-0000-0000-0000-000000000002')::text, false);
SELECT public.assign_sales_rep('c0000000-0000-0000-0000-00000000000a', :'manager_id'::uuid);

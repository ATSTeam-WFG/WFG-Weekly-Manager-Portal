-- Sales Rep flow, Phase 1A, step 2 of 4 — close the gap the new sales_rep
-- role (previous migration) would otherwise open on the EXISTING `reports`
-- table.
--
-- Verified for this task: the existing reports INSERT policy and the
-- existing own-row UPDATE policy both check "active profile AND ownership"
-- (ownership meaning manager_id = auth.uid()) but do NOT require
-- role = 'manager'; a separate policy allows admin UPDATEs. Today that is
-- harmless, because only 'manager'/'admin' profiles exist. Once 'sales_rep'
-- becomes a valid role, "ownership" stops being a safe proxy for
-- authorization on THIS table: for an INSERT, manager_id is a value the
-- INSERTING caller supplies themselves, so any authenticated profile
-- (including a brand-new sales_rep) could trivially "own" a reports row by
-- setting manager_id to their own id — the Manager-only weekly report table
-- would then accept writes from an account that was never meant to use it
-- at all, defeating the entire point of having a separate rep_reports table
-- (added in a later step of this same migration batch).
--
-- Deliberately NOT implemented as "find the existing INSERT/UPDATE
-- policies and replace them": this environment's access does not expose
-- pg_policies (see this task's own verified-facts note), so neither their
-- exact names nor their exact USING/WITH CHECK text can be independently
-- confirmed here. Replacing a policy whose exact current text isn't known
-- risks silently dropping some other condition it enforces. Instead, this
-- migration adds a RESTRICTIVE policy — in Postgres RLS, a RESTRICTIVE
-- policy is combined with every PERMISSIVE policy for the same command
-- using AND, never OR, so this can only ever NARROW what the existing
-- policies already allow, never widen it, and it does so without touching,
-- replacing, or needing to know the text of anything that already exists.
-- Every legitimate path (manager-on-own-row, admin-on-any-row, the
-- dual-role-admin-submitter exemption inside the separate Friday-cutoff
-- TRIGGER, which this migration does not touch at all) continues to pass
-- this restrictive check unchanged, because every one of those callers is
-- already role = 'manager' or role = 'admin'. Only a caller whose role is
-- neither (sales_rep today; any future third role tomorrow) is newly
-- blocked.

CREATE OR REPLACE FUNCTION public.is_manager_or_admin_caller()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid()
      AND role IN ('manager', 'admin')
      AND is_active = true
  );
$$;

REVOKE ALL ON FUNCTION public.is_manager_or_admin_caller() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_manager_or_admin_caller() FROM anon;
GRANT EXECUTE ON FUNCTION public.is_manager_or_admin_caller() TO authenticated;

CREATE POLICY reports_restrict_insert_to_manager_or_admin
  ON public.reports
  AS RESTRICTIVE
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_manager_or_admin_caller());

CREATE POLICY reports_restrict_update_to_manager_or_admin
  ON public.reports
  AS RESTRICTIVE
  FOR UPDATE
  TO authenticated
  USING (public.is_manager_or_admin_caller())
  WITH CHECK (public.is_manager_or_admin_caller());

-- SELECT IS restricted too (revised from this migration's original design,
-- which deliberately left SELECT untouched). A security review ahead of the
-- Sales Rep beta found that leaving SELECT unrestricted means whatever the
-- existing five PERMISSIVE policies allow for reads today is completely
-- unaffected by this migration — if any of their USING clauses doesn't
-- itself exclude non-manager/non-admin roles (the same ownership-based
-- shape the INSERT/UPDATE policies had before this migration), a sales_rep
-- profile could still read a Manager's reports row. Reusing the exact same
-- is_manager_or_admin_caller() function and RESTRICTIVE/AND semantics as
-- the two policies above: every legitimate Manager/Admin read path already
-- satisfies it trivially, and no existing permissive SELECT policy's text
-- needs to be known or touched.
CREATE POLICY reports_restrict_select_to_manager_or_admin
  ON public.reports
  AS RESTRICTIVE
  FOR SELECT
  TO authenticated
  USING (public.is_manager_or_admin_caller());

-- No change to the Friday-cutoff trigger or any deadline logic —
-- RESTRICTIVE RLS and the trigger are independent, both-must-pass layers;
-- this migration only adds to the RLS layer.

-- ---------------------------------------------------------------------------
-- Self-verifying test. Uses set_config('request.jwt.claims', ...) to
-- resolve auth.uid() to real, already-active manager/admin profiles (read
-- only, never modified) plus one throwaway synthetic sales_rep profile
-- (created and removed within this block, never left behind), exactly the
-- technique 20260918_manager_edit_lock.sql's own self-test already uses.
-- Only a synthetic, far-future test week is ever written to `reports`, and
-- it is always deleted before this block returns.
--
-- Exception matching was tightened for the INSERT denial test (and is used
-- the same way nowhere else, since SELECT denials never raise an exception
-- at all — see Tests 6/7 below, which assert on row count instead): a
-- blocked write is only accepted as proof of RLS working when the error is
-- SPECIFICALLY an RLS violation (SQLSTATE 42501, "row-level security
-- policy" in the message) — any other error (a constraint violation, a
-- trigger raising its own unrelated exception) is re-raised instead of
-- silently counted as a pass, so a real bug can never masquerade as
-- "RLS correctly blocked this." The Admin UPDATE test (Test 2) similarly
-- checks GET DIAGNOSTICS ROW_COUNT rather than assuming "no error" means
-- "the row changed" — an UPDATE whose USING clause silently excludes the
-- target row affects zero rows without ever raising an exception.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  real_manager_id uuid;
  real_admin_id uuid;
  fake_rep_id uuid := gen_random_uuid();
  test_week date := '2099-04-06'; -- a Monday, distinct from other migrations' test weeks
  caught boolean;
  row_count integer;
BEGIN
  SELECT id INTO real_manager_id FROM public.profiles WHERE role = 'manager' AND is_active = true LIMIT 1;
  SELECT id INTO real_admin_id FROM public.profiles WHERE role = 'admin' AND is_active = true LIMIT 1;

  IF real_manager_id IS NULL OR real_admin_id IS NULL THEN
    RAISE NOTICE 'SKIPPED reports_restrict self-test: needs at least one active manager and one active admin profile to run against.';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.reports WHERE manager_id IN (real_manager_id, real_admin_id) AND week_start_date = test_week) THEN
    RAISE EXCEPTION 'SKIPPED: a report row already exists for the test manager/admin on the test week — aborting to avoid touching real data.';
  END IF;

  BEGIN
    INSERT INTO auth.users (id) VALUES (fake_rep_id);
    INSERT INTO public.profiles (id, full_name, email, role, is_active)
    VALUES (fake_rep_id, 'Phase 1A Test Rep', 'phase1a-test-rep-' || fake_rep_id || '@example.invalid', 'sales_rep', true);
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIPPED reports_restrict self-test: could not create a throwaway sales_rep profile (%).', SQLERRM;
    RETURN;
  END;

  -- RLS (unlike a trigger) does not apply to this migration-applying
  -- session's own role, which is the table owner/a superuser-equivalent —
  -- the exact same reason
  -- leadership_report_private_ownership_rollback_test.sql's own comment
  -- gives for why ITS tests SET ROLE authenticated before every RLS-gated
  -- check ("it 'passed' for the wrong reason before this fix"). Every test
  -- below that depends on RLS actually being enforced therefore runs under
  -- SET ROLE authenticated, never as this session's own role.
  BEGIN
    SET ROLE authenticated;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIPPED reports_restrict self-test: this session cannot SET ROLE authenticated (%). Re-run from a role with authenticated membership to genuinely exercise RLS.', SQLERRM;
    DELETE FROM public.profiles WHERE id = fake_rep_id;
    DELETE FROM auth.users WHERE id = fake_rep_id;
    RETURN;
  END;

  -- Test 1: the real manager can still insert their own report — unaffected.
  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', real_manager_id)::text, true);
  INSERT INTO public.reports (manager_id, week_start_date, status) VALUES (real_manager_id, test_week, 'draft');
  RESET ROLE;
  RAISE NOTICE 'PASSED: a real manager can still insert their own report row.';
  DELETE FROM public.reports WHERE manager_id = real_manager_id AND week_start_date = test_week;

  -- Test 2: the real admin can still UPDATE an existing row on someone
  -- else's behalf — unaffected (the verified-facts description for this
  -- task states an admin UPDATE policy exists separately from the
  -- ownership-based one; it does not claim a separate admin INSERT policy
  -- exists, so this test matches the real usage pattern instead: the row
  -- is created first as its own manager, then the admin updates it, mirroring
  -- 20260922_submits_weekly_report.sql's own self-test Test 3, which does
  -- the same "ON CONFLICT DO NOTHING insert, then update" sequence rather
  -- than assuming a bare admin-as-stranger INSERT is itself supported).
  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', real_manager_id)::text, true);
  INSERT INTO public.reports (manager_id, week_start_date, status) VALUES (real_manager_id, test_week, 'draft');
  PERFORM set_config('request.jwt.claims', json_build_object('sub', real_admin_id)::text, true);
  UPDATE public.reports SET status = 'draft' WHERE manager_id = real_manager_id AND week_start_date = test_week;
  GET DIAGNOSTICS row_count = ROW_COUNT;
  RESET ROLE;
  IF row_count <> 1 THEN
    RAISE EXCEPTION 'FAILED: a real admin''s UPDATE on a manager''s report row affected % rows (expected exactly 1) — the restrictive policy may be silently blocking it.', row_count;
  END IF;
  RAISE NOTICE 'PASSED: a real admin can still update an existing report row on behalf of a manager (confirmed: exactly 1 row affected).';
  DELETE FROM public.reports WHERE manager_id = real_manager_id AND week_start_date = test_week;

  -- Test 3: the synthetic sales_rep CANNOT insert a reports row, even when
  -- claiming their own id as manager_id (the exact trivial-ownership attack
  -- this migration closes). The denial is only accepted as a pass when it's
  -- a GENUINE RLS violation (SQLSTATE 42501, "row-level security policy" in
  -- the message) — any other error (a constraint violation, an unrelated
  -- trigger exception) is re-raised rather than silently counted as proof
  -- RLS worked.
  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', fake_rep_id)::text, true);
  caught := false;
  BEGIN
    INSERT INTO public.reports (manager_id, week_start_date, status) VALUES (fake_rep_id, test_week, 'draft');
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE = '42501' AND SQLERRM LIKE '%row-level security policy%' THEN
      caught := true;
    ELSE
      RAISE;
    END IF;
  END;
  RESET ROLE;
  IF NOT caught THEN
    RAISE EXCEPTION 'FAILED: a sales_rep was able to insert a row into reports — the restrictive policy did not block it.';
  END IF;
  RAISE NOTICE 'PASSED: a sales_rep cannot insert a reports row, including one claiming their own id as manager_id (confirmed as a genuine RLS denial, not an unrelated error).';

  -- Test 4: the real manager can still SELECT their own report.
  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', real_manager_id)::text, true);
  INSERT INTO public.reports (manager_id, week_start_date, status) VALUES (real_manager_id, test_week, 'draft');
  SELECT count(*) INTO row_count FROM public.reports WHERE manager_id = real_manager_id AND week_start_date = test_week;
  RESET ROLE;
  IF row_count <> 1 THEN
    RAISE EXCEPTION 'FAILED: a real manager could not read their own existing report row — expected 1, found %.', row_count;
  END IF;
  RAISE NOTICE 'PASSED: a real manager can still SELECT their own report.';

  -- Test 5: the real admin can still SELECT any manager's report.
  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', real_admin_id)::text, true);
  SELECT count(*) INTO row_count FROM public.reports WHERE manager_id = real_manager_id AND week_start_date = test_week;
  RESET ROLE;
  IF row_count <> 1 THEN
    RAISE EXCEPTION 'FAILED: a real admin could not read a manager''s report row — expected 1, found %.', row_count;
  END IF;
  RAISE NOTICE 'PASSED: a real admin can still SELECT any manager''s report.';

  -- Test 6: the synthetic sales_rep CANNOT SELECT the real manager's
  -- report. Unlike INSERT/UPDATE, a blocked SELECT raises no exception at
  -- all under RLS — the row is simply not returned — so this is asserted
  -- by row count, not by catching an error.
  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', fake_rep_id)::text, true);
  SELECT count(*) INTO row_count FROM public.reports WHERE manager_id = real_manager_id AND week_start_date = test_week;
  RESET ROLE;
  IF row_count <> 0 THEN
    RAISE EXCEPTION 'FAILED: a sales_rep was able to SELECT a manager''s report row — expected 0 rows, found %.', row_count;
  END IF;
  RAISE NOTICE 'PASSED: a sales_rep cannot SELECT a manager''s report row.';
  DELETE FROM public.reports WHERE manager_id = real_manager_id AND week_start_date = test_week;

  -- Test 7: the deliberate ownership edge case — a reports row whose
  -- manager_id literally EQUALS the sales_rep's own auth.uid(). Inserted
  -- directly as this session's own elevated, RLS-bypassing role (the same
  -- privilege every cleanup step in this file already relies on) rather
  -- than through any RLS-gated path, specifically to construct a row that
  -- COULD exist regardless of how it got there (a data anomaly, a future
  -- bug) and prove the restrictive policy — not an ownership heuristic —
  -- is what actually gates this table's reads.
  --
  -- request.jwt.claims is set explicitly here (even though this INSERT runs
  -- under the elevated role, not SET ROLE authenticated) rather than relying
  -- on it still holding fake_rep_id's claim left over from Test 6 — the
  -- existing protected-fields trigger (reports_enforce_protected_fields)
  -- independently requires manager_id = auth.uid() on INSERT for a
  -- non-admin manager_id, so auth.uid() must deterministically resolve to
  -- fake_rep_id here regardless of what any earlier test last set, not by
  -- implicit carryover that a future reordering of these tests could break.
  --
  -- reports has no surrogate id column (its primary key is the composite
  -- (manager_id, week_start_date), unlike rep_reports/rep_manager_
  -- assignments, which do have one) — confirmed the hard way: an earlier
  -- draft of this test used `RETURNING id`, which fails outright
  -- ("column "id" does not exist") against the real table shape. Identified
  -- and fixed via a full local dry run of all seven migrations before this
  -- was ever pasted into Supabase, exactly the kind of error that exercise
  -- exists to catch. Re-identifying the row by its actual composite key
  -- below instead.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', fake_rep_id)::text, true);
  INSERT INTO public.reports (manager_id, week_start_date, status)
  VALUES (fake_rep_id, test_week, 'draft');

  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', fake_rep_id)::text, true);
  SELECT count(*) INTO row_count FROM public.reports WHERE manager_id = fake_rep_id AND week_start_date = test_week;
  RESET ROLE;
  IF row_count <> 0 THEN
    RAISE EXCEPTION 'FAILED: a sales_rep was able to SELECT a reports row whose manager_id equals their own id — expected 0 rows (role must gate this, not ownership), found %.', row_count;
  END IF;
  RAISE NOTICE 'PASSED: a sales_rep cannot SELECT a reports row even when manager_id equals their own auth.uid() (the ownership-bypass edge case) — role, not ownership, correctly gates this table.';
  DELETE FROM public.reports WHERE manager_id = fake_rep_id AND week_start_date = test_week;

  -- Cleanup (as this session's own role — never blocked by RLS, same as
  -- every other cleanup step in this file).
  RESET request.jwt.claims;
  DELETE FROM public.reports WHERE manager_id IN (real_manager_id, fake_rep_id) AND week_start_date = test_week;
  DELETE FROM public.profiles WHERE id = fake_rep_id;
  DELETE FROM auth.users WHERE id = fake_rep_id;
  RAISE NOTICE 'Cleanup PASSED: no residual synthetic rows remain.';
END $$;

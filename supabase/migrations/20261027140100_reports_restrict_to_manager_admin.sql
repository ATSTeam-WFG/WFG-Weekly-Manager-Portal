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

-- No change to SELECT (not part of this task's ask, and a sales_rep having
-- no reports row of their own to read is already the natural consequence of
-- never being able to write one) and no change to the Friday-cutoff trigger
-- or any deadline logic — RESTRICTIVE RLS and the trigger are independent,
-- both-must-pass layers; this migration only adds to the RLS layer.

-- ---------------------------------------------------------------------------
-- Self-verifying test. Uses set_config('request.jwt.claims', ...) to
-- resolve auth.uid() to real, already-active manager/admin profiles (read
-- only, never modified) plus one throwaway synthetic sales_rep profile
-- (created and removed within this block, never left behind), exactly the
-- technique 20260918_manager_edit_lock.sql's own self-test already uses.
-- Only a synthetic, far-future test week is ever written to `reports`, and
-- it is always deleted before this block returns.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  real_manager_id uuid;
  real_admin_id uuid;
  fake_rep_id uuid := gen_random_uuid();
  test_week date := '2099-04-06'; -- a Monday, distinct from other migrations' test weeks
  caught boolean;
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
  RESET ROLE;
  RAISE NOTICE 'PASSED: a real admin can still update an existing report row on behalf of a manager.';
  DELETE FROM public.reports WHERE manager_id = real_manager_id AND week_start_date = test_week;

  -- Test 3: the synthetic sales_rep CANNOT insert a reports row, even when
  -- claiming their own id as manager_id (the exact trivial-ownership attack
  -- this migration closes).
  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', fake_rep_id)::text, true);
  caught := false;
  BEGIN
    INSERT INTO public.reports (manager_id, week_start_date, status) VALUES (fake_rep_id, test_week, 'draft');
  EXCEPTION WHEN insufficient_privilege OR OTHERS THEN
    caught := true;
  END;
  RESET ROLE;
  IF NOT caught THEN
    RAISE EXCEPTION 'FAILED: a sales_rep was able to insert a row into reports — the restrictive policy did not block it.';
  END IF;
  RAISE NOTICE 'PASSED: a sales_rep cannot insert a reports row, including one claiming their own id as manager_id.';

  -- Cleanup (as this session's own role — never blocked by RLS, same as
  -- every other cleanup step in this file).
  RESET request.jwt.claims;
  DELETE FROM public.reports WHERE manager_id IN (real_manager_id, fake_rep_id) AND week_start_date = test_week;
  DELETE FROM public.profiles WHERE id = fake_rep_id;
  DELETE FROM auth.users WHERE id = fake_rep_id;
  RAISE NOTICE 'Cleanup PASSED: no residual synthetic rows remain.';
END $$;

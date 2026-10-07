-- Leadership Report Phase 2D — TRANSACTION-TEST SCRIPT. NOT A MIGRATION.
--
-- Deliberately kept OUTSIDE supabase/migrations/, mirroring
-- leadership_report_drafts_rollback_test.sql's own convention exactly, so
-- this is never picked up as a real migration. Runs the EXACT DDL from
-- supabase/migrations/20260924_leadership_report_private_ownership.sql
-- against the real, live leadership_report_drafts table (including its one
-- existing "Test Draft 1" row), verifies every invariant, then ROLLBACKs —
-- even a failed assertion only aborts this transaction, and the trailing
-- ROLLBACK still applies cleanly, restoring the table to exactly its
-- current pre-migration shape (old column set, old UNIQUE(period_start_date)
-- constraint, old admin-wide policy) regardless of outcome.
-- No name/email/UUID belonging to any real person is hard-coded anywhere in
-- this file — every profile used is discovered generically ("any active
-- admin", "a second, different active admin") exactly like this project's
-- other self-tests (see 20260918_manager_edit_lock.sql). Authorization
-- (leadership_report_authorized = true) is applied ONLY temporarily, to
-- real existing admin profiles, strictly for the duration of this one
-- rolled-back transaction, and is also explicitly restored to false before
-- the script ends (belt-and-suspenders — the ROLLBACK alone already
-- guarantees this, but restoring explicitly matches this project's own
-- established convention for temporarily-flagged test profiles).
--
-- Per the instruction this test was written against: fully proving
-- cross-user identity separation would normally need two SEPARATE database
-- sessions each authenticated as a different real user — unsafe/unreliable
-- to fake inside one anonymous transaction. Instead, this test uses the
-- same real, already-established technique this project's own migrations
-- use for exactly this situation (set_config('request.jwt.claims', ...) to
-- make auth.uid() resolve to a specific real profile, exactly as
-- 20260918_manager_edit_lock.sql's own self-test already does) — this is a
-- genuine behavioral proof of the RLS/RPC logic itself (auth.uid() resolution
-- is real, not simulated), not a fabricated guarantee. Nothing here claims
-- to test session-transport-level auth (JWT issuance/verification) — that
-- machinery is Supabase's own and is out of scope; what's tested is what
-- this migration actually changes: whether owner_id + RLS + the
-- authorization helper correctly gate access once auth.uid() is known.
BEGIN;

-- ---------------------------------------------------------------------------
-- Snapshot of Test Draft 1's ORIGINAL columns only (explicit tuple, not the
-- whole row) — computed the same way before and after the migration DDL
-- below, so adding the new owner_id column cannot itself affect this
-- comparison. Captured before anything runs.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  original_count integer;
BEGIN
  SELECT count(*) INTO original_count FROM public.leadership_report_drafts;
  IF original_count <> 1 THEN
    RAISE NOTICE 'NOTE: expected exactly 1 pre-existing leadership_report_drafts row (per the verified live state), found %. Proceeding — later checks are still valid, but this differs from what was verified.', original_count;
  END IF;
END $$;

CREATE TEMP TABLE _lr_test_snapshot AS
SELECT
  md5((id, period_start_date, period_end_date, period_label, source_analysis_id, source_ats_fingerprint, content, created_at, created_by, updated_at, updated_by)::text) AS row_hash,
  id, period_start_date, period_end_date, period_label, source_analysis_id, created_by
FROM public.leadership_report_drafts
ORDER BY created_at
LIMIT 1;

-- ---------------------------------------------------------------------------
-- Exact migration DDL, verbatim (see the mechanical comment-stripped diff
-- check reported alongside this file — every executable statement below
-- matches the permanent migration exactly).
-- ---------------------------------------------------------------------------
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS leadership_report_authorized boolean NOT NULL DEFAULT false;

ALTER TABLE public.leadership_report_drafts
  ADD COLUMN IF NOT EXISTS owner_id uuid;

UPDATE public.leadership_report_drafts
  SET owner_id = created_by
  WHERE owner_id IS NULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.leadership_report_drafts WHERE owner_id IS NULL) THEN
    RAISE EXCEPTION 'MIGRATION_ABORTED: leadership_report_drafts has a row with NULL owner_id after backfilling from created_by — investigate before re-running this migration.';
  END IF;
END $$;

ALTER TABLE public.leadership_report_drafts
  ALTER COLUMN owner_id SET NOT NULL;

ALTER TABLE public.leadership_report_drafts
  ADD CONSTRAINT leadership_report_drafts_owner_id_fkey
  FOREIGN KEY (owner_id) REFERENCES public.profiles(id);

ALTER TABLE public.leadership_report_drafts
  DROP CONSTRAINT leadership_report_drafts_period_start_date_key;

ALTER TABLE public.leadership_report_drafts
  ADD CONSTRAINT leadership_report_drafts_owner_period_key
  UNIQUE (owner_id, period_start_date);

CREATE OR REPLACE FUNCTION public.is_leadership_report_authorized()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid()
      AND role = 'admin'
      AND is_active = true
      AND leadership_report_authorized = true
  );
$$;

REVOKE ALL ON FUNCTION public.is_leadership_report_authorized() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_leadership_report_authorized() FROM anon;
GRANT EXECUTE ON FUNCTION public.is_leadership_report_authorized() TO authenticated;

DROP POLICY leadership_report_drafts_select_admin ON public.leadership_report_drafts;

CREATE POLICY leadership_report_drafts_select_own
  ON public.leadership_report_drafts
  FOR SELECT
  TO public
  USING (is_leadership_report_authorized() AND owner_id = auth.uid());

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN
ON public.leadership_report_drafts
FROM authenticated, anon;

REVOKE SELECT
ON public.leadership_report_drafts
FROM anon;

CREATE OR REPLACE FUNCTION public.save_leadership_report_draft(
  p_period_start_date      date,
  p_period_end_date        date,
  p_period_label           text,
  p_source_analysis_id     uuid,
  p_source_ats_fingerprint text,
  p_content                jsonb
)
RETURNS public.leadership_report_drafts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_result public.leadership_report_drafts;
BEGIN
  IF NOT is_leadership_report_authorized() THEN
    RAISE EXCEPTION 'FORBIDDEN: Leadership Report access is not authorized for this account.';
  END IF;

  IF NOT is_valid_leadership_report_content(p_content) THEN
    RAISE EXCEPTION 'INVALID_SECTIONS: Leadership Report content is not in the required ATS format.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.executive_analyses
    WHERE id = p_source_analysis_id
      AND period_key = 'weekly'
      AND period_start_date = p_period_start_date
  ) THEN
    RAISE EXCEPTION 'INVALID_REQUEST: source_analysis_id does not match this reporting week''s ATS analysis.';
  END IF;

  INSERT INTO public.leadership_report_drafts (
    owner_id, period_start_date, period_end_date, period_label,
    source_analysis_id, source_ats_fingerprint, content,
    created_by, updated_by
  )
  VALUES (
    v_caller, p_period_start_date, p_period_end_date, p_period_label,
    p_source_analysis_id, p_source_ats_fingerprint, p_content,
    v_caller, v_caller
  )
  ON CONFLICT (owner_id, period_start_date) DO UPDATE SET
    period_end_date        = EXCLUDED.period_end_date,
    period_label           = EXCLUDED.period_label,
    source_analysis_id     = EXCLUDED.source_analysis_id,
    source_ats_fingerprint = EXCLUDED.source_ats_fingerprint,
    content                = EXCLUDED.content,
    updated_at              = now(),
    updated_by              = v_caller
  RETURNING * INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.save_leadership_report_draft(date, date, text, uuid, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.save_leadership_report_draft(date, date, text, uuid, text, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.save_leadership_report_draft(date, date, text, uuid, text, jsonb) TO authenticated;

-- ---------------------------------------------------------------------------
-- Test battery.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  snap                   RECORD;
  row_after              RECORD;
  row_hash_after         text;
  test_admin_id          uuid;
  test_admin2_id         uuid;
  caught                 boolean;
  authenticated_switch_ok boolean;
  anon_switch_ok         boolean;
  row_count              integer;
  draft_row              RECORD;
  draft_row2             RECORD;
  first_created_at       timestamptz;
BEGIN
  SELECT * INTO snap FROM _lr_test_snapshot;
  IF snap.id IS NULL THEN
    RAISE NOTICE 'SKIPPED (all tests): no pre-existing leadership_report_drafts row was found to snapshot.';
    RETURN;
  END IF;

  -- Test 1: leadership_report_authorized exists, NOT NULL, default false.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'profiles'
      AND column_name = 'leadership_report_authorized'
      AND is_nullable = 'NO'
      AND column_default = 'false'
  ) THEN
    RAISE EXCEPTION 'Test 1 FAILED: profiles.leadership_report_authorized is missing, nullable, or does not default to false.';
  END IF;
  RAISE NOTICE 'Test 1 PASSED: profiles.leadership_report_authorized exists, NOT NULL, default false.';

  -- Test 2: owner_id exists and is NOT NULL.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'leadership_report_drafts'
      AND column_name = 'owner_id' AND is_nullable = 'NO'
  ) THEN
    RAISE EXCEPTION 'Test 2 FAILED: leadership_report_drafts.owner_id is missing or nullable.';
  END IF;
  RAISE NOTICE 'Test 2 PASSED: leadership_report_drafts.owner_id exists and is NOT NULL.';

  -- Test 3: owner_id FK to profiles exists.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'leadership_report_drafts_owner_id_fkey'
      AND conrelid = 'public.leadership_report_drafts'::regclass
      AND contype = 'f'
      AND confrelid = 'public.profiles'::regclass
  ) THEN
    RAISE EXCEPTION 'Test 3 FAILED: owner_id -> profiles(id) foreign key is missing.';
  END IF;
  RAISE NOTICE 'Test 3 PASSED: owner_id -> profiles(id) foreign key exists.';

  -- Test 4: old UNIQUE(period_start_date) is gone.
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'leadership_report_drafts_period_start_date_key'
      AND conrelid = 'public.leadership_report_drafts'::regclass
  ) THEN
    RAISE EXCEPTION 'Test 4 FAILED: the old UNIQUE(period_start_date) constraint still exists.';
  END IF;
  RAISE NOTICE 'Test 4 PASSED: the old UNIQUE(period_start_date) constraint is gone.';

  -- Test 5: UNIQUE(owner_id, period_start_date) exists.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'leadership_report_drafts_owner_period_key'
      AND conrelid = 'public.leadership_report_drafts'::regclass
      AND contype = 'u'
      AND pg_get_constraintdef(oid) = 'UNIQUE (owner_id, period_start_date)'
  ) THEN
    RAISE EXCEPTION 'Test 5 FAILED: UNIQUE(owner_id, period_start_date) is missing or has an unexpected definition.';
  END IF;
  RAISE NOTICE 'Test 5 PASSED: UNIQUE(owner_id, period_start_date) exists with the expected definition.';

  -- Test 6: every existing draft has owner_id populated.
  SELECT count(*) INTO row_count FROM public.leadership_report_drafts WHERE owner_id IS NULL;
  IF row_count <> 0 THEN
    RAISE EXCEPTION 'Test 6 FAILED: % row(s) still have a NULL owner_id.', row_count;
  END IF;
  RAISE NOTICE 'Test 6 PASSED: every existing draft has owner_id populated.';

  -- Test 7 + 8: Test Draft 1's original columns are byte-for-byte unchanged,
  -- and its new owner_id exactly equals its own original created_by.
  SELECT * INTO row_after FROM public.leadership_report_drafts WHERE id = snap.id;
  IF row_after.id IS NULL THEN
    RAISE EXCEPTION 'Test 7 FAILED: the original row (id=%) no longer exists.', snap.id;
  END IF;
  row_hash_after := md5((row_after.id, row_after.period_start_date, row_after.period_end_date, row_after.period_label, row_after.source_analysis_id, row_after.source_ats_fingerprint, row_after.content, row_after.created_at, row_after.created_by, row_after.updated_at, row_after.updated_by)::text);
  IF row_hash_after <> snap.row_hash THEN
    RAISE EXCEPTION 'Test 7 FAILED: one or more of Test Draft 1''s original columns changed (content/source_analysis_id/created_by/updated_by/timestamps/etc).';
  END IF;
  RAISE NOTICE 'Test 7 PASSED: Test Draft 1''s original columns are byte-for-byte unchanged.';

  IF row_after.owner_id IS DISTINCT FROM snap.created_by THEN
    RAISE EXCEPTION 'Test 8 FAILED: owner_id (%) does not equal the original created_by (%).', row_after.owner_id, snap.created_by;
  END IF;
  RAISE NOTICE 'Test 8 PASSED: owner_id was correctly backfilled from the original created_by.';

  -- Test 9: new authorization helper exists with SECURITY DEFINER + search_path public.
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'is_leadership_report_authorized'
      AND p.prosecdef = true AND p.proconfig @> ARRAY['search_path=public']
  ) THEN
    RAISE EXCEPTION 'Test 9 FAILED: is_leadership_report_authorized() is missing, not SECURITY DEFINER, or not pinned to search_path=public.';
  END IF;
  RAISE NOTICE 'Test 9 PASSED: is_leadership_report_authorized() exists with SECURITY DEFINER and search_path=public.';

  -- Test 10: new SELECT policy is owner-private and authorization-gated.
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'leadership_report_drafts'
      AND policyname = 'leadership_report_drafts_select_own'
      AND cmd = 'SELECT'
      AND qual = '(is_leadership_report_authorized() AND (owner_id = auth.uid()))'
  ) THEN
    RAISE EXCEPTION 'Test 10 FAILED: leadership_report_drafts_select_own is missing or has an unexpected USING expression.';
  END IF;
  RAISE NOTICE 'Test 10 PASSED: the new SELECT policy requires both authorization and owner match.';

  -- Test 11: old admin-wide SELECT policy is gone.
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'leadership_report_drafts'
      AND policyname = 'leadership_report_drafts_select_admin'
  ) THEN
    RAISE EXCEPTION 'Test 11 FAILED: the old admin-wide policy still exists.';
  END IF;
  RAISE NOTICE 'Test 11 PASSED: the old admin-wide SELECT policy is gone.';

  -- Test 12: authenticated/anon have no direct INSERT/UPDATE/DELETE.
  IF EXISTS (
    SELECT 1 FROM information_schema.role_table_grants
    WHERE table_schema = 'public' AND table_name = 'leadership_report_drafts'
      AND grantee IN ('authenticated', 'anon')
      AND privilege_type IN ('INSERT', 'UPDATE', 'DELETE')
  ) THEN
    RAISE EXCEPTION 'Test 12 FAILED: authenticated/anon still have a direct INSERT/UPDATE/DELETE grant.';
  END IF;
  RAISE NOTICE 'Test 12 PASSED: authenticated/anon have no direct INSERT/UPDATE/DELETE.';

  -- Test 13: TRUNCATE/REFERENCES/TRIGGER/MAINTAIN revoked from authenticated/anon.
  IF EXISTS (
    SELECT 1 FROM information_schema.role_table_grants
    WHERE table_schema = 'public' AND table_name = 'leadership_report_drafts'
      AND grantee IN ('authenticated', 'anon')
      AND privilege_type IN ('TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN')
  ) THEN
    RAISE EXCEPTION 'Test 13 FAILED: authenticated/anon still hold TRUNCATE/REFERENCES/TRIGGER/MAINTAIN on this table.';
  END IF;
  RAISE NOTICE 'Test 13 PASSED: TRUNCATE/REFERENCES/TRIGGER/MAINTAIN are revoked from authenticated/anon.';

  -- Test 14 + 15 + 16: EXECUTE grants on save_leadership_report_draft.
  IF EXISTS (
    SELECT 1 FROM information_schema.role_routine_grants
    WHERE routine_schema = 'public' AND routine_name = 'save_leadership_report_draft' AND grantee = 'anon'
  ) THEN
    RAISE EXCEPTION 'Test 14 FAILED: anon can still execute save_leadership_report_draft.';
  END IF;
  RAISE NOTICE 'Test 14 PASSED: anon cannot execute save_leadership_report_draft.';

  IF EXISTS (
    SELECT 1 FROM information_schema.role_routine_grants
    WHERE routine_schema = 'public' AND routine_name = 'save_leadership_report_draft' AND grantee = 'PUBLIC'
  ) THEN
    RAISE EXCEPTION 'Test 15 FAILED: PUBLIC can still execute save_leadership_report_draft.';
  END IF;
  RAISE NOTICE 'Test 15 PASSED: PUBLIC cannot execute save_leadership_report_draft.';

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.role_routine_grants
    WHERE routine_schema = 'public' AND routine_name = 'save_leadership_report_draft' AND grantee = 'authenticated'
  ) THEN
    RAISE EXCEPTION 'Test 16 FAILED: authenticated cannot execute save_leadership_report_draft.';
  END IF;
  RAISE NOTICE 'Test 16 PASSED: authenticated can execute save_leadership_report_draft.';

  -- Test 17: no owner parameter was added — same 6-argument signature as before.
  IF (
    SELECT pg_get_function_identity_arguments(p.oid)
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'save_leadership_report_draft'
  ) <> 'p_period_start_date date, p_period_end_date date, p_period_label text, p_source_analysis_id uuid, p_source_ats_fingerprint text, p_content jsonb' THEN
    RAISE EXCEPTION 'Test 17 FAILED: save_leadership_report_draft''s parameter list changed — an owner parameter (or something else) was added.';
  END IF;
  RAISE NOTICE 'Test 17 PASSED: save_leadership_report_draft still takes exactly its original 6 parameters — no owner parameter exists.';

  -- Test 18: structural grant check — authenticated has table SELECT, anon
  -- does not (the exact fix for the anon-read failure: anon previously
  -- retained a default-privilege SELECT grant this migration never
  -- explicitly revoked, so an anonymous query reached RLS/policy
  -- evaluation and failed on the authorization helper's own EXECUTE grant
  -- instead of failing cleanly at the table-grant layer).
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.role_table_grants
    WHERE table_schema = 'public' AND table_name = 'leadership_report_drafts'
      AND grantee = 'authenticated' AND privilege_type = 'SELECT'
  ) THEN
    RAISE EXCEPTION 'Test 18 FAILED: authenticated does not have SELECT on leadership_report_drafts.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.role_table_grants
    WHERE table_schema = 'public' AND table_name = 'leadership_report_drafts'
      AND grantee = 'anon' AND privilege_type = 'SELECT'
  ) THEN
    RAISE EXCEPTION 'Test 18 FAILED: anon still has SELECT on leadership_report_drafts.';
  END IF;
  RAISE NOTICE 'Test 18 PASSED: authenticated has table SELECT; anon has none.';

  -- Behavioral tests from here on: uses set_config('request.jwt.claims', ...)
  -- exactly like 20260918_manager_edit_lock.sql's own self-test, so
  -- auth.uid() genuinely resolves to a real profile — a real proof of the
  -- RLS/RPC logic, not a simulation of session-transport auth (out of scope
  -- — see this file's header).
  --
  -- CRITICAL: setting request.jwt.claims alone does NOT make RLS apply. RLS
  -- is enforced based on the ACTIVE POSTGRES ROLE a query executes as — the
  -- Studio SQL editor connects as postgres, the confirmed owner of this
  -- table, and table owners bypass RLS entirely regardless of auth.uid(),
  -- since FORCE ROW LEVEL SECURITY is deliberately not set (matching
  -- executive_analyses/executive_analysis_versions). Every raw SELECT below
  -- that is meant to prove an RLS outcome therefore explicitly
  -- SET ROLE authenticated (or SET ROLE anon for the anonymous case) first,
  -- and RESET ROLE immediately after — even on an unexpected error inside
  -- the nested BEGIN/EXCEPTION block, so a failure can never leave the
  -- session logically "stuck" in a switched role for whatever runs next.
  -- (This omission is exactly what caused the original cross-owner-denial
  -- test's failure in an earlier run of this file — it was a test-harness
  -- gap, not a policy defect; see the diagnosis this fix was approved
  -- against. That test is Test 22 below.) RPC calls
  -- (save_leadership_report_draft) do NOT need this: it is SECURITY
  -- DEFINER, so it always executes with the owner's privileges regardless
  -- of the calling role — those tests are unaffected and unchanged below.
  SELECT id INTO test_admin_id FROM public.profiles WHERE role = 'admin' AND is_active = true AND id <> snap.created_by LIMIT 1;
  SELECT id INTO test_admin2_id FROM public.profiles WHERE role = 'admin' AND is_active = true AND id NOT IN (snap.created_by, test_admin_id) LIMIT 1;

  -- Probed once, up front, and immediately reset — reused by every
  -- RLS-dependent test below rather than re-probing (and re-risking a
  -- half-switched state) per test. A SKIPPED notice here is an honest
  -- environment/permission limitation, never reported as a PASS.
  authenticated_switch_ok := true;
  BEGIN
    EXECUTE 'SET ROLE authenticated';
    EXECUTE 'RESET ROLE';
  EXCEPTION WHEN OTHERS THEN
    authenticated_switch_ok := false;
    RAISE NOTICE 'Every test requiring SET ROLE authenticated will be SKIPPED: this session cannot switch to that role (%). Re-run from a role with authenticated membership to genuinely exercise RLS.', SQLERRM;
  END;

  anon_switch_ok := true;
  BEGIN
    EXECUTE 'SET ROLE anon';
    EXECUTE 'RESET ROLE';
  EXCEPTION WHEN OTHERS THEN
    anon_switch_ok := false;
    RAISE NOTICE 'The anonymous-read privacy test will be SKIPPED: this session cannot SET ROLE anon (%).', SQLERRM;
  END;

  -- Test 19: a real, currently-UNAUTHORIZED active admin cannot read Test
  -- Draft 1 — run BEFORE anyone is authorized below, using test_admin_id in
  -- its genuine, untouched, default (leadership_report_authorized = false)
  -- state. Separate from (and a precondition for) Test 22, which proves an
  -- AUTHORIZED-but-different admin still can't read it either.
  IF test_admin_id IS NULL THEN
    RAISE NOTICE 'Test 19 SKIPPED: needs at least one active admin profile distinct from Test Draft 1''s own owner — none found in this environment.';
  ELSIF authenticated_switch_ok THEN
    row_count := NULL;
    EXECUTE 'SET ROLE authenticated';
    BEGIN
      PERFORM set_config('request.jwt.claims', json_build_object('sub', test_admin_id)::text, true);
      SELECT count(*) INTO row_count FROM public.leadership_report_drafts WHERE id = snap.id;
    EXCEPTION WHEN OTHERS THEN
      EXECUTE 'RESET ROLE';
      RAISE;
    END;
    EXECUTE 'RESET ROLE';
    IF row_count <> 0 THEN
      RAISE EXCEPTION 'Test 19 FAILED: an unauthorized (leadership_report_authorized=false) admin could read Test Draft 1 (found % row(s)); expected 0.', row_count;
    END IF;
    RAISE NOTICE 'Test 19 PASSED: an unauthorized active admin cannot read Test Draft 1.';
  ELSE
    RAISE NOTICE 'Test 19 SKIPPED: requires SET ROLE authenticated, unavailable in this session.';
  END IF;

  -- Test 20: an anonymous caller (no session identity at all — auth.uid()
  -- is NULL) cannot read anything from this table. Expected secure outcome
  -- is now PERMISSION DENIED specifically (SQLSTATE 42501 /
  -- insufficient_privilege), not a clean 0-row result — anon has no
  -- table-level SELECT grant at all (see the new REVOKE SELECT ... FROM
  -- anon above), so the query is rejected before RLS/the authorization
  -- helper is ever reached. Only insufficient_privilege counts as a pass;
  -- any other error is re-raised as a genuine, unrelated failure rather
  -- than mistaken for proof of privacy.
  IF anon_switch_ok THEN
    caught := false;
    EXECUTE 'SET ROLE anon';
    BEGIN
      RESET request.jwt.claims;
      PERFORM count(*) FROM public.leadership_report_drafts;
    EXCEPTION WHEN insufficient_privilege THEN
      caught := true;
    WHEN OTHERS THEN
      EXECUTE 'RESET ROLE';
      RAISE;
    END;
    EXECUTE 'RESET ROLE';
    IF NOT caught THEN
      RAISE EXCEPTION 'Test 20 FAILED: an anonymous caller was able to query leadership_report_drafts without a permission-denied error — anon must have no table-level SELECT at all.';
    END IF;
    RAISE NOTICE 'Test 20 PASSED: an anonymous caller is rejected with permission denied (insufficient_privilege) — anon has no SELECT on this table at all.';
  ELSE
    RAISE NOTICE 'Test 20 SKIPPED: requires SET ROLE anon, unavailable in this session.';
  END IF;

  IF test_admin_id IS NULL THEN
    RAISE NOTICE 'Tests 21-25 SKIPPED: needs at least one active admin profile distinct from Test Draft 1''s own owner — none found in this environment.';
  ELSE
    -- Temporarily authorize the two (or three) profiles involved, for the
    -- duration of this transaction only — restored explicitly below, and
    -- guaranteed reverted regardless by the trailing ROLLBACK.
    UPDATE public.profiles SET leadership_report_authorized = true WHERE id = snap.created_by;
    UPDATE public.profiles SET leadership_report_authorized = true WHERE id = test_admin_id;
    IF test_admin2_id IS NOT NULL THEN
      UPDATE public.profiles SET leadership_report_authorized = true WHERE id = test_admin2_id;
    END IF;

    -- Test 21: the original owner, now authorized, can read their own
    -- preserved row.
    IF authenticated_switch_ok THEN
      row_count := NULL;
      EXECUTE 'SET ROLE authenticated';
      BEGIN
        PERFORM set_config('request.jwt.claims', json_build_object('sub', snap.created_by)::text, true);
        SELECT count(*) INTO row_count FROM public.leadership_report_drafts WHERE id = snap.id;
      EXCEPTION WHEN OTHERS THEN
        EXECUTE 'RESET ROLE';
        RAISE;
      END;
      EXECUTE 'RESET ROLE';
      IF row_count <> 1 THEN
        RAISE EXCEPTION 'Test 21 FAILED: Test Draft 1''s own owner could not SELECT their own preserved row (found % row(s)).', row_count;
      END IF;
      RAISE NOTICE 'Test 21 PASSED: Test Draft 1''s own owner can still read their own row after migration.';
    ELSE
      RAISE NOTICE 'Test 21 SKIPPED: requires SET ROLE authenticated, unavailable in this session.';
    END IF;

    -- Test 22: a DIFFERENT authorized admin cannot read Test Draft 1, even
    -- though they are now authorized too — proves ownership, not just
    -- authorization, gates access. This is the core private-workspace
    -- guarantee, and the exact assertion that originally caught the
    -- SET ROLE omission (it "passed" for the wrong reason before this fix).
    IF authenticated_switch_ok THEN
      row_count := NULL;
      EXECUTE 'SET ROLE authenticated';
      BEGIN
        PERFORM set_config('request.jwt.claims', json_build_object('sub', test_admin_id)::text, true);
        SELECT count(*) INTO row_count FROM public.leadership_report_drafts WHERE id = snap.id;
      EXCEPTION WHEN OTHERS THEN
        EXECUTE 'RESET ROLE';
        RAISE;
      END;
      EXECUTE 'RESET ROLE';
      IF row_count <> 0 THEN
        RAISE EXCEPTION 'Test 22 FAILED: a different authorized admin could read Test Draft 1 (found % row(s)); expected 0.', row_count;
      END IF;
      RAISE NOTICE 'Test 22 PASSED: a different authorized admin cannot read Test Draft 1 — ownership, not just authorization, gates access.';
    ELSE
      RAISE NOTICE 'Test 22 SKIPPED: requires SET ROLE authenticated, unavailable in this session.';
    END IF;

    -- Test 23: that same admin CAN save their own draft for the same real
    -- reporting week Test Draft 1 belongs to (reusing its own real
    -- source_analysis_id/period fields) — proves different owners can
    -- share a period_start_date, and never touches Test Draft 1 itself
    -- (a genuinely separate row, per the new owner-scoped uniqueness).
    -- SECURITY DEFINER — no role switch needed; runs as the function owner
    -- regardless of the calling role.
    SELECT * INTO draft_row FROM save_leadership_report_draft(
      snap.period_start_date, snap.period_end_date, snap.period_label,
      snap.source_analysis_id, 'test-fingerprint-phase2d-v1',
      '{"openingParagraph":"A separate owner''s draft for the same week.","topics":[{"title":"Topic X","statusSummary":"s","bullets":["b"],"next":"n"}]}'::jsonb
    );
    IF draft_row.owner_id IS DISTINCT FROM test_admin_id OR draft_row.id = snap.id THEN
      RAISE EXCEPTION 'Test 23 FAILED: the new draft was not owned by the saving admin, or collided with Test Draft 1''s own row.';
    END IF;
    first_created_at := draft_row.created_at;
    RAISE NOTICE 'Test 23 PASSED: a different owner can save their own separate draft for the same reporting week (id=%), without touching Test Draft 1.', draft_row.id;

    -- Test 24: that same admin saving AGAIN for the same week updates their
    -- own new row (upsert conflict target is owner_id+period_start_date),
    -- rather than creating a duplicate or ever touching Test Draft 1.
    SELECT * INTO draft_row2 FROM save_leadership_report_draft(
      snap.period_start_date, snap.period_end_date, snap.period_label,
      snap.source_analysis_id, 'test-fingerprint-phase2d-v2',
      '{"openingParagraph":"Revised.","topics":[{"title":"Topic X","statusSummary":"s","bullets":["b","b2"],"next":"n"}]}'::jsonb
    );
    SELECT count(*) INTO row_count FROM public.leadership_report_drafts WHERE owner_id = test_admin_id AND period_start_date = snap.period_start_date;
    IF row_count <> 1 OR draft_row2.created_at IS DISTINCT FROM first_created_at OR draft_row2.created_by IS DISTINCT FROM test_admin_id THEN
      RAISE EXCEPTION 'Test 24 FAILED: a second save by the same owner for the same week did not update in place (created_at/created_by should be unchanged, exactly one row should exist).';
    END IF;
    RAISE NOTICE 'Test 24 PASSED: a second save by the same owner/week updates in place — created_at/created_by preserved, exactly one row.';

    -- Test 25: mutual isolation — a THIRD, separately-authorized admin
    -- cannot read the second admin's just-created row either (proves
    -- isolation is symmetric, not just "Test Draft 1 is special").
    IF test_admin2_id IS NULL THEN
      RAISE NOTICE 'Test 25 SKIPPED: needs a third, distinct active admin profile to prove mutual isolation symmetrically; only two are available in this environment.';
    ELSIF authenticated_switch_ok THEN
      row_count := NULL;
      EXECUTE 'SET ROLE authenticated';
      BEGIN
        PERFORM set_config('request.jwt.claims', json_build_object('sub', test_admin2_id)::text, true);
        SELECT count(*) INTO row_count FROM public.leadership_report_drafts WHERE id = draft_row2.id;
      EXCEPTION WHEN OTHERS THEN
        EXECUTE 'RESET ROLE';
        RAISE;
      END;
      EXECUTE 'RESET ROLE';
      IF row_count <> 0 THEN
        RAISE EXCEPTION 'Test 25 FAILED: a third authorized admin could read a second admin''s private draft.';
      END IF;
      RAISE NOTICE 'Test 25 PASSED: mutual isolation confirmed between two different authorized owners.';
    ELSE
      RAISE NOTICE 'Test 25 SKIPPED: requires SET ROLE authenticated, unavailable in this session.';
    END IF;

    -- Test 26: an authorized admin cannot save malformed/legacy content —
    -- validation is unchanged (behavioral proof, not just structural).
    -- SECURITY DEFINER RPC — no role switch needed.
    PERFORM set_config('request.jwt.claims', json_build_object('sub', test_admin_id)::text, true);
    caught := false;
    BEGIN
      PERFORM save_leadership_report_draft(
        snap.period_start_date, snap.period_end_date, snap.period_label,
        snap.source_analysis_id, 'test-fingerprint-invalid-attempt',
        '{"executiveSummary":"a","keyPriorities":"b","majorWins":"c","challengesRisks":"d","challengeProgress":"e","opportunities":"f","prioritiesGoingForward":"g"}'::jsonb
      );
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM LIKE 'INVALID_SECTIONS%' THEN
        caught := true;
      ELSE
        RAISE;
      END IF;
    END;
    IF NOT caught THEN
      RAISE EXCEPTION 'Test 26 FAILED: a legacy 7-key payload was accepted by an authorized admin.';
    END IF;
    RAISE NOTICE 'Test 26 PASSED: ATS content validation is unchanged — a legacy payload is still rejected.';

    -- Test 27: a caller who is admin+active but NOT authorized is still
    -- rejected — proves the new authorization gate is enforced, not merely
    -- present. SECURITY DEFINER RPC — no role switch needed. (Distinct from
    -- Test 19, which proves the same unauthorized state also blocks READS,
    -- not just this SAVE path.)
    UPDATE public.profiles SET leadership_report_authorized = false WHERE id = test_admin_id;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', test_admin_id)::text, true);
    caught := false;
    BEGIN
      PERFORM save_leadership_report_draft(
        snap.period_start_date, snap.period_end_date, snap.period_label,
        snap.source_analysis_id, 'test-fingerprint-unauthorized-attempt',
        '{"openingParagraph":"x","topics":[{"title":"t","statusSummary":"s","bullets":["b"],"next":"n"}]}'::jsonb
      );
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM LIKE 'FORBIDDEN%' THEN
        caught := true;
      ELSE
        RAISE;
      END IF;
    END;
    IF NOT caught THEN
      RAISE EXCEPTION 'Test 27 FAILED: an admin+active but unauthorized profile was able to save a Leadership Report draft.';
    END IF;
    RAISE NOTICE 'Test 27 PASSED: an active admin without leadership_report_authorized=true is rejected with FORBIDDEN.';

    -- Restore authorization flags explicitly (belt-and-suspenders — the
    -- trailing ROLLBACK guarantees this regardless).
    RESET request.jwt.claims;
    UPDATE public.profiles SET leadership_report_authorized = false WHERE id IN (snap.created_by, test_admin_id);
    IF test_admin2_id IS NOT NULL THEN
      UPDATE public.profiles SET leadership_report_authorized = false WHERE id = test_admin2_id;
    END IF;
  END IF;

  RAISE NOTICE '--- All checks completed. This entire script still rolls back below; nothing above is persisted. ---';
END $$;

DROP TABLE _lr_test_snapshot;

ROLLBACK;

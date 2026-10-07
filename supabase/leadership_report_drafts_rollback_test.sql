-- Leadership Report Phase 2B — TRANSACTION-TEST SCRIPT. NOT A MIGRATION.
--
-- Deliberately kept OUTSIDE supabase/migrations/ so it is never picked up
-- as a real migration by any tooling — this file's entire purpose is to be
-- run once, by hand, in the Supabase Studio SQL Editor, and to leave
-- ZERO persisted trace regardless of outcome. It creates every object that
-- supabase/migrations/20260924_leadership_report_drafts.sql creates, runs a
-- full battery of checks against them, and ends in ROLLBACK no matter what
-- happens above it — even a failed assertion (RAISE EXCEPTION) only aborts
-- this transaction, and the final ROLLBACK statement is still valid and
-- still discards everything. Run this file FIRST; only apply the real
-- migration afterward once every NOTICE below reads PASSED (or an
-- explicitly acceptable SKIPPED, explained inline where it can occur).
--
-- Uses real, already-existing profiles (admin-role, manager-role) and a
-- real, already-existing weekly executive_analyses row for FK and security
-- realism, exactly as directed — never fabricated ids. One real admin
-- profile's is_active flag is temporarily flipped for a single check and
-- immediately restored (mirroring the established convention in
-- supabase/migrations/20260917_manager_edit_cutoff_4pm.production.sql of
-- "temporarily flagged and restored, never left modified") — safe
-- regardless, since the entire transaction rolls back, but restored
-- explicitly anyway as good practice.
--
-- IMPORTANT — do not run this against a database where it matters if a
-- concurrent session reads mid-transaction state; it is intended for a
-- single interactive Studio session with no concurrent conflicting access
-- to these tables.
BEGIN;

-- ---------------------------------------------------------------------------
-- Same DDL as the real migration, verbatim, so this test exercises the
-- actual objects end-to-end rather than assuming they already exist.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_valid_leadership_report_content(p jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT
    p ?& array['openingParagraph', 'topics']
    AND (SELECT count(*) FROM jsonb_object_keys(p)) = 2
    AND jsonb_typeof(p -> 'openingParagraph') = 'string'
    AND jsonb_typeof(p -> 'topics') = 'array'
    AND jsonb_array_length(p -> 'topics') >= 1
    AND (
      SELECT bool_and(
        jsonb_typeof(topic) = 'object'
        AND (topic ?& array['title','statusSummary','bullets','next'])
        AND (SELECT count(*) FROM jsonb_object_keys(topic)) = 4
        AND jsonb_typeof(topic -> 'title') = 'string'
        AND jsonb_typeof(topic -> 'statusSummary') = 'string'
        AND jsonb_typeof(topic -> 'next') = 'string'
        AND jsonb_typeof(topic -> 'bullets') = 'array'
        AND jsonb_array_length(topic -> 'bullets') >= 1
        AND jsonb_array_length(topic -> 'bullets') <= 5
        AND (
          SELECT bool_and(jsonb_typeof(b) = 'string')
          FROM jsonb_array_elements(topic -> 'bullets') AS b
        )
      )
      FROM jsonb_array_elements(p -> 'topics') AS topic
    );
$$;

CREATE TABLE public.leadership_report_drafts (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period_start_date      date NOT NULL,
  period_end_date        date NOT NULL,
  period_label           text NOT NULL,
  source_analysis_id     uuid NOT NULL REFERENCES public.executive_analyses(id),
  source_ats_fingerprint text NOT NULL,
  content                jsonb NOT NULL,
  created_at             timestamptz NOT NULL DEFAULT now(),
  created_by             uuid NOT NULL REFERENCES public.profiles(id),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  updated_by             uuid NOT NULL REFERENCES public.profiles(id),
  UNIQUE (period_start_date)
);

ALTER TABLE public.leadership_report_drafts ENABLE ROW LEVEL SECURITY;

CREATE POLICY leadership_report_drafts_select_admin
  ON public.leadership_report_drafts
  FOR SELECT
  TO public
  USING (is_admin());

GRANT SELECT ON public.leadership_report_drafts TO authenticated;

-- The public schema's default privileges automatically grant broad CRUD to
-- BOTH anon and authenticated on every newly created table (confirmed live
-- via pg_default_acl) — GRANT SELECT above is additive only and does not
-- remove that. Without this, authenticated/anon would retain a raw write
-- path around the RPC below.
REVOKE INSERT, UPDATE, DELETE
ON public.leadership_report_drafts
FROM authenticated, anon;

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
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'FORBIDDEN: Admin access is required.';
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
    period_start_date, period_end_date, period_label,
    source_analysis_id, source_ats_fingerprint, content,
    created_by, updated_by
  )
  VALUES (
    p_period_start_date, p_period_end_date, p_period_label,
    p_source_analysis_id, p_source_ats_fingerprint, p_content,
    v_caller, v_caller
  )
  ON CONFLICT (period_start_date) DO UPDATE SET
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
GRANT EXECUTE ON FUNCTION public.save_leadership_report_draft(date, date, text, uuid, text, jsonb) TO authenticated;

-- ---------------------------------------------------------------------------
-- Test battery. Every genuine failure RAISE EXCEPTIONs (aborting only this
-- transaction — the trailing ROLLBACK still applies cleanly). Every pass
-- RAISE NOTICEs so the full result set is visible in the Studio output pane.
-- Fixture-data gaps (e.g. only one admin profile exists) degrade specific
-- checks to a SKIPPED notice rather than a hard failure — that reflects
-- this environment's data, not a defect in the migration.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  test_admin_id          uuid;
  test_admin2_id         uuid;
  test_inactive_admin_id uuid;
  test_manager_id        uuid;
  src_row                RECORD;
  other_src_row          RECORD;
  draft_row              RECORD;
  draft_row2             RECORD;
  caught                 boolean;
  role_switch_ok         boolean;
  first_created_at       timestamptz;
  first_updated_at       timestamptz;
  row_count              integer;
  ea_count_before        integer;
  ea_count_after         integer;
  eav_count_before       integer;
  eav_count_after        integer;
  src_row_hash_before    text;
  src_row_hash_after     text;
  rows_affected          integer;
  insert_test_period_start date := '2099-01-05';
  insert_test_period_end   date := '2099-01-11';
BEGIN
  SELECT id INTO test_admin_id FROM profiles WHERE role = 'admin' AND is_active = true LIMIT 1;
  SELECT id INTO test_admin2_id FROM profiles WHERE role = 'admin' AND is_active = true AND id <> test_admin_id LIMIT 1;
  SELECT id INTO test_manager_id FROM profiles WHERE role = 'manager' LIMIT 1;

  IF test_admin_id IS NULL OR test_manager_id IS NULL THEN
    RAISE NOTICE 'SKIPPED (all tests): this run needs at least one active admin-role profile and one manager-role profile. Found admin=%, manager=%.', test_admin_id, test_manager_id;
    RETURN;
  END IF;
  IF test_admin2_id IS NULL THEN
    RAISE NOTICE 'NOTE: only one active admin-role profile exists in this environment — Tests 5/7/9 will reuse it instead of a second distinct admin, which weakens (but does not invalidate) the created_by-vs-updated_by distinction.';
  END IF;

  SELECT id, period_start_date, period_end_date, period_label
    INTO src_row
    FROM executive_analyses
    WHERE period_key = 'weekly'
    ORDER BY period_start_date DESC
    LIMIT 1;

  IF src_row.id IS NULL THEN
    RAISE NOTICE 'SKIPPED (all tests): this run needs at least one existing weekly executive_analyses row.';
    RETURN;
  END IF;

  SELECT id, period_start_date, period_end_date, period_label
    INTO other_src_row
    FROM executive_analyses
    WHERE period_key = 'weekly' AND period_start_date <> src_row.period_start_date
    ORDER BY period_start_date DESC
    LIMIT 1;

  -- Baseline snapshot of the frozen objects, taken before anything below
  -- runs, so Test 17 can prove byte-for-byte non-modification rather than
  -- just "still exists".
  SELECT count(*) INTO ea_count_before FROM executive_analyses;
  SELECT count(*) INTO eav_count_before FROM executive_analysis_versions;
  SELECT md5(t::text) INTO src_row_hash_before FROM executive_analyses t WHERE t.id = src_row.id;

  -- Test 1: validator accepts a well-formed ATS payload.
  IF NOT is_valid_leadership_report_content(
    '{"openingParagraph":"x","topics":[{"title":"t","statusSummary":"s","bullets":["b1"],"next":"n"}]}'::jsonb
  ) THEN
    RAISE EXCEPTION 'Test 1 FAILED: is_valid_leadership_report_content rejected a well-formed ATS payload.';
  END IF;
  RAISE NOTICE 'Test 1 PASSED: validator accepts a well-formed ATS payload.';

  -- Test 2: validator rejects the legacy 7-key Executive Analysis shape.
  IF is_valid_leadership_report_content(
    '{"executiveSummary":"a","keyPriorities":"b","majorWins":"c","challengesRisks":"d","challengeProgress":"e","opportunities":"f","prioritiesGoingForward":"g"}'::jsonb
  ) THEN
    RAISE EXCEPTION 'Test 2 FAILED: is_valid_leadership_report_content incorrectly accepted the legacy 7-key shape.';
  END IF;
  RAISE NOTICE 'Test 2 PASSED: validator rejects the legacy 7-key Executive Analysis shape.';

  -- Test 3: validator rejects malformed ATS payloads — over-max bullets,
  -- an empty topics array, and a topic missing a required key.
  IF is_valid_leadership_report_content(
    '{"openingParagraph":"x","topics":[{"title":"t","statusSummary":"s","bullets":["1","2","3","4","5","6"],"next":"n"}]}'::jsonb
  ) THEN
    RAISE EXCEPTION 'Test 3a FAILED: incorrectly accepted 6 bullets on one topic (over MAX_BULLETS=5).';
  END IF;
  IF is_valid_leadership_report_content('{"openingParagraph":"x","topics":[]}'::jsonb) THEN
    RAISE EXCEPTION 'Test 3b FAILED: incorrectly accepted an empty topics array.';
  END IF;
  IF is_valid_leadership_report_content(
    '{"openingParagraph":"x","topics":[{"title":"t","statusSummary":"s","bullets":["b"]}]}'::jsonb
  ) THEN
    RAISE EXCEPTION 'Test 3c FAILED: incorrectly accepted a topic missing the required "next" key.';
  END IF;
  RAISE NOTICE 'Test 3 PASSED: validator rejects malformed ATS payloads (over-max bullets, empty topics array, missing required topic key).';

  -- Test 4: a valid, active admin's first Save Draft for this week inserts
  -- a new row with created_by/updated_by set to the caller.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', test_admin_id)::text, true);
  SELECT * INTO draft_row FROM save_leadership_report_draft(
    src_row.period_start_date,
    src_row.period_end_date,
    src_row.period_label,
    src_row.id,
    'test-fingerprint-v1',
    '{"openingParagraph":"Initial draft.","topics":[{"title":"Topic A","statusSummary":"On track","bullets":["Bullet one"],"next":"Keep going"}]}'::jsonb
  );
  IF draft_row.id IS NULL OR draft_row.created_by IS DISTINCT FROM test_admin_id OR draft_row.updated_by IS DISTINCT FROM test_admin_id THEN
    RAISE EXCEPTION 'Test 4 FAILED: first Save Draft did not insert a row with created_by/updated_by set to the calling admin.';
  END IF;
  first_created_at := draft_row.created_at;
  first_updated_at := draft_row.updated_at;
  RAISE NOTICE 'Test 4 PASSED: first Save Draft inserted a new row (id=%) with created_by/updated_by = calling admin.', draft_row.id;

  -- Test 5: a second save for the SAME week updates the existing row rather
  -- than creating a duplicate. Performed by a second distinct admin when
  -- available, so the created_by-vs-updated_by distinction in Tests 6/7 is
  -- provable without depending on sub-transaction timestamp granularity
  -- (now() is frozen for the whole of this wrapping transaction in
  -- PostgreSQL, so created_at/updated_at will read identically either way).
  PERFORM set_config('request.jwt.claims', json_build_object('sub', COALESCE(test_admin2_id, test_admin_id))::text, true);
  SELECT * INTO draft_row FROM save_leadership_report_draft(
    src_row.period_start_date,
    src_row.period_end_date,
    src_row.period_label,
    src_row.id,
    'test-fingerprint-v2',
    '{"openingParagraph":"Revised draft.","topics":[{"title":"Topic A","statusSummary":"On track","bullets":["Bullet one","Bullet two"],"next":"Keep going"}]}'::jsonb
  );
  SELECT count(*) INTO row_count FROM leadership_report_drafts WHERE period_start_date = src_row.period_start_date;
  IF row_count <> 1 THEN
    RAISE EXCEPTION 'Test 5 FAILED: expected exactly 1 row for this reporting week after a second save, found %.', row_count;
  END IF;
  IF draft_row.content ->> 'openingParagraph' <> 'Revised draft.' THEN
    RAISE EXCEPTION 'Test 5 FAILED: second Save Draft did not update the row content.';
  END IF;
  RAISE NOTICE 'Test 5 PASSED: second Save Draft for the same week updated the existing row rather than creating a duplicate.';

  -- Test 6: created_at/created_by are preserved across the second save.
  IF draft_row.created_at IS DISTINCT FROM first_created_at OR draft_row.created_by IS DISTINCT FROM test_admin_id THEN
    RAISE EXCEPTION 'Test 6 FAILED: created_at/created_by changed on a subsequent save.';
  END IF;
  RAISE NOTICE 'Test 6 PASSED: created_at/created_by are preserved across a subsequent save.';

  -- Test 7: updated_by correctly reflects whichever admin performed the
  -- most recent save. (updated_at cannot be shown to "advance" within this
  -- single wrapping transaction, since now() is frozen for its duration —
  -- see the comment on Test 5. updated_by changing to a genuinely different
  -- admin is the reliable, clock-independent proof that the UPDATE branch
  -- ran and set audit fields correctly.)
  IF test_admin2_id IS NOT NULL THEN
    IF draft_row.updated_by IS DISTINCT FROM test_admin2_id THEN
      RAISE EXCEPTION 'Test 7 FAILED: updated_by did not change to the second admin who performed the second save.';
    END IF;
    RAISE NOTICE 'Test 7 PASSED: updated_by correctly reflects the second admin''s save; updated_at is populated (%).', draft_row.updated_at;
  ELSE
    IF draft_row.updated_by IS DISTINCT FROM test_admin_id OR draft_row.updated_at IS NULL THEN
      RAISE EXCEPTION 'Test 7 FAILED: updated_by/updated_at are not populated as expected.';
    END IF;
    RAISE NOTICE 'Test 7 PASSED (weaker form — only one admin profile available): updated_by/updated_at are populated correctly.';
  END IF;

  -- Test 8: a manager-role (non-admin) caller is rejected with FORBIDDEN.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', test_manager_id)::text, true);
  caught := false;
  BEGIN
    PERFORM save_leadership_report_draft(
      src_row.period_start_date, src_row.period_end_date, src_row.period_label,
      src_row.id, 'test-fingerprint-manager-attempt',
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
    RAISE EXCEPTION 'Test 8 FAILED: a manager-role caller was able to save a Leadership Report draft.';
  END IF;
  RAISE NOTICE 'Test 8 PASSED: a manager-role caller is rejected with FORBIDDEN.';

  -- Test 9: an admin whose profile is_active = false is rejected with
  -- FORBIDDEN, even though role = 'admin'. Temporarily flips a real admin
  -- profile's is_active flag for this one check only, restoring it
  -- immediately after — safe regardless, since this whole script ends in
  -- ROLLBACK, but restored explicitly anyway as good practice.
  test_inactive_admin_id := COALESCE(test_admin2_id, test_admin_id);
  UPDATE profiles SET is_active = false WHERE id = test_inactive_admin_id;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', test_inactive_admin_id)::text, true);
  caught := false;
  BEGIN
    PERFORM save_leadership_report_draft(
      src_row.period_start_date, src_row.period_end_date, src_row.period_label,
      src_row.id, 'test-fingerprint-inactive-admin-attempt',
      '{"openingParagraph":"x","topics":[{"title":"t","statusSummary":"s","bullets":["b"],"next":"n"}]}'::jsonb
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'FORBIDDEN%' THEN
      caught := true;
    ELSE
      RAISE;
    END IF;
  END;

  UPDATE profiles SET is_active = true WHERE id = test_inactive_admin_id;

  IF NOT caught THEN
    RAISE EXCEPTION 'Test 9 FAILED: an inactive admin profile was able to save a Leadership Report draft.';
  END IF;
  RAISE NOTICE 'Test 9 PASSED: an inactive admin profile is rejected with FORBIDDEN (is_admin() correctly checks is_active).';

  -- Test 10: a source_analysis_id belonging to a DIFFERENT week than the
  -- one being saved is rejected with INVALID_REQUEST. Needs a second,
  -- distinct weekly executive_analyses row to test against.
  IF other_src_row.id IS NULL THEN
    RAISE NOTICE 'Test 10 SKIPPED: needs a second, distinct weekly executive_analyses row; only one exists in this environment.';
  ELSE
    PERFORM set_config('request.jwt.claims', json_build_object('sub', test_admin_id)::text, true);
    caught := false;
    BEGIN
      PERFORM save_leadership_report_draft(
        src_row.period_start_date, src_row.period_end_date, src_row.period_label,
        other_src_row.id, -- a real id, but for a DIFFERENT week than period_start_date
        'test-fingerprint-mismatch-attempt',
        '{"openingParagraph":"x","topics":[{"title":"t","statusSummary":"s","bullets":["b"],"next":"n"}]}'::jsonb
      );
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM LIKE 'INVALID_REQUEST%' THEN
        caught := true;
      ELSE
        RAISE;
      END IF;
    END;
    IF NOT caught THEN
      RAISE EXCEPTION 'Test 10 FAILED: a source_analysis_id belonging to a different reporting week was accepted.';
    END IF;
    RAISE NOTICE 'Test 10 PASSED: a source_analysis_id/period_start_date mismatch is rejected with INVALID_REQUEST.';
  END IF;

  -- Tests 11-15 exercise the actual RLS policy and table grants, which are
  -- enforced based on the ACTIVE POSTGRES ROLE a query runs as — not merely
  -- the simulated request.jwt.claims used above. A superuser/table-owner
  -- connection (which the Studio SQL editor typically uses) bypasses RLS
  -- and grant checks entirely regardless of request.jwt.claims, so these
  -- five checks explicitly switch to the `authenticated` role for their
  -- duration, then switch back immediately after. If this session's
  -- connecting role has not been granted membership in `authenticated`,
  -- SET ROLE itself will fail — caught below and reported as SKIPPED for
  -- just these five checks, not a hard failure of this script, since it
  -- would reflect a session/permission limitation, not a defect in the
  -- migration being tested.
  role_switch_ok := true;
  BEGIN
    EXECUTE 'SET ROLE authenticated';
  EXCEPTION WHEN OTHERS THEN
    role_switch_ok := false;
    RAISE NOTICE 'Tests 11-15 SKIPPED: this session cannot SET ROLE authenticated (%). Re-run from a role with authenticated membership to exercise RLS/grants directly.', SQLERRM;
  END;

  IF role_switch_ok THEN
    -- Test 11: an admin-role caller can SELECT the saved draft under RLS.
    PERFORM set_config('request.jwt.claims', json_build_object('sub', test_admin_id)::text, true);
    SELECT count(*) INTO row_count FROM leadership_report_drafts WHERE period_start_date = src_row.period_start_date;
    IF row_count <> 1 THEN
      RAISE EXCEPTION 'Test 11 FAILED: an admin-role caller (as authenticated) could not SELECT the saved draft (found % rows).', row_count;
    END IF;
    RAISE NOTICE 'Test 11 PASSED: an admin-role caller can SELECT the saved draft under RLS.';

    -- Test 12: a manager-role caller's SELECT is silently filtered to zero
    -- rows by RLS — this is expected PostgreSQL RLS behavior for a SELECT
    -- with no matching permissive policy, not an error condition.
    PERFORM set_config('request.jwt.claims', json_build_object('sub', test_manager_id)::text, true);
    SELECT count(*) INTO row_count FROM leadership_report_drafts WHERE period_start_date = src_row.period_start_date;
    IF row_count <> 0 THEN
      RAISE EXCEPTION 'Test 12 FAILED: a manager-role caller could see % row(s) via SELECT; expected 0 under RLS.', row_count;
    END IF;
    RAISE NOTICE 'Test 12 PASSED: a manager-role caller''s SELECT returns zero rows under RLS.';

    -- Test 13: a direct UPDATE (bypassing the RPC) as the authenticated
    -- role must not mutate any row. A bare "no exception was raised" is NOT
    -- sufficient proof by itself — PostgreSQL RLS with no applicable
    -- UPDATE/ALL policy silently reduces a grant-permitted UPDATE to zero
    -- affected rows rather than raising an error, so "no exception" alone
    -- could mask a write that technically executed. GET DIAGNOSTICS
    -- ROW_COUNT distinguishes the two outcomes explicitly. Given this
    -- migration now explicitly REVOKEs INSERT/UPDATE/DELETE from
    -- authenticated (closing the public-schema default-privilege grant
    -- confirmed via pg_default_acl), the EXPECTED outcome is the stronger
    -- one: outright rejection at the grant layer. The ROW_COUNT = 0 branch
    -- is kept as defense-in-depth so this test still correctly detects an
    -- actual unauthorized mutation if grant behavior ever changes, rather
    -- than silently passing on a coincidence.
    PERFORM set_config('request.jwt.claims', json_build_object('sub', test_admin_id)::text, true);
    caught := false;
    rows_affected := NULL;
    BEGIN
      UPDATE leadership_report_drafts SET period_label = 'tampered' WHERE period_start_date = src_row.period_start_date;
      GET DIAGNOSTICS rows_affected = ROW_COUNT;
    EXCEPTION WHEN OTHERS THEN
      caught := true;
    END;
    IF NOT caught AND rows_affected > 0 THEN
      RAISE EXCEPTION 'Test 13 FAILED: a direct UPDATE on leadership_report_drafts modified % row(s) as the authenticated role, bypassing the Save Draft RPC.', rows_affected;
    END IF;
    IF caught THEN
      RAISE NOTICE 'Test 13 PASSED: a direct UPDATE as the authenticated role is rejected outright (permission denied) — the expected outcome now that INSERT/UPDATE/DELETE are explicitly revoked from authenticated.';
    ELSE
      RAISE NOTICE 'Test 13 PASSED (weaker form): the UPDATE executed without error but modified 0 rows (RLS default-deny). Investigate why the REVOKE above did not produce an outright rejection.';
    END IF;

    -- Test 14: a direct INSERT (bypassing the RPC) as the authenticated
    -- role must not create a row. Unlike UPDATE/DELETE, INSERT has no
    -- existing-row USING clause to silently filter to zero — with RLS
    -- enabled and no INSERT/ALL policy, an attempted INSERT is rejected
    -- outright ("new row violates row-level security policy") even before
    -- considering the grant layer; the explicit REVOKE above closes the
    -- grant layer too. A synthetic, clearly out-of-range week
    -- (2099-01-05, matching this repo's own established synthetic-test-week
    -- convention — see supabase/migrations/20260918_manager_edit_lock.sql)
    -- is used so this can never collide with real data, and an explicit
    -- existence check afterward confirms no row was created regardless of
    -- how the attempt failed.
    PERFORM set_config('request.jwt.claims', json_build_object('sub', test_admin_id)::text, true);
    caught := false;
    BEGIN
      INSERT INTO leadership_report_drafts (
        period_start_date, period_end_date, period_label,
        source_analysis_id, source_ats_fingerprint, content,
        created_by, updated_by
      ) VALUES (
        insert_test_period_start, insert_test_period_end, 'Direct INSERT attempt (should be rejected)',
        src_row.id, 'test-fingerprint-direct-insert-attempt',
        '{"openingParagraph":"x","topics":[{"title":"t","statusSummary":"s","bullets":["b"],"next":"n"}]}'::jsonb,
        test_admin_id, test_admin_id
      );
    EXCEPTION WHEN OTHERS THEN
      caught := true;
    END;
    SELECT count(*) INTO row_count FROM leadership_report_drafts WHERE period_start_date = insert_test_period_start;
    IF row_count > 0 THEN
      RAISE EXCEPTION 'Test 14 FAILED: a direct INSERT on leadership_report_drafts created a row as the authenticated role, bypassing the Save Draft RPC.';
    END IF;
    IF NOT caught THEN
      RAISE NOTICE 'Test 14 PASSED (weaker form): the INSERT executed without error but created no row (RLS default-deny). Investigate why the REVOKE above did not produce an outright rejection.';
    ELSE
      RAISE NOTICE 'Test 14 PASSED: a direct INSERT as the authenticated role is rejected outright, and no row was created.';
    END IF;

    -- Test 15: a direct DELETE (bypassing the RPC) as the authenticated
    -- role must not remove any row — same ROW_COUNT reasoning as Test 13.
    PERFORM set_config('request.jwt.claims', json_build_object('sub', test_admin_id)::text, true);
    caught := false;
    rows_affected := NULL;
    BEGIN
      DELETE FROM leadership_report_drafts WHERE period_start_date = src_row.period_start_date;
      GET DIAGNOSTICS rows_affected = ROW_COUNT;
    EXCEPTION WHEN OTHERS THEN
      caught := true;
    END;
    IF NOT caught AND rows_affected > 0 THEN
      RAISE EXCEPTION 'Test 15 FAILED: a direct DELETE on leadership_report_drafts removed % row(s) as the authenticated role, bypassing the Save Draft RPC.', rows_affected;
    END IF;
    IF caught THEN
      RAISE NOTICE 'Test 15 PASSED: a direct DELETE as the authenticated role is rejected outright (permission denied) — the expected outcome now that INSERT/UPDATE/DELETE are explicitly revoked from authenticated.';
    ELSE
      RAISE NOTICE 'Test 15 PASSED (weaker form): the DELETE executed without error but removed 0 rows (RLS default-deny). Investigate why the REVOKE above did not produce an outright rejection.';
    END IF;

    EXECUTE 'RESET ROLE';
  END IF;

  -- Test 16: saving a second, distinct reporting week creates a SEPARATE
  -- row rather than colliding with the first — one row per week, not a
  -- single global row.
  IF other_src_row.id IS NULL THEN
    RAISE NOTICE 'Test 16 SKIPPED: needs a second, distinct weekly executive_analyses row (same fixture limitation as Test 10).';
  ELSE
    PERFORM set_config('request.jwt.claims', json_build_object('sub', test_admin_id)::text, true);
    SELECT * INTO draft_row2 FROM save_leadership_report_draft(
      other_src_row.period_start_date, other_src_row.period_end_date, other_src_row.period_label,
      other_src_row.id, 'test-fingerprint-second-week',
      '{"openingParagraph":"Second week draft.","topics":[{"title":"Topic B","statusSummary":"s","bullets":["b"],"next":"n"}]}'::jsonb
    );
    SELECT count(*) INTO row_count FROM leadership_report_drafts
      WHERE period_start_date IN (src_row.period_start_date, other_src_row.period_start_date);
    IF row_count <> 2 THEN
      RAISE EXCEPTION 'Test 16 FAILED: expected exactly 2 rows (one per distinct reporting week), found %.', row_count;
    END IF;
    RAISE NOTICE 'Test 16 PASSED: saving a second, different reporting week creates a separate row (id=%) — one row per week confirmed.', draft_row2.id;
  END IF;

  -- Test 17: executive_analyses / executive_analysis_versions are
  -- byte-for-byte unmodified by everything above — proven by row counts
  -- AND a whole-row hash of the specific source row used throughout, not
  -- just "the row still exists".
  SELECT count(*) INTO ea_count_after FROM executive_analyses;
  SELECT count(*) INTO eav_count_after FROM executive_analysis_versions;
  SELECT md5(t::text) INTO src_row_hash_after FROM executive_analyses t WHERE t.id = src_row.id;

  IF ea_count_before <> ea_count_after OR eav_count_before <> eav_count_after OR src_row_hash_before <> src_row_hash_after THEN
    RAISE EXCEPTION 'Test 17 FAILED: executive_analyses/executive_analysis_versions were modified by this test run (ea % -> %, eav % -> %, source row hash changed: %).',
      ea_count_before, ea_count_after, eav_count_before, eav_count_after, (src_row_hash_before <> src_row_hash_after);
  END IF;
  RAISE NOTICE 'Test 17 PASSED: executive_analyses and executive_analysis_versions are byte-for-byte unmodified (row counts and source row hash both unchanged).';

  RAISE NOTICE '--- All checks completed. This entire script still rolls back below; nothing above is persisted. ---';
END $$;

ROLLBACK;

-- Leadership Report Phase 2D — permanent, additive migration converting
-- leadership_report_drafts from one shared weekly draft into a private
-- per-owner workspace. Named to sort immediately after
-- 20260924_leadership_report_drafts.sql (same date, lexical "." < "_" — the
-- same same-day-multiple-migrations convention already used throughout this
-- folder, e.g. the three 20260917 files).
--
-- This migration does NOT authorize anyone. profiles.leadership_report_
-- authorized defaults to false for every row, including Andria's and Gene's.
-- Production authorization is an intentionally separate, non-reusable data
-- step (a plain UPDATE by email, run manually after this migration is
-- reviewed/tested/applied) — no name, email, or UUID belonging to any real
-- person appears anywhere in this file.
--
-- Verified live state this migration is built against (confirmed via
-- read-only Supabase Studio queries, not assumed): leadership_report_drafts
-- has no owner_id column yet; its UNIQUE constraint is named
-- leadership_report_drafts_period_start_date_key (Postgres's own default
-- single-column naming, matching the CREATE TABLE's inline
-- UNIQUE (period_start_date)); exactly one existing row
-- (period_start_date = 2026-09-14, first topic "Test Draft 1",
-- created_by = updated_by = a real Andria Grace profile id, zero orphan
-- created_by references); the current SELECT policy is
-- leadership_report_drafts_select_admin USING (is_admin()); authenticated
-- already has INSERT/UPDATE/DELETE revoked (Phase 2B) but was independently
-- found to still hold EXECUTE on save_leadership_report_draft via a direct
-- default-privilege grant to anon that a PUBLIC-only revoke never touched —
-- fixed explicitly below for both functions this migration touches.
--
-- Does not modify: is_admin() (a new, separate capability helper is added
-- instead — is_leadership_report_authorized() — exactly the pattern this
-- project already uses for submits_weekly_report, see
-- supabase/migrations/20260922_submits_weekly_report.sql's own header:
-- "role = admin answers CAN this person administer,
-- submits_weekly_report answers DOES this person submit", i.e. role and a
-- separate boolean capability are checked together, never conflated into
-- one column). Does not modify is_valid_leadership_report_content,
-- executive_analyses, or executive_analysis_versions.

-- ---------------------------------------------------------------------------
-- 1. New capability column — defaults to false for every existing and every
--    future profile. Authorizing specific people is a deliberate later step,
--    never a side effect of running this migration.
-- ---------------------------------------------------------------------------
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS leadership_report_authorized boolean NOT NULL DEFAULT false;

-- ---------------------------------------------------------------------------
-- 2. owner_id — added nullable, backfilled from the existing created_by
--    (the only person who has ever saved each existing row, and the closest
--    available proxy for "whose workspace this belongs to" for data that
--    predates ownership existing as a concept), verified NULL-free before
--    the NOT NULL constraint is applied, then FK'd to profiles. Test Draft 1
--    is never deleted, re-inserted, or content-modified by any statement
--    below — only this one new column's value changes for it, from NULL to
--    its own existing created_by.
-- ---------------------------------------------------------------------------
ALTER TABLE public.leadership_report_drafts
  ADD COLUMN IF NOT EXISTS owner_id uuid;

UPDATE public.leadership_report_drafts
  SET owner_id = created_by
  WHERE owner_id IS NULL;

-- Fail loudly and abort the whole migration (rolling back everything above,
-- since this runs inside the same implicit transaction as every statement
-- in this file when applied via the Studio SQL editor / migration runner)
-- rather than silently proceeding to a NOT NULL constraint that could
-- otherwise fail with a less specific error, or — worse — succeed by
-- coincidence while leaving a genuinely ambiguous row.
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

-- ---------------------------------------------------------------------------
-- 3. Replace uniqueness: one row per (owner, week), not one row per week
--    globally. The exact existing constraint name below was confirmed live,
--    not guessed.
-- ---------------------------------------------------------------------------
ALTER TABLE public.leadership_report_drafts
  DROP CONSTRAINT leadership_report_drafts_period_start_date_key;

ALTER TABLE public.leadership_report_drafts
  ADD CONSTRAINT leadership_report_drafts_owner_period_key
  UNIQUE (owner_id, period_start_date);

-- ---------------------------------------------------------------------------
-- 4. Authorization capability helper — sibling to is_admin(), never a
--    modification of it. Identity comes only from auth.uid(); there is no
--    parameter of any kind, so it can never be asked about anyone but the
--    caller. Mirrors is_admin()'s exact profile: STABLE, SECURITY DEFINER,
--    SET search_path = public.
-- ---------------------------------------------------------------------------
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

-- Explicit, not assumed: this Supabase project's default privileges grant
-- EXECUTE on every new function directly to anon/authenticated/service_role
-- independent of any PUBLIC grant — exactly the gap independently confirmed
-- on save_leadership_report_draft below. Revoking PUBLIC alone would not
-- have closed it for this new function either, so anon is named explicitly.
REVOKE ALL ON FUNCTION public.is_leadership_report_authorized() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_leadership_report_authorized() FROM anon;
GRANT EXECUTE ON FUNCTION public.is_leadership_report_authorized() TO authenticated;

-- ---------------------------------------------------------------------------
-- 5. RLS — replace the admin-wide policy with an owner-private,
--    authorization-gated one. No INSERT/UPDATE/DELETE policy is added here
--    either (none existed before, none is needed now — every write still
--    goes through the RPC below).
-- ---------------------------------------------------------------------------
DROP POLICY leadership_report_drafts_select_admin ON public.leadership_report_drafts;

CREATE POLICY leadership_report_drafts_select_own
  ON public.leadership_report_drafts
  FOR SELECT
  TO public
  USING (is_leadership_report_authorized() AND owner_id = auth.uid());

-- Explicitly manage every non-SELECT table privilege rather than trusting
-- this project's broad default ACLs (confirmed live via pg_default_acl in
-- Phase 2A: new tables in public receive INSERT/UPDATE/DELETE/TRUNCATE/
-- REFERENCES/TRIGGER/MAINTAIN for anon and authenticated by default). Phase
-- 2B already revoked INSERT/UPDATE/DELETE; re-issued here for defense in
-- depth, alongside the three DDL-only privileges (TRUNCATE, REFERENCES,
-- TRIGGER) and MAINTAIN, none of which the browser client or this RPC ever
-- needs — the application only ever needs SELECT (RLS-scoped) and calling
-- the RPC. Leaving any of these granted would be an unused, unnecessary
-- privilege on a table that is explicitly meant to be private per owner.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN
ON public.leadership_report_drafts
FROM authenticated, anon;

-- anon has no legitimate application use for this table at all — unlike
-- executive_analyses/executive_analysis_versions (where is_admin() is
-- broadly executable, including by anon, so RLS alone safely narrows an
-- anonymous read to zero rows), this table's owner-private policy
-- references is_leadership_report_authorized(), which anon is deliberately
-- NOT granted EXECUTE on (see below) — so if anon retained its
-- default-privilege SELECT grant here, an anonymous SELECT would attempt to
-- evaluate that policy and fail with a confusing "permission denied for
-- function" rather than a clean, expected "permission denied for table".
-- Revoking anon's SELECT here closes that off at the correct, earlier
-- layer: the query is rejected before RLS/the policy function is ever
-- reached, and this table now grants anon nothing at all.
REVOKE SELECT
ON public.leadership_report_drafts
FROM anon;

-- ---------------------------------------------------------------------------
-- 6. save_leadership_report_draft — same client-facing signature (no owner
--    parameter exists or is added, so the uncommitted Phase 2C frontend
--    needs no signature-level change), owner now derived from auth.uid()
--    and written to the new column, upsert conflict target moved to
--    (owner_id, period_start_date). ATS validation and the source-week
--    match check are preserved byte-for-byte from the Phase 2B version.
-- ---------------------------------------------------------------------------
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

  -- Unchanged from Phase 2B: proves source_analysis_id is THIS reporting
  -- week's own ATS analysis, not merely some real analysis row.
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

-- Same anon-default-grant gap as is_leadership_report_authorized() above —
-- named explicitly rather than assuming PUBLIC-only revoke is sufficient.
REVOKE ALL ON FUNCTION public.save_leadership_report_draft(date, date, text, uuid, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.save_leadership_report_draft(date, date, text, uuid, text, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.save_leadership_report_draft(date, date, text, uuid, text, jsonb) TO authenticated;

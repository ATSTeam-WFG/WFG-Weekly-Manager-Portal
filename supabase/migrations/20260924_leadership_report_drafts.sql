-- Leadership Report Phase 2B — permanent, additive migration for the new
-- Save Draft persistence layer. Nothing here alters, replaces, or even
-- references any existing Executive Analysis object as a write target —
-- executive_analyses and executive_analysis_versions are read-only inputs
-- to one validation check inside the new RPC below, never written to.
--
-- This is the permanent, deployable file: no embedded self-test block, no
-- synthetic data, no simulated JWTs, no set_config/SET ROLE calls — mirrors
-- the style of the most recent prior migration
-- (20260923_executive_analysis_ats_shape.sql), which also ships with no
-- test block. The full BEGIN...ROLLBACK verification pass for everything
-- created here lives in the separate, non-migration companion file
-- supabase/leadership_report_drafts_rollback_test.sql — that file is meant
-- to be run FIRST, and leaves zero persisted trace either way, before this
-- file is ever applied for real.
--
-- Design lineage: Leadership Report Phase 2A investigation (verified live
-- Supabase findings: public.is_admin() STABLE/SECURITY DEFINER/
-- SET search_path='public', owned by postgres, true only for an
-- authenticated caller whose profiles row has role='admin' AND
-- is_active=true; both executive_analyses and executive_analysis_versions
-- have RLS enabled/not forced with exactly one permissive
-- USING (is_admin()) SELECT policy and no direct write policy;
-- authenticated has table SELECT only on both) plus the Phase 2B bullet-
-- limit precheck (src/components/AtsTopicsEditForm.tsx's own MAX_BULLETS=5
-- ceiling, already covered by src/lib/executiveAnalysisAtsShapeWiring.
-- test.ts, is the only editor that can ever produce this table's content —
-- so the 1-5 bullet bound below matches what that editor can structurally
-- submit, not an arbitrary separate limit).
--
-- Approved decisions baked into this file:
--   - No period_key column (Leadership Report is weekly-only; a column that
--     can only ever hold one value adds a constraint to maintain and a
--     compound unique key for no disambiguating benefit).
--   - source_analysis_id is NOT NULL — Phase 1's Save Draft control is only
--     ever reachable once a real ATS source exists for that week.
--   - A dedicated ATS-only validator (is_valid_leadership_report_content)
--     rather than reusing the shared, legacy-accepting
--     is_valid_executive_analysis_sections — a legacy 7-key object must be
--     rejected here, unlike at the Executive Analysis write path.
--   - The new RPC's EXECUTE grant is deliberately tighter than the existing
--     three Executive Analysis RPCs (authenticated only, no anon/
--     service_role) — a safer explicit default for this new function, not a
--     change to any existing grant.

-- ---------------------------------------------------------------------------
-- 1. Dedicated ATS-only content validator.
--
-- Byte-identical to the ATS branch of the existing
-- is_valid_executive_analysis_sections(jsonb) (see
-- supabase/migrations/20260923_executive_analysis_ats_shape.sql) with the
-- legacy-7-key OR-branch removed, so a legacy Executive Analysis object is
-- correctly rejected here. That existing function is not called, modified,
-- or referenced by this one.
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

-- ---------------------------------------------------------------------------
-- 2. leadership_report_drafts — one current draft per reporting week.
--
-- source_ats_fingerprint is a fingerprint of the actual ATS content
-- (openingParagraph + topics) the read-only source pane showed at the
-- moment Save Draft was clicked — deliberately NOT
-- executive_analyses.source_fingerprint, which hashes the underlying
-- manager-report inputs, not the AI's rendered ATS output, and would not
-- change across a regeneration that produces different ATS content from
-- the same inputs. The client-side helper that computes this value and the
-- staleness-warning UI that compares it are explicitly out of scope for
-- this migration (Phase 2C+).
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- 3. RLS — enabled, not forced, admin-only SELECT via the existing
--    is_admin(). No INSERT/UPDATE/DELETE policy at all: mirrors both
--    executive_analyses and executive_analysis_versions exactly (per Phase
--    2A's verified live findings), so every write must go through the
--    SECURITY DEFINER RPC below, which runs as its owner and is therefore
--    unaffected by RLS.
-- ---------------------------------------------------------------------------
ALTER TABLE public.leadership_report_drafts ENABLE ROW LEVEL SECURITY;

CREATE POLICY leadership_report_drafts_select_admin
  ON public.leadership_report_drafts
  FOR SELECT
  TO public
  USING (is_admin());

GRANT SELECT ON public.leadership_report_drafts TO authenticated;

-- The public schema's default privileges (ALTER DEFAULT PRIVILEGES,
-- confirmed live via pg_default_acl) automatically grant broad CRUD —
-- INSERT/UPDATE/DELETE included — to BOTH anon and authenticated on every
-- newly created table in this schema. The GRANT SELECT above is additive
-- only; it does not remove that automatic grant. Without this explicit
-- REVOKE, authenticated (and anon) would retain a raw write path directly
-- on this table, bypassing the RPC below entirely — RLS having no
-- INSERT/UPDATE/DELETE policy would reduce such a write to zero affected
-- rows, but the intended security model is that the write path does not
-- exist at all, not that it silently no-ops.
REVOKE INSERT, UPDATE, DELETE
ON public.leadership_report_drafts
FROM authenticated, anon;

-- ---------------------------------------------------------------------------
-- 4. save_leadership_report_draft — the only write path for this table.
--    A single upsert: INSERT on the first explicit save for a reporting
--    week, UPDATE on every subsequent save for that same week, via
--    ON CONFLICT (period_start_date). created_at/created_by are never
--    touched by the DO UPDATE branch, so they survive every later save;
--    only updated_at/updated_by move. There is no parameter through which a
--    caller can supply created_by/updated_by/timestamps — auth.uid() and
--    now() are the only sources. executive_analyses/
--    executive_analysis_versions are referenced here only to validate
--    source_analysis_id, never written to.
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
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'FORBIDDEN: Admin access is required.';
  END IF;

  IF NOT is_valid_leadership_report_content(p_content) THEN
    RAISE EXCEPTION 'INVALID_SECTIONS: Leadership Report content is not in the required ATS format.';
  END IF;

  -- Defense in depth: the FK on source_analysis_id only proves the id
  -- exists somewhere in executive_analyses, not that it's THIS reporting
  -- week's own row. A client bug or a bypassing direct call could otherwise
  -- attach one week's draft to a different week's ATS source.
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

-- Deliberately tighter than the existing three Executive Analysis RPCs
-- (which also grant to anon/service_role) — no existing function's grants
-- are touched. An anon caller could never pass is_admin() anyway (auth.uid()
-- is null with no JWT), so this is a safer explicit default, not a
-- functional requirement; nothing in this app calls this RPC with a
-- service_role key, so service_role needs no grant either.
REVOKE ALL ON FUNCTION public.save_leadership_report_draft(date, date, text, uuid, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_leadership_report_draft(date, date, text, uuid, text, jsonb) TO authenticated;

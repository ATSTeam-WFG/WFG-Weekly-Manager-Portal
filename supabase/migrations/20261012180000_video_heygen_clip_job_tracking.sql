-- Video Creation — duplicate-charge protection for generate_narration and
-- generate_avatar_video (the opening/closing talking-presenter clips).
--
-- WHY: unlike create_avatar (hardened by
-- 20261012140000_video_heygen_avatar_atomic_claim.sql), these two actions
-- currently have ZERO persistence and ZERO duplicate protection — nothing
-- in the database records that a narration or avatar-video job was ever
-- attempted, so:
--   - a timeout (generate_avatar_video can poll for up to ~20 minutes) is
--     still auto-retried once by the route's generic retry loop, which
--     could fire a second real, billed job if the first one actually
--     succeeded on HeyGen's side after we stopped waiting;
--   - clicking "Prepare clips" again (same session or a later one) would
--     silently regenerate and re-bill both scenes with no "already done"
--     check at all.
--
-- This migration adds ONE new table, keyed by (presenter_profile_id,
-- scene_id) — opening and closing get independent rows, independent
-- claims, independent recovery — exactly mirroring the already-tested
-- not_started/pending/ready/failed/uncertain state machine and atomic
-- UPDATE...WHERE...RETURNING claim pattern from the avatar-creation
-- migration, applied here to TWO stages (narration, then video) per scene.
--
-- Touches no other table, policy, or function. clone_voice and
-- create_avatar are completely untouched; this is purely additive.
--
-- NOT applied to any database by this change — this file is added to
-- supabase/migrations/ only; applying it (local test instance or
-- production) is a separate, deliberate step for whoever runs it.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. One row per (presenter_profile_id, scene_id) — e.g. one for "opening",
--    one for "closing". Two independent status columns because narration
--    and avatar-video are two independent HeyGen operations with two
--    independent failure/uncertainty windows; video_status can only ever
--    be claimed once narration_status = 'ready' (enforced by
--    claim_heygen_clip_video below, not by a CHECK constraint, since it's
--    a cross-column runtime rule rather than a static one).
-- ---------------------------------------------------------------------------
CREATE TABLE public.video_presenter_clip_jobs (
  id                           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  presenter_profile_id         uuid NOT NULL REFERENCES public.video_presenter_profiles(id),
  scene_id                     text NOT NULL CHECK (scene_id ~ '^[a-z0-9-]+$'),
  narration_status             text NOT NULL DEFAULT 'not_started' CHECK (narration_status IN ('not_started', 'pending', 'ready', 'failed', 'uncertain')),
  narration_audio_storage_path text,
  video_status                 text NOT NULL DEFAULT 'not_started' CHECK (video_status IN ('not_started', 'pending', 'ready', 'failed', 'uncertain')),
  provider_video_id            text,
  generated_storage_path       text,
  created_at                   timestamptz NOT NULL DEFAULT now(),
  updated_at                   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (presenter_profile_id, scene_id)
);

CREATE INDEX video_presenter_clip_jobs_profile_idx ON public.video_presenter_clip_jobs(presenter_profile_id);

ALTER TABLE public.video_presenter_clip_jobs ENABLE ROW LEVEL SECURITY;

-- Admin-only read (same convention as video_generation_usage_log — this is
-- operational/recovery state, not biometric media, so the narrower
-- "own media only" policy video_presenter_media uses doesn't apply here).
CREATE POLICY video_presenter_clip_jobs_select_admin
  ON public.video_presenter_clip_jobs FOR SELECT TO authenticated
  USING (is_admin());

-- No direct INSERT/UPDATE/DELETE policy at all — every write goes through
-- the SECURITY DEFINER functions below, matching every other provider-
-- tracking table in this schema.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN
ON public.video_presenter_clip_jobs FROM authenticated, anon;
REVOKE SELECT ON public.video_presenter_clip_jobs FROM anon;

-- ---------------------------------------------------------------------------
-- 2. claim_heygen_clip_narration — atomic UPSERT-claim. A plain
--    INSERT ... ON CONFLICT (...) DO UPDATE ... WHERE <condition> is
--    atomic with respect to the unique constraint: Postgres resolves the
--    conflict and applies (or skips) the UPDATE under the same row lock,
--    so two concurrent calls can't both see claimed = true, identical
--    guarantee to claim_heygen_avatar_creation's plain UPDATE, just
--    expressed as an upsert since no row may exist yet for this scene.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.claim_heygen_clip_narration(
  p_profile_id uuid,
  p_scene_id   text
)
RETURNS TABLE(claimed boolean, current_status text, current_audio_path text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status text;
  v_path   text;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'FORBIDDEN: Video Creation access is required.';
  END IF;

  IF p_scene_id !~ '^[a-z0-9-]+$' THEN
    RAISE EXCEPTION 'INVALID_REQUEST: Unrecognized scene id.';
  END IF;

  WITH upsert AS (
    INSERT INTO public.video_presenter_clip_jobs (presenter_profile_id, scene_id, narration_status)
    VALUES (p_profile_id, p_scene_id, 'pending')
    ON CONFLICT (presenter_profile_id, scene_id) DO UPDATE
      SET narration_status = 'pending', updated_at = now()
      WHERE public.video_presenter_clip_jobs.narration_status IN ('not_started', 'failed')
    RETURNING narration_status, narration_audio_storage_path
  )
  SELECT narration_status, narration_audio_storage_path INTO v_status, v_path FROM upsert;

  IF FOUND THEN
    RETURN QUERY SELECT true, v_status, v_path;
    RETURN;
  END IF;

  SELECT narration_status, narration_audio_storage_path INTO v_status, v_path
  FROM public.video_presenter_clip_jobs
  WHERE presenter_profile_id = p_profile_id AND scene_id = p_scene_id;

  -- Reachable only if the conflict path above somehow found no row despite
  -- a unique-constraint conflict firing — not expected, kept as a
  -- defensive guard rather than a silent wrong answer.
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: Clip job row could not be located after a claim conflict.';
  END IF;

  RETURN QUERY SELECT false, v_status, v_path;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_heygen_clip_narration(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_heygen_clip_narration(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.claim_heygen_clip_narration(uuid, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. claim_heygen_clip_video — same atomic pattern, plus the cross-stage
--    rule: video can only be claimed once narration_status = 'ready' for
--    this exact scene. Unlike narration, this never inserts a new row (one
--    must already exist with narration_status = 'ready' before video can
--    be attempted) — if none exists yet at all, that is reported as a
--    normal not_started/not_started result, not an error, so the route can
--    give one consistent "run generate_narration first" message.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.claim_heygen_clip_video(
  p_profile_id uuid,
  p_scene_id   text
)
RETURNS TABLE(claimed boolean, narration_status text, video_status text, narration_audio_path text, current_video_id text, current_storage_path text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_narration_status text;
  v_video_status     text;
  v_narration_path   text;
  v_video_id         text;
  v_storage_path     text;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'FORBIDDEN: Video Creation access is required.';
  END IF;

  -- Every column reference below is schema-qualified, including inside
  -- WHERE/SET — this function's OUT parameters (narration_status,
  -- video_status) share their names with real table columns, which
  -- Postgres would otherwise treat as ambiguous (confirmed: an unqualified
  -- reference here fails with "column reference ... is ambiguous" at
  -- runtime, caught via real execution against a local Postgres instance,
  -- not just static review).
  UPDATE public.video_presenter_clip_jobs
  SET video_status = 'pending', updated_at = now()
  WHERE video_presenter_clip_jobs.presenter_profile_id = p_profile_id
    AND video_presenter_clip_jobs.scene_id = p_scene_id
    AND video_presenter_clip_jobs.narration_status = 'ready'
    AND video_presenter_clip_jobs.video_status IN ('not_started', 'failed')
  RETURNING video_presenter_clip_jobs.narration_status, video_presenter_clip_jobs.video_status,
            narration_audio_storage_path, provider_video_id, generated_storage_path
  INTO v_narration_status, v_video_status, v_narration_path, v_video_id, v_storage_path;

  IF FOUND THEN
    RETURN QUERY SELECT true, v_narration_status, v_video_status, v_narration_path, v_video_id, v_storage_path;
    RETURN;
  END IF;

  SELECT video_presenter_clip_jobs.narration_status, video_presenter_clip_jobs.video_status,
         narration_audio_storage_path, provider_video_id, generated_storage_path
  INTO v_narration_status, v_video_status, v_narration_path, v_video_id, v_storage_path
  FROM public.video_presenter_clip_jobs
  WHERE presenter_profile_id = p_profile_id AND scene_id = p_scene_id;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'not_started'::text, 'not_started'::text, NULL::text, NULL::text, NULL::text;
    RETURN;
  END IF;

  RETURN QUERY SELECT false, v_narration_status, v_video_status, v_narration_path, v_video_id, v_storage_path;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_heygen_clip_video(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_heygen_clip_video(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.claim_heygen_clip_video(uuid, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. record_* — unconditionally record an outcome, exactly like
--    record_heygen_avatar_provider. Never decide authorization or claim
--    anything themselves.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_heygen_clip_narration(
  p_profile_id         uuid,
  p_scene_id           text,
  p_status             text,
  p_audio_storage_path text
)
RETURNS public.video_presenter_clip_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.video_presenter_clip_jobs;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'FORBIDDEN: Video Creation access is required.';
  END IF;

  IF p_status NOT IN ('not_started', 'pending', 'ready', 'failed', 'uncertain') THEN
    RAISE EXCEPTION 'INVALID_REQUEST: Unrecognized status.';
  END IF;

  UPDATE public.video_presenter_clip_jobs
  SET narration_status = p_status,
      narration_audio_storage_path = p_audio_storage_path,
      updated_at = now()
  WHERE presenter_profile_id = p_profile_id AND scene_id = p_scene_id
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: No clip job row exists for this profile/scene.';
  END IF;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.record_heygen_clip_narration(uuid, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_heygen_clip_narration(uuid, text, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.record_heygen_clip_narration(uuid, text, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.record_heygen_clip_video(
  p_profile_id             uuid,
  p_scene_id               text,
  p_status                 text,
  p_provider_video_id      text,
  p_generated_storage_path text
)
RETURNS public.video_presenter_clip_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.video_presenter_clip_jobs;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'FORBIDDEN: Video Creation access is required.';
  END IF;

  IF p_status NOT IN ('not_started', 'pending', 'ready', 'failed', 'uncertain') THEN
    RAISE EXCEPTION 'INVALID_REQUEST: Unrecognized status.';
  END IF;

  UPDATE public.video_presenter_clip_jobs
  SET video_status = p_status,
      provider_video_id = p_provider_video_id,
      generated_storage_path = p_generated_storage_path,
      updated_at = now()
  WHERE presenter_profile_id = p_profile_id AND scene_id = p_scene_id
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: No clip job row exists for this profile/scene.';
  END IF;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.record_heygen_clip_video(uuid, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_heygen_clip_video(uuid, text, text, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.record_heygen_clip_video(uuid, text, text, text, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 5. resolve_uncertain_heygen_clip — the only path out of 'uncertain' for
--    either stage, deliberately requiring a human decision after manually
--    checking HeyGen directly, exactly like
--    resolve_uncertain_heygen_avatar_status. Never automatic.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.resolve_uncertain_heygen_clip(
  p_profile_id             uuid,
  p_scene_id               text,
  p_stage                  text, -- 'narration' or 'video'
  p_resolution             text, -- 'confirmed_no_output' or 'confirmed_output_exists'
  p_audio_storage_path     text DEFAULT NULL,
  p_provider_video_id      text DEFAULT NULL,
  p_generated_storage_path text DEFAULT NULL
)
RETURNS public.video_presenter_clip_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.video_presenter_clip_jobs;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'FORBIDDEN: Video Creation access is required.';
  END IF;

  IF p_stage NOT IN ('narration', 'video') THEN
    RAISE EXCEPTION 'INVALID_REQUEST: Unrecognized stage.';
  END IF;

  IF p_resolution NOT IN ('confirmed_no_output', 'confirmed_output_exists') THEN
    RAISE EXCEPTION 'INVALID_REQUEST: Unrecognized resolution.';
  END IF;

  IF p_stage = 'narration' THEN
    IF p_resolution = 'confirmed_output_exists' AND p_audio_storage_path IS NULL THEN
      RAISE EXCEPTION 'INVALID_REQUEST: audio_storage_path is required when confirming output exists.';
    END IF;

    UPDATE public.video_presenter_clip_jobs
    SET narration_status = CASE WHEN p_resolution = 'confirmed_no_output' THEN 'not_started' ELSE 'ready' END,
        narration_audio_storage_path = CASE WHEN p_resolution = 'confirmed_output_exists' THEN p_audio_storage_path ELSE narration_audio_storage_path END,
        updated_at = now()
    WHERE presenter_profile_id = p_profile_id AND scene_id = p_scene_id AND narration_status = 'uncertain'
    RETURNING * INTO v_row;
  ELSE
    IF p_resolution = 'confirmed_output_exists' AND (p_provider_video_id IS NULL OR p_generated_storage_path IS NULL) THEN
      RAISE EXCEPTION 'INVALID_REQUEST: provider_video_id and generated_storage_path are required when confirming output exists.';
    END IF;

    UPDATE public.video_presenter_clip_jobs
    SET video_status = CASE WHEN p_resolution = 'confirmed_no_output' THEN 'not_started' ELSE 'ready' END,
        provider_video_id = CASE WHEN p_resolution = 'confirmed_output_exists' THEN p_provider_video_id ELSE provider_video_id END,
        generated_storage_path = CASE WHEN p_resolution = 'confirmed_output_exists' THEN p_generated_storage_path ELSE generated_storage_path END,
        updated_at = now()
    WHERE presenter_profile_id = p_profile_id AND scene_id = p_scene_id AND video_status = 'uncertain'
    RETURNING * INTO v_row;
  END IF;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVALID_STATE: This clip job stage is not currently uncertain.';
  END IF;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_uncertain_heygen_clip(uuid, text, text, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.resolve_uncertain_heygen_clip(uuid, text, text, text, text, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.resolve_uncertain_heygen_clip(uuid, text, text, text, text, text, text) TO authenticated;

COMMIT;

-- ---------------------------------------------------------------------------
-- ROLLBACK (manual, for Supabase Studio's SQL editor — not run
-- automatically by anything). Wrapped in one explicit transaction, same
-- all-or-nothing reason as the forward migration above. Purely additive
-- forward migration, so rollback is a clean drop — no prior behavior to
-- restore for these functions/table, unlike the avatar-claim migration's
-- own rollback note.
--
-- BEGIN;
--   DROP FUNCTION IF EXISTS public.resolve_uncertain_heygen_clip(uuid, text, text, text, text, text, text);
--   DROP FUNCTION IF EXISTS public.record_heygen_clip_video(uuid, text, text, text, text);
--   DROP FUNCTION IF EXISTS public.record_heygen_clip_narration(uuid, text, text, text);
--   DROP FUNCTION IF EXISTS public.claim_heygen_clip_video(uuid, text);
--   DROP FUNCTION IF EXISTS public.claim_heygen_clip_narration(uuid, text);
--   DROP TABLE IF EXISTS public.video_presenter_clip_jobs;
-- COMMIT;
-- ---------------------------------------------------------------------------

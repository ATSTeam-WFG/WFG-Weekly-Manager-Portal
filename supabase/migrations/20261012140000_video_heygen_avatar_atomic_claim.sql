-- Video Creation — atomic claim for photo-avatar creation.
--
-- WHY: api/video/presenter/authorize-generation.ts's create_avatar branch
-- already re-reads heygen_provider_status live and writes 'pending' before
-- calling HeyGen (see that file's own comments), but a plain
-- SELECT-then-UPDATE from application code cannot close a true race: two
-- genuinely simultaneous requests could both read 'not_started' before
-- either write commits, and both go on to call HeyGen — a second,
-- separately billed avatar. This migration adds the one primitive that
-- actually closes that: a single atomic UPDATE ... WHERE ... RETURNING,
-- wrapped in a SECURITY DEFINER function.
--
-- ALSO: distinguishes a DEFINITE provider rejection ('failed' — HeyGen
-- itself confirmed, via a completed job, that no usable avatar exists, or
-- we never even reached HeyGen due to missing configuration) from an
-- UNCERTAIN outcome ('uncertain' — a timeout or request-level error where
-- HeyGen's real side effect is unknown, e.g. the create call may have
-- succeeded but our own status poll never got a definitive answer). Only
-- 'not_started' and 'failed' are claimable again automatically;
-- 'uncertain' deliberately is not — clearing it requires a separate,
-- explicit admin action (resolve_uncertain_heygen_avatar_status below)
-- after manually checking HeyGen's own dashboard/API for this profile.
--
-- Purely additive to the existing video_presenter_profiles table and
-- record_heygen_avatar_provider function (widened, not replaced in
-- behavior for any value it already accepted). Touches no other table,
-- policy, or function — clone_voice, generate_narration,
-- generate_avatar_video, and the ElevenLabs fallback path are completely
-- untouched; none of them use this claim mechanism.
--
-- NOT applied to any database by this change — this file is added to
-- supabase/migrations/ only; applying it (local test instance or
-- production) is a separate, deliberate step for whoever runs it.
--
-- HOSTED-SPECIFIC NOTE (confirmed via a live, read-only schema check on
-- 2026-10-12): record_heygen_avatar_provider does NOT currently exist on
-- the hosted project — 20261008_video_presenter_consent_provider_tracking.sql
-- (the migration that originally defined it) was never applied there, even
-- though the columns it operates on already exist on the base table. This
-- migration's own CREATE OR REPLACE below will therefore CREATE that
-- function for the first time on hosted, not just widen it — see the
-- ROLLBACK section's own note on what this means for undoing that part.
--
-- Wrapped in one explicit transaction so Supabase Studio's SQL editor (or
-- any other client) rolls back EVERY statement below if any one of them
-- fails partway through — not just relying on a client's own implicit
-- multi-statement batching behavior.
BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Widen the status vocabulary. A column-level CHECK constraint can't be
--    altered in place, so the existing one is located dynamically (rather
--    than assuming its auto-generated name) and replaced with an
--    equivalent constraint plus the one new value. No existing row is
--    affected — none currently holds a value this drops support for.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_constraint_name text;
BEGIN
  -- Matched by column name + its known literal values rather than one
  -- exact rendering of the constraint expression — Postgres rewrites a
  -- column-level `IN (...)` into `= ANY (ARRAY[...])` with casts that vary
  -- slightly by version, so pinning to one exact substring would be
  -- fragile. 'not_started'/'failed' are also valid values of the sibling
  -- heygen_voice_provider_status column's own CHECK constraint, so that
  -- one is excluded explicitly rather than relied on to not match.
  SELECT con.conname INTO v_constraint_name
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
  WHERE nsp.nspname = 'public'
    AND rel.relname = 'video_presenter_profiles'
    AND con.contype = 'c'
    AND pg_get_constraintdef(con.oid) LIKE '%heygen_provider_status%'
    AND pg_get_constraintdef(con.oid) LIKE '%not_started%'
    AND pg_get_constraintdef(con.oid) LIKE '%failed%'
    AND pg_get_constraintdef(con.oid) NOT LIKE '%voice%';

  IF v_constraint_name IS NULL THEN
    RAISE EXCEPTION 'Could not find the existing CHECK constraint on video_presenter_profiles.heygen_provider_status to replace — aborting rather than guessing.';
  END IF;

  EXECUTE format('ALTER TABLE public.video_presenter_profiles DROP CONSTRAINT %I', v_constraint_name);
END $$;

ALTER TABLE public.video_presenter_profiles
  ADD CONSTRAINT video_presenter_profiles_heygen_provider_status_check
  CHECK (heygen_provider_status IN ('not_started', 'pending', 'ready', 'failed', 'uncertain'));

-- ---------------------------------------------------------------------------
-- 2. record_heygen_avatar_provider: widen its own status validation to
--    match (it re-validates independently of the table's own CHECK
--    constraint, so both must agree). Same signature, same behavior for
--    every status it already accepted — CREATE OR REPLACE, not a drop.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_heygen_avatar_provider(
  p_profile_id          uuid,
  p_provider_avatar_id  text,
  p_status              text
)
RETURNS public.video_presenter_profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile public.video_presenter_profiles;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'FORBIDDEN: Video Creation access is required.';
  END IF;

  IF p_status NOT IN ('not_started', 'pending', 'ready', 'failed', 'uncertain') THEN
    RAISE EXCEPTION 'INVALID_REQUEST: Unrecognized provider status.';
  END IF;

  UPDATE public.video_presenter_profiles
  SET heygen_avatar_provider_id = p_provider_avatar_id,
      heygen_provider_status = p_status,
      updated_at = now()
  WHERE id = p_profile_id
  RETURNING * INTO v_profile;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: Presenter profile does not exist.';
  END IF;

  RETURN v_profile;
END;
$$;

-- Grants are unchanged from the original migration (CREATE OR REPLACE
-- preserves them in Postgres, but restated here for clarity/defensiveness
-- against a differently-provisioned target database).
REVOKE ALL ON FUNCTION public.record_heygen_avatar_provider(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_heygen_avatar_provider(uuid, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.record_heygen_avatar_provider(uuid, text, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. The atomic claim itself. A single UPDATE ... WHERE ... RETURNING:
--    Postgres takes the row lock as soon as this UPDATE targets the row.
--    Under the default READ COMMITTED isolation, a second, concurrent call
--    targeting the same row blocks until the first transaction commits,
--    then RE-EVALUATES its own WHERE clause against the now-committed row
--    — which no longer matches once the first UPDATE has set status to
--    'pending'. So at most one caller can ever see claimed = true for a
--    given not_started/failed row, even under true concurrent requests —
--    the one guarantee a SELECT-then-UPDATE from application code cannot
--    provide on its own.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.claim_heygen_avatar_creation(
  p_profile_id uuid
)
RETURNS TABLE(claimed boolean, current_status text, current_avatar_provider_id text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status      text;
  v_provider_id text;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'FORBIDDEN: Video Creation access is required.';
  END IF;

  UPDATE public.video_presenter_profiles
  SET heygen_provider_status = 'pending',
      updated_at = now()
  WHERE id = p_profile_id
    AND heygen_provider_status IN ('not_started', 'failed')
  RETURNING heygen_provider_status, heygen_avatar_provider_id INTO v_status, v_provider_id;

  IF FOUND THEN
    RETURN QUERY SELECT true, v_status, v_provider_id;
    RETURN;
  END IF;

  SELECT heygen_provider_status, heygen_avatar_provider_id INTO v_status, v_provider_id
  FROM public.video_presenter_profiles
  WHERE id = p_profile_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: Presenter profile does not exist.';
  END IF;

  RETURN QUERY SELECT false, v_status, v_provider_id;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_heygen_avatar_creation(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_heygen_avatar_creation(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.claim_heygen_avatar_creation(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. The only path out of 'uncertain' — deliberately separate from the
--    claim function above, and deliberately requiring a human decision.
--    An uncertain outcome must never become claimable again on its own;
--    an admin who has manually checked HeyGen's own dashboard/API for this
--    profile calls this once, saying which of the two possible real-world
--    outcomes actually happened.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.resolve_uncertain_heygen_avatar_status(
  p_profile_id          uuid,
  p_resolution          text, -- 'confirmed_no_avatar' or 'confirmed_avatar_exists'
  p_provider_avatar_id  text DEFAULT NULL
)
RETURNS public.video_presenter_profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile public.video_presenter_profiles;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'FORBIDDEN: Video Creation access is required.';
  END IF;

  IF p_resolution NOT IN ('confirmed_no_avatar', 'confirmed_avatar_exists') THEN
    RAISE EXCEPTION 'INVALID_REQUEST: Unrecognized resolution.';
  END IF;

  IF p_resolution = 'confirmed_avatar_exists' AND p_provider_avatar_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_REQUEST: provider_avatar_id is required when confirming an avatar exists.';
  END IF;

  UPDATE public.video_presenter_profiles
  SET heygen_provider_status = CASE WHEN p_resolution = 'confirmed_no_avatar' THEN 'not_started' ELSE 'ready' END,
      heygen_avatar_provider_id = CASE WHEN p_resolution = 'confirmed_avatar_exists' THEN p_provider_avatar_id ELSE heygen_avatar_provider_id END,
      updated_at = now()
  WHERE id = p_profile_id
    AND heygen_provider_status = 'uncertain'
  RETURNING * INTO v_profile;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVALID_STATE: Presenter profile is not currently in an uncertain avatar state.';
  END IF;

  RETURN v_profile;
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_uncertain_heygen_avatar_status(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.resolve_uncertain_heygen_avatar_status(uuid, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.resolve_uncertain_heygen_avatar_status(uuid, text, text) TO authenticated;

COMMIT;

-- ---------------------------------------------------------------------------
-- ROLLBACK (manual, for Supabase Studio's SQL editor — not run automatically
-- by anything). Also wrapped in one explicit transaction, for the same
-- all-or-nothing reason as the forward migration above.
--
-- IMPORTANT — read before running, specifically for hosted: as of
-- 2026-10-12, record_heygen_avatar_provider did NOT exist on hosted before
-- this migration (see the hosted-specific note near the top of this file).
-- This migration's forward direction CREATED it for the first time. A
-- rollback therefore has a real choice to make about that one function,
-- not just a mechanical reversal:
--
--   Option A (RECOMMENDED) — leave record_heygen_avatar_provider in place,
--   just with its original narrower status validation restored. This is
--   what 20261008_video_presenter_consent_provider_tracking.sql would have
--   created had it ever been applied on its own. Leaving it in place keeps
--   the EXISTING create_avatar route code (which already calls this RPC
--   to record a 'ready'/'failed' outcome, independent of anything added by
--   this migration) working. Dropping it instead would silently reopen
--   that pre-existing gap: a real HeyGen avatar call could succeed and be
--   billed while the follow-up DB write throws "function does not exist".
--
--   Option B — DROP FUNCTION IF EXISTS public.record_heygen_avatar_provider(uuid, text, text);
--   restores the literal pre-migration state on hosted (function absent).
--   Only do this if you specifically want that gap back, e.g. because a
--   separate, deliberate decision was made to apply
--   20261008_video_presenter_consent_provider_tracking.sql itself instead.
--
-- The SQL below implements Option A. Swap in Option B's single DROP
-- statement in its place if that is what you actually want.
--
-- BEGIN;
--
--   DROP FUNCTION IF EXISTS public.resolve_uncertain_heygen_avatar_status(uuid, text, text);
--   DROP FUNCTION IF EXISTS public.claim_heygen_avatar_creation(uuid);
--
--   -- Only safe once no row is actually 'uncertain' (an 'uncertain' row
--   -- would otherwise violate the narrower, restored constraint below):
--   UPDATE public.video_presenter_profiles SET heygen_provider_status = 'failed' WHERE heygen_provider_status = 'uncertain';
--
--   ALTER TABLE public.video_presenter_profiles DROP CONSTRAINT video_presenter_profiles_heygen_provider_status_check;
--   ALTER TABLE public.video_presenter_profiles
--     ADD CONSTRAINT video_presenter_profiles_heygen_provider_status_check
--     CHECK (heygen_provider_status IN ('not_started', 'pending', 'ready', 'failed'));
--
--   -- Option A: restores record_heygen_avatar_provider's narrower
--   -- validation (the exact body from
--   -- 20261008_video_presenter_consent_provider_tracking.sql) without
--   -- removing the function itself.
--   CREATE OR REPLACE FUNCTION public.record_heygen_avatar_provider(
--     p_profile_id uuid, p_provider_avatar_id text, p_status text
--   ) RETURNS public.video_presenter_profiles LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
--   DECLARE v_profile public.video_presenter_profiles;
--   BEGIN
--     IF NOT is_admin() THEN RAISE EXCEPTION 'FORBIDDEN: Video Creation access is required.'; END IF;
--     IF p_status NOT IN ('not_started', 'pending', 'ready', 'failed') THEN RAISE EXCEPTION 'INVALID_REQUEST: Unrecognized provider status.'; END IF;
--     UPDATE public.video_presenter_profiles SET heygen_avatar_provider_id = p_provider_avatar_id, heygen_provider_status = p_status, updated_at = now()
--       WHERE id = p_profile_id RETURNING * INTO v_profile;
--     IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND: Presenter profile does not exist.'; END IF;
--     RETURN v_profile;
--   END; $$;
--
-- COMMIT;
-- ---------------------------------------------------------------------------

-- Video Creation — HeyGen-only voice integration (see the Oct 2026 HeyGen
-- API research: Instant Voice Clone, confirmed against official
-- developers.heygen.com docs, meets every requirement a separate
-- ElevenLabs integration was carrying — same cloned voice works for both
-- standalone narration AND avatar-video lip-sync via one voice_id).
--
-- Purely additive, mirroring 20261008_video_presenter_consent_provider_tracking.sql's
-- existing heygen_avatar_provider_id/elevenlabs_voice_provider_id pattern
-- exactly: a new, independent pair of columns plus one new "record the
-- outcome" RPC. Touches no existing column, table, policy or function —
-- the ElevenLabs columns/RPC stay exactly as they are, kept as a fallback
-- per explicit instruction, not removed.
--
-- NOT applied to any database by this change — this file is added to
-- supabase/migrations/ only; applying it (local test instance or
-- production) is a separate, deliberate step for whoever runs it.

ALTER TABLE public.video_presenter_profiles
  ADD COLUMN heygen_voice_provider_id text,
  ADD COLUMN heygen_voice_provider_status text NOT NULL DEFAULT 'not_started'
    CHECK (heygen_voice_provider_status IN ('not_started', 'pending', 'ready', 'failed'));

CREATE OR REPLACE FUNCTION public.record_heygen_voice_provider(
  p_profile_id          uuid,
  p_provider_voice_id   text,
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

  IF p_status NOT IN ('not_started', 'pending', 'ready', 'failed') THEN
    RAISE EXCEPTION 'INVALID_REQUEST: Unrecognized provider status.';
  END IF;

  UPDATE public.video_presenter_profiles
  SET heygen_voice_provider_id = p_provider_voice_id,
      heygen_voice_provider_status = p_status,
      updated_at = now()
  WHERE id = p_profile_id
  RETURNING * INTO v_profile;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: Presenter profile does not exist.';
  END IF;

  RETURN v_profile;
END;
$$;

REVOKE ALL ON FUNCTION public.record_heygen_voice_provider(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_heygen_voice_provider(uuid, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.record_heygen_voice_provider(uuid, text, text) TO authenticated;

-- authorize_video_generation() and the audit log
-- (video_generation_usage_log) already accept/record p_provider = 'heygen'
-- for ANY action — neither one branches on provider at all, only on
-- consent state — so clone_voice/generate_narration against HeyGen are
-- already fully gated and audited with ZERO changes to either. Confirmed
-- by re-reading both functions in 20261008_video_presenter_consent.sql
-- before writing this file.

-- Video Creation — Photo Avatar + Cloned Voice: records the result of a
-- real (or stubbed) HeyGen/ElevenLabs provider call back onto the
-- presenter profile. Companion to 20261008_video_presenter_consent.sql —
-- purely additive, touches no existing table/column/policy/function from
-- either prior migration.
--
-- Both RPCs here are "record the outcome", never "decide whether to
-- call" — that decision is, and remains, entirely
-- authorize_video_generation()'s. By the time either of these runs, the
-- real provider call has ALREADY happened (or been attempted) under an
-- authorize_video_generation() check performed immediately before it —
-- these functions are not an authorization gate and must never be treated
-- as one.

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

  IF p_status NOT IN ('not_started', 'pending', 'ready', 'failed') THEN
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

REVOKE ALL ON FUNCTION public.record_heygen_avatar_provider(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_heygen_avatar_provider(uuid, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.record_heygen_avatar_provider(uuid, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.record_elevenlabs_voice_provider(
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
  SET elevenlabs_voice_provider_id = p_provider_voice_id,
      elevenlabs_provider_status = p_status,
      updated_at = now()
  WHERE id = p_profile_id
  RETURNING * INTO v_profile;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: Presenter profile does not exist.';
  END IF;

  RETURN v_profile;
END;
$$;

REVOKE ALL ON FUNCTION public.record_elevenlabs_voice_provider(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_elevenlabs_voice_provider(uuid, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.record_elevenlabs_voice_provider(uuid, text, text) TO authenticated;

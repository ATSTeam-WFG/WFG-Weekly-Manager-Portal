-- Video Creation — Photo Avatar + Cloned Voice consent workflow.
--
-- Adds the minimal secure data model behind the approved consent flow:
-- upload a presenter photo + an authorized voice sample, identify whether
-- the subject is the authenticated uploader or another WFG portal user,
-- present explicit unchecked consent confirmations (rights, synthetic
-- authorization, stated purpose, third-party disclosure), and only ever
-- allow a paid HeyGen/ElevenLabs generation call once server-side
-- verification independently confirms both the photo and the voice are
-- under CURRENTLY VERIFIED, non-revoked, non-expired consent.
--
-- This migration creates tables/functions/policies/storage config ONLY —
-- it authorizes nothing by itself (every new table starts empty) and it
-- does not modify profiles, approved_employees, leadership_report_*,
-- executive_analyses, weekly report tables, or any existing RLS policy or
-- function. is_admin() (already live in this project, used unmodified
-- throughout — see e.g. 20260924_leadership_report_drafts.sql's own header)
-- is reused as-is, never redefined here.
--
-- Core design decisions (see the implementation report for the full
-- rationale):
--  1. Consent policy TEXT lives in exactly one place — this migration's
--     own video_consent_policy_versions table — never hardcoded in the
--     client or passed in from a request body. Every confirmation screen
--     fetches the CURRENT version live; every consent record stamps a
--     verbatim snapshot of whatever version was current AT THE MOMENT OF
--     DECISION, so a later legal-text change can never retroactively alter
--     what an earlier consent says it agreed to, and a stale cached
--     frontend can never create a record claiming a wrong version's text.
--  2. A consent about ANOTHER person (subject_profile_id <> the uploading
--     admin) is never authorized by the uploader alone. It is created in
--     'pending_subject_confirmation' and only the NAMED SUBJECT's own
--     authenticated session (never an admin, never any other account) can
--     move it to 'verified', via confirm_subject_media_consent — this is
--     the "direct verifiable subject authorization" requirement. A subject
--     who is not an existing WFG portal profile cannot be authorized at
--     all today (there is no identity to grant auth.uid()-backed
--     confirmation to) — the application layer must require picking an
--     existing portal user as the subject; this migration enforces it
--     structurally by requiring subject_profile_id to reference profiles.
--  3. Revocation is immediate and reaches generation authorization without
--     any caching: revoke_media_consent flips the consent AND cascades to
--     every presenter profile referencing it in the same transaction, and
--     presenter_profile_is_authorized() / authorize_video_generation()
--     always re-read live state — nothing about "authorized" is ever
--     cached, stored as a trusted boolean, or accepted from a caller.
--  4. authorize_video_generation() is the ONE required gate before any
--     future real HeyGen/ElevenLabs call: it is SECURITY DEFINER,
--     re-verifies authorization from scratch (including subject-identity
--     and active-policy-version binding — see item 12's own header),
--     writes an audit row to video_generation_usage_log on EVERY call
--     (authorized or denied, with a specific denial reason), and RETURNS
--     authorized=false on denial — it deliberately does NOT raise for a
--     denial outcome, so the audit row is never rolled back alongside an
--     exception (see item 12's header for the full durability fix
--     rationale). The calling server route treats authorized=false as
--     blocking and never proceeds to a provider call. It never reads any
--     client-supplied "I have consent" flag of any kind.
--  5. The consent expiry period is configurable (video_consent_settings /
--     get_consent_expiry_interval() / set_consent_expiry_interval()),
--     never a hardcoded literal — a legal/compliance decision, not a
--     constant baked into application code.

-- ---------------------------------------------------------------------------
-- 0. Private Storage bucket for source photos and voice recordings. Not a
--    public bucket; no public-read policy is ever added. Only this
--    migration's own admin-gated Storage policies (below) grant any access
--    to it. file_size_limit is enforced by Storage itself (defense in
--    depth alongside the RPC-level checks on video_presenter_media).
-- ---------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'video-presenter-media',
  'video-presenter-media',
  false,
  20971520, -- 20 MB per object
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'audio/webm', 'audio/wav', 'audio/x-wav', 'audio/mpeg', 'audio/mp4', 'audio/x-m4a']
)
ON CONFLICT (id) DO NOTHING;

-- Admin-only on every operation. Video Creation (the only surface that
-- ever touches this bucket) is itself admin-gated at the routing layer;
-- this makes that gate real at the data layer too, independent of the
-- React route. A named subject who is not an admin never needs to touch
-- Storage directly — their part of the flow (confirming/rejecting/
-- revoking) only ever reads/writes video_media_consents, which carries no
-- binary data.
CREATE POLICY video_presenter_media_storage_admin_select
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'video-presenter-media' AND is_admin());

CREATE POLICY video_presenter_media_storage_admin_insert
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'video-presenter-media' AND is_admin());

CREATE POLICY video_presenter_media_storage_admin_update
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'video-presenter-media' AND is_admin())
  WITH CHECK (bucket_id = 'video-presenter-media' AND is_admin());

CREATE POLICY video_presenter_media_storage_admin_delete
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'video-presenter-media' AND is_admin());

-- ---------------------------------------------------------------------------
-- 1. Consent policy text — single source of truth. Version 1 seeded below;
--    a future legal-copy change is a new INSERT with version = 2, never an
--    UPDATE of an existing version's row (old consent records must keep
--    pointing at the exact text they actually agreed to).
-- ---------------------------------------------------------------------------
CREATE TABLE public.video_consent_policy_versions (
  version               integer PRIMARY KEY,
  statements            jsonb NOT NULL,
  purpose               text NOT NULL,
  provider_disclosure   text NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.video_consent_policy_versions (version, statements, purpose, provider_disclosure)
VALUES (
  1,
  '[
    {"key": "rights_to_media", "text": "I have the legal right to use this photo and/or voice recording, and I am authorized to grant WFG permission to use it as described below."},
    {"key": "synthetic_authorization", "text": "I authorize WFG to use this photo and voice recording to create a synthetic AI avatar and a cloned voice in my likeness."},
    {"key": "stated_purpose", "text": "I understand this synthetic avatar and cloned voice will be used only to present WFG weekly leadership reporting videos, and for no other purpose without further consent."},
    {"key": "third_party_disclosure", "text": "I understand this photo and voice recording will be processed by third-party AI providers (currently HeyGen for the photo avatar and ElevenLabs for the cloned voice) to generate the synthetic media, subject to those providers'' own data retention and deletion practices."}
  ]'::jsonb,
  'WFG weekly leadership reporting video presentation',
  'Photo and voice data is sent to HeyGen (photo avatar generation) and ElevenLabs (voice cloning) for processing. Review each provider''s own data retention and deletion policy before relying on this consent for other purposes.'
)
ON CONFLICT (version) DO NOTHING;

ALTER TABLE public.video_consent_policy_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY video_consent_policy_versions_select_authenticated
  ON public.video_consent_policy_versions FOR SELECT TO authenticated
  USING (true);

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN
ON public.video_consent_policy_versions FROM authenticated, anon;
REVOKE SELECT ON public.video_consent_policy_versions FROM anon;

CREATE OR REPLACE FUNCTION public.get_current_consent_policy()
RETURNS public.video_consent_policy_versions
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT * FROM public.video_consent_policy_versions ORDER BY version DESC LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_current_consent_policy() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_current_consent_policy() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_current_consent_policy() TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. video_presenter_media — file metadata only (storage_path points into
--    the private bucket above; no public URL is ever stored or derivable
--    here). subject_profile_id is NOT NULL and FK'd to profiles — a
--    subject with no WFG portal account cannot be represented at all,
--    which is the intended, honest limitation (see header note 2).
-- ---------------------------------------------------------------------------
CREATE TABLE public.video_presenter_media (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  uploader_id          uuid NOT NULL REFERENCES public.profiles(id),
  subject_profile_id   uuid NOT NULL REFERENCES public.profiles(id),
  media_type           text NOT NULL CHECK (media_type IN ('photo', 'voice_sample')),
  storage_path         text NOT NULL,
  mime_type            text NOT NULL,
  byte_size            bigint NOT NULL CHECK (byte_size > 0 AND byte_size <= 20971520),
  original_filename    text,
  created_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX video_presenter_media_subject_idx ON public.video_presenter_media(subject_profile_id);

ALTER TABLE public.video_presenter_media ENABLE ROW LEVEL SECURITY;

-- Least-privilege on purpose: this is metadata about literal biometric
-- source files (a face photo, a voice recording). Even admins who did not
-- request or are not the subject of a given upload cannot read its row —
-- narrower than this project's usual is_admin()-sees-everything default,
-- a deliberate exception for this one table.
CREATE POLICY video_presenter_media_select_own
  ON public.video_presenter_media FOR SELECT TO authenticated
  USING (uploader_id = auth.uid() OR subject_profile_id = auth.uid());

-- No INSERT/UPDATE/DELETE policy at all — every write goes through
-- request_presenter_media_consent() below (SECURITY DEFINER), matching
-- this project's established save_leadership_report_draft() convention.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN
ON public.video_presenter_media FROM authenticated, anon;
REVOKE SELECT ON public.video_presenter_media FROM anon;

-- ---------------------------------------------------------------------------
-- 3. video_media_consents — one row per consent DECISION for one media
--    row. A resubmission (e.g. after a rejection) creates a NEW media +
--    consent pair rather than mutating this one — this table is
--    append-only except for the specific status-transition columns
--    (confirmed_at/rejected_at/revoked_at and their *_by columns), all of
--    which are only ever written by the SECURITY DEFINER functions below,
--    never directly by any client.
-- ---------------------------------------------------------------------------
CREATE TABLE public.video_media_consents (
  id                                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  media_id                           uuid NOT NULL REFERENCES public.video_presenter_media(id),
  subject_profile_id                 uuid NOT NULL REFERENCES public.profiles(id),
  requested_by                       uuid NOT NULL REFERENCES public.profiles(id),
  policy_version                     integer NOT NULL REFERENCES public.video_consent_policy_versions(version),
  consent_statements                 jsonb NOT NULL,
  rights_confirmed                   boolean NOT NULL,
  synthetic_authorization_confirmed  boolean NOT NULL,
  purpose_confirmed                  boolean NOT NULL,
  disclosure_acknowledged            boolean NOT NULL,
  verification_method                text NOT NULL CHECK (verification_method IN ('self_attestation', 'subject_self_confirmation')),
  status                             text NOT NULL CHECK (status IN ('pending_subject_confirmation', 'verified', 'rejected', 'revoked', 'expired')),
  confirmed_by                       uuid REFERENCES public.profiles(id),
  confirmed_at                       timestamptz,
  rejected_at                        timestamptz,
  revoked_at                         timestamptz,
  revoked_by                         uuid REFERENCES public.profiles(id),
  expires_at                         timestamptz,
  created_at                         timestamptz NOT NULL DEFAULT now(),
  -- Every confirmation must be explicitly true for the row to exist at all
  -- — matches "explicit, unchecked consent confirmations", never a
  -- default-true/implicit value either at the UI or here.
  CONSTRAINT video_media_consents_all_confirmed CHECK (
    rights_confirmed AND synthetic_authorization_confirmed AND purpose_confirmed AND disclosure_acknowledged
  )
);

CREATE INDEX video_media_consents_media_idx ON public.video_media_consents(media_id);
CREATE INDEX video_media_consents_subject_idx ON public.video_media_consents(subject_profile_id);

ALTER TABLE public.video_media_consents ENABLE ROW LEVEL SECURITY;

-- Admins CAN see consent workflow status (no biometric bytes live here) —
-- unlike video_presenter_media above, this is a deliberate, narrower
-- exception back to the project's normal is_admin()-sees-everything
-- default, needed for compliance/ops visibility into pending/revoked
-- requests.
CREATE POLICY video_media_consents_select_own_or_admin
  ON public.video_media_consents FOR SELECT TO authenticated
  USING (subject_profile_id = auth.uid() OR requested_by = auth.uid() OR is_admin());

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN
ON public.video_media_consents FROM authenticated, anon;
REVOKE SELECT ON public.video_media_consents FROM anon;

-- ---------------------------------------------------------------------------
-- 4. video_presenter_profiles — the reusable named Photo Avatar + Cloned
--    Voice profile that generation actually references. `status` is a
--    display-only cache, recomputed on every write here, but NEVER trusted
--    by authorize_video_generation() below, which always recomputes live
--    from the referenced consent rows' real current state instead.
-- ---------------------------------------------------------------------------
CREATE TABLE public.video_presenter_profiles (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id                    uuid NOT NULL REFERENCES public.profiles(id),
  display_name                text NOT NULL,
  photo_media_id              uuid REFERENCES public.video_presenter_media(id),
  photo_consent_id            uuid REFERENCES public.video_media_consents(id),
  voice_media_id              uuid REFERENCES public.video_presenter_media(id),
  voice_consent_id            uuid REFERENCES public.video_media_consents(id),
  heygen_avatar_provider_id   text,
  heygen_provider_status      text NOT NULL DEFAULT 'not_started' CHECK (heygen_provider_status IN ('not_started', 'pending', 'ready', 'failed')),
  elevenlabs_voice_provider_id text,
  elevenlabs_provider_status  text NOT NULL DEFAULT 'not_started' CHECK (elevenlabs_provider_status IN ('not_started', 'pending', 'ready', 'failed')),
  status                      text NOT NULL DEFAULT 'incomplete' CHECK (status IN ('incomplete', 'ready', 'revoked')),
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX video_presenter_profiles_owner_idx ON public.video_presenter_profiles(owner_id);

ALTER TABLE public.video_presenter_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY video_presenter_profiles_select_own_or_admin
  ON public.video_presenter_profiles FOR SELECT TO authenticated
  USING (owner_id = auth.uid() OR is_admin());

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN
ON public.video_presenter_profiles FROM authenticated, anon;
REVOKE SELECT ON public.video_presenter_profiles FROM anon;

-- ---------------------------------------------------------------------------
-- 5. video_generation_usage_log — append-only audit trail. Every call to
--    authorize_video_generation() writes exactly one row here, whether it
--    authorizes or denies. Admin-only read; no update/delete policy at
--    all, by design (an audit log is never edited).
-- ---------------------------------------------------------------------------
CREATE TABLE public.video_generation_usage_log (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  presenter_profile_id        uuid NOT NULL REFERENCES public.video_presenter_profiles(id),
  requested_by                uuid NOT NULL REFERENCES public.profiles(id),
  provider                    text NOT NULL CHECK (provider IN ('heygen', 'elevenlabs')),
  action                      text NOT NULL,
  authorization_check_result  text NOT NULL CHECK (authorization_check_result IN (
    'authorized', 'denied_missing_photo_consent', 'denied_missing_voice_consent',
    'denied_photo_not_verified', 'denied_voice_not_verified',
    'denied_photo_expired', 'denied_voice_expired', 'denied_profile_revoked',
    'denied_subject_mismatch', 'denied_photo_policy_outdated', 'denied_voice_policy_outdated'
  )),
  denial_reason               text,
  provider_request_ref        text,
  created_at                  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX video_generation_usage_log_profile_idx ON public.video_generation_usage_log(presenter_profile_id);

ALTER TABLE public.video_generation_usage_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY video_generation_usage_log_select_admin
  ON public.video_generation_usage_log FOR SELECT TO authenticated
  USING (is_admin());

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN
ON public.video_generation_usage_log FROM authenticated, anon;
REVOKE SELECT ON public.video_generation_usage_log FROM anon;

-- ---------------------------------------------------------------------------
-- 5B. video_consent_settings — a single-row configuration table so the
--     consent expiry period is a reviewable, changeable value rather than
--     a literal hardcoded in two separate functions (hardening pass
--     finding: the original version hardcoded `interval '1 year'` in both
--     request_presenter_media_consent and confirm_subject_media_consent).
--     Admin-only read; writes only via set_consent_expiry_interval() below.
-- ---------------------------------------------------------------------------
CREATE TABLE public.video_consent_settings (
  id                        boolean PRIMARY KEY DEFAULT true CHECK (id),
  consent_expiry_interval   interval NOT NULL DEFAULT interval '1 year',
  updated_at                timestamptz NOT NULL DEFAULT now(),
  updated_by                uuid REFERENCES public.profiles(id)
);

INSERT INTO public.video_consent_settings (id) VALUES (true) ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.video_consent_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY video_consent_settings_select_admin
  ON public.video_consent_settings FOR SELECT TO authenticated
  USING (is_admin());

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN
ON public.video_consent_settings FROM authenticated, anon;
REVOKE SELECT ON public.video_consent_settings FROM anon;

CREATE OR REPLACE FUNCTION public.get_consent_expiry_interval()
RETURNS interval
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT consent_expiry_interval FROM public.video_consent_settings WHERE id = true;
$$;

REVOKE ALL ON FUNCTION public.get_consent_expiry_interval() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_consent_expiry_interval() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_consent_expiry_interval() TO authenticated;

-- Admin-only. A caller-supplied interval is bounded to a sane range
-- (1 day .. 10 years) so a typo (e.g. accidentally passing seconds instead
-- of an interval) can't silently disable expiry altogether or expire
-- everything instantly.
CREATE OR REPLACE FUNCTION public.set_consent_expiry_interval(p_interval interval)
RETURNS public.video_consent_settings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result public.video_consent_settings;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'FORBIDDEN: Video Creation access is required.';
  END IF;

  IF p_interval < interval '1 day' OR p_interval > interval '10 years' THEN
    RAISE EXCEPTION 'INVALID_REQUEST: Consent expiry interval must be between 1 day and 10 years.';
  END IF;

  UPDATE public.video_consent_settings
  SET consent_expiry_interval = p_interval, updated_at = now(), updated_by = auth.uid()
  WHERE id = true
  RETURNING * INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.set_consent_expiry_interval(interval) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_consent_expiry_interval(interval) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_consent_expiry_interval(interval) TO authenticated;

-- ---------------------------------------------------------------------------
-- 6. request_presenter_media_consent — the ONLY way a video_presenter_media
--    + video_media_consents pair is created. Admin-only (mirrors Video
--    Creation's existing admin-only gate at the data layer). Re-validates
--    mime_type/byte_size itself (defense in depth alongside the Storage
--    bucket's own file_size_limit/allowed_mime_types) and requires all
--    four confirmations to be explicitly true — never defaults, never
--    partial.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.request_presenter_media_consent(
  p_subject_profile_id                 uuid,
  p_media_type                         text,
  p_storage_path                       text,
  p_mime_type                          text,
  p_byte_size                          bigint,
  p_original_filename                  text,
  p_rights_confirmed                   boolean,
  p_synthetic_authorization_confirmed  boolean,
  p_purpose_confirmed                  boolean,
  p_disclosure_acknowledged            boolean
)
RETURNS public.video_media_consents
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller  uuid := auth.uid();
  v_policy  public.video_consent_policy_versions;
  v_media   public.video_presenter_media;
  v_consent public.video_media_consents;
  v_status  text;
  v_method  text;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'FORBIDDEN: Video Creation access is required.';
  END IF;

  IF NOT (p_rights_confirmed AND p_synthetic_authorization_confirmed AND p_purpose_confirmed AND p_disclosure_acknowledged) THEN
    RAISE EXCEPTION 'INCOMPLETE_CONSENT: All four consent confirmations must be explicitly agreed to.';
  END IF;

  IF p_media_type NOT IN ('photo', 'voice_sample') THEN
    RAISE EXCEPTION 'INVALID_REQUEST: Unrecognized media type.';
  END IF;

  IF p_byte_size <= 0 OR p_byte_size > 20971520 THEN
    RAISE EXCEPTION 'INVALID_REQUEST: File size is outside the allowed range.';
  END IF;

  IF p_media_type = 'photo' AND p_mime_type NOT IN ('image/jpeg', 'image/png', 'image/webp') THEN
    RAISE EXCEPTION 'INVALID_REQUEST: Unsupported photo format.';
  END IF;

  IF p_media_type = 'voice_sample' AND p_mime_type NOT IN ('audio/webm', 'audio/wav', 'audio/x-wav', 'audio/mpeg', 'audio/mp4', 'audio/x-m4a') THEN
    RAISE EXCEPTION 'INVALID_REQUEST: Unsupported audio format.';
  END IF;

  SELECT * INTO v_policy FROM public.get_current_consent_policy();

  INSERT INTO public.video_presenter_media (
    uploader_id, subject_profile_id, media_type, storage_path, mime_type, byte_size, original_filename
  ) VALUES (
    v_caller, p_subject_profile_id, p_media_type, p_storage_path, p_mime_type, p_byte_size, p_original_filename
  )
  RETURNING * INTO v_media;

  IF p_subject_profile_id = v_caller THEN
    -- Self case: the authenticated account IS the subject — a direct
    -- first-person confirmation, verified immediately.
    v_status := 'verified';
    v_method := 'self_attestation';
  ELSE
    -- Another person's likeness/voice: never authorized by the uploader
    -- alone. Awaits that person's own confirm_subject_media_consent call.
    v_status := 'pending_subject_confirmation';
    v_method := 'subject_self_confirmation';
  END IF;

  INSERT INTO public.video_media_consents (
    media_id, subject_profile_id, requested_by, policy_version, consent_statements,
    rights_confirmed, synthetic_authorization_confirmed, purpose_confirmed, disclosure_acknowledged,
    verification_method, status, confirmed_by, confirmed_at, expires_at
  ) VALUES (
    v_media.id, p_subject_profile_id, v_caller, v_policy.version, v_policy.statements,
    true, true, true, true,
    v_method, v_status,
    CASE WHEN v_status = 'verified' THEN v_caller ELSE NULL END,
    CASE WHEN v_status = 'verified' THEN now() ELSE NULL END,
    CASE WHEN v_status = 'verified' THEN now() + get_consent_expiry_interval() ELSE NULL END
  )
  RETURNING * INTO v_consent;

  RETURN v_consent;
END;
$$;

REVOKE ALL ON FUNCTION public.request_presenter_media_consent(uuid, text, text, text, bigint, text, boolean, boolean, boolean, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.request_presenter_media_consent(uuid, text, text, text, bigint, text, boolean, boolean, boolean, boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.request_presenter_media_consent(uuid, text, text, text, bigint, text, boolean, boolean, boolean, boolean) TO authenticated;

-- ---------------------------------------------------------------------------
-- 7. confirm_subject_media_consent — the ONLY path that can move a
--    'pending_subject_confirmation' row to 'verified'. Callable by ANY
--    authenticated user (a named subject may not be an admin), but the
--    function itself — never a client-supplied flag — enforces that the
--    caller IS the row's own subject_profile_id. Re-fetches the CURRENT
--    policy at confirmation time (the subject is the one actually granting
--    authorization over their own likeness, so they see and agree to
--    whatever text is live right now, not a stale snapshot from whenever
--    the request was created).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.confirm_subject_media_consent(
  p_consent_id                         uuid,
  p_rights_confirmed                   boolean,
  p_synthetic_authorization_confirmed  boolean,
  p_purpose_confirmed                  boolean,
  p_disclosure_acknowledged            boolean
)
RETURNS public.video_media_consents
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller  uuid := auth.uid();
  v_policy  public.video_consent_policy_versions;
  v_consent public.video_media_consents;
BEGIN
  SELECT * INTO v_consent FROM public.video_media_consents WHERE id = p_consent_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: Consent request does not exist.';
  END IF;

  IF v_consent.subject_profile_id <> v_caller THEN
    RAISE EXCEPTION 'FORBIDDEN: Only the named subject may confirm this consent.';
  END IF;

  IF v_consent.status <> 'pending_subject_confirmation' THEN
    RAISE EXCEPTION 'INVALID_STATE: This consent request is no longer pending confirmation.';
  END IF;

  IF NOT (p_rights_confirmed AND p_synthetic_authorization_confirmed AND p_purpose_confirmed AND p_disclosure_acknowledged) THEN
    RAISE EXCEPTION 'INCOMPLETE_CONSENT: All four consent confirmations must be explicitly agreed to.';
  END IF;

  SELECT * INTO v_policy FROM public.get_current_consent_policy();

  UPDATE public.video_media_consents
  SET status = 'verified',
      confirmed_by = v_caller,
      confirmed_at = now(),
      expires_at = now() + get_consent_expiry_interval(),
      policy_version = v_policy.version,
      consent_statements = v_policy.statements
  WHERE id = p_consent_id
  RETURNING * INTO v_consent;

  RETURN v_consent;
END;
$$;

REVOKE ALL ON FUNCTION public.confirm_subject_media_consent(uuid, boolean, boolean, boolean, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.confirm_subject_media_consent(uuid, boolean, boolean, boolean, boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.confirm_subject_media_consent(uuid, boolean, boolean, boolean, boolean) TO authenticated;

-- ---------------------------------------------------------------------------
-- 8. reject_subject_media_consent — the named subject declining a pending
--    request about them. Subject-only, same identity enforcement as above.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reject_subject_media_consent(p_consent_id uuid)
RETURNS public.video_media_consents
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller  uuid := auth.uid();
  v_consent public.video_media_consents;
BEGIN
  SELECT * INTO v_consent FROM public.video_media_consents WHERE id = p_consent_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: Consent request does not exist.';
  END IF;

  IF v_consent.subject_profile_id <> v_caller THEN
    RAISE EXCEPTION 'FORBIDDEN: Only the named subject may reject this consent.';
  END IF;

  IF v_consent.status <> 'pending_subject_confirmation' THEN
    RAISE EXCEPTION 'INVALID_STATE: This consent request is no longer pending confirmation.';
  END IF;

  UPDATE public.video_media_consents
  SET status = 'rejected', rejected_at = now()
  WHERE id = p_consent_id
  RETURNING * INTO v_consent;

  RETURN v_consent;
END;
$$;

REVOKE ALL ON FUNCTION public.reject_subject_media_consent(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reject_subject_media_consent(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.reject_subject_media_consent(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 9. revoke_media_consent — callable by the subject themselves (always,
--    regardless of role) or by an admin (compliance takedown). Cascades
--    immediately to every presenter profile referencing this consent, in
--    the SAME transaction, so a revoked consent can never be used for a
--    generation call that happens to run a moment later.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.revoke_media_consent(p_consent_id uuid)
RETURNS public.video_media_consents
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller  uuid := auth.uid();
  v_consent public.video_media_consents;
BEGIN
  SELECT * INTO v_consent FROM public.video_media_consents WHERE id = p_consent_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: Consent record does not exist.';
  END IF;

  IF v_consent.subject_profile_id <> v_caller AND NOT is_admin() THEN
    RAISE EXCEPTION 'FORBIDDEN: Only the subject or an admin may revoke this consent.';
  END IF;

  UPDATE public.video_media_consents
  SET status = 'revoked', revoked_at = now(), revoked_by = v_caller
  WHERE id = p_consent_id
  RETURNING * INTO v_consent;

  -- Immediate effect: any presenter profile built on this consent stops
  -- being usable for generation right now, not on its next recomputation.
  UPDATE public.video_presenter_profiles
  SET status = 'revoked', updated_at = now()
  WHERE photo_consent_id = p_consent_id OR voice_consent_id = p_consent_id;

  RETURN v_consent;
END;
$$;

REVOKE ALL ON FUNCTION public.revoke_media_consent(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.revoke_media_consent(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.revoke_media_consent(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 10. create_or_update_presenter_profile — admin-only. Links one verified
--     photo consent + one verified voice consent (from the SAME subject)
--     into one reusable presenter profile. Does not itself grant
--     generation authorization — that is always decided live by
--     presenter_profile_is_authorized()/authorize_video_generation() below,
--     never by this function's own status snapshot.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_or_update_presenter_profile(
  p_profile_id       uuid,
  p_display_name     text,
  p_photo_consent_id uuid,
  p_voice_consent_id uuid
)
RETURNS public.video_presenter_profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_photo   public.video_media_consents;
  v_voice   public.video_media_consents;
  v_profile public.video_presenter_profiles;
  v_status  text;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'FORBIDDEN: Video Creation access is required.';
  END IF;

  SELECT * INTO v_photo FROM public.video_media_consents WHERE id = p_photo_consent_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: Photo consent does not exist.';
  END IF;

  SELECT * INTO v_voice FROM public.video_media_consents WHERE id = p_voice_consent_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: Voice consent does not exist.';
  END IF;

  IF v_photo.subject_profile_id <> v_voice.subject_profile_id THEN
    RAISE EXCEPTION 'INVALID_REQUEST: The photo and voice consent must be for the same subject.';
  END IF;

  v_status := CASE
    WHEN v_photo.status = 'verified' AND v_voice.status = 'verified'
      AND (v_photo.expires_at IS NULL OR v_photo.expires_at > now())
      AND (v_voice.expires_at IS NULL OR v_voice.expires_at > now())
      AND v_photo.policy_version = (SELECT version FROM public.get_current_consent_policy())
      AND v_voice.policy_version = (SELECT version FROM public.get_current_consent_policy())
    THEN 'ready'
    ELSE 'incomplete'
  END;

  IF p_profile_id IS NULL THEN
    INSERT INTO public.video_presenter_profiles (
      owner_id, display_name, photo_media_id, photo_consent_id, voice_media_id, voice_consent_id, status
    ) VALUES (
      v_photo.subject_profile_id, p_display_name, v_photo.media_id, p_photo_consent_id, v_voice.media_id, p_voice_consent_id, v_status
    )
    RETURNING * INTO v_profile;
  ELSE
    UPDATE public.video_presenter_profiles
    SET display_name = p_display_name,
        photo_media_id = v_photo.media_id,
        photo_consent_id = p_photo_consent_id,
        voice_media_id = v_voice.media_id,
        voice_consent_id = p_voice_consent_id,
        status = v_status,
        updated_at = now()
    WHERE id = p_profile_id
    RETURNING * INTO v_profile;
  END IF;

  RETURN v_profile;
END;
$$;

REVOKE ALL ON FUNCTION public.create_or_update_presenter_profile(uuid, text, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_or_update_presenter_profile(uuid, text, uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_or_update_presenter_profile(uuid, text, uuid, uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 11. presenter_profile_is_authorized — the live authorization check.
--     Deliberately a single, small, STABLE function so there is exactly
--     one place in the whole system that answers "can this profile be used
--     for generation right now" — never duplicated, never cached.
--
--     Hardening pass additions (see the implementation report item 2):
--      - subject-identity binding: the photo consent, the voice consent,
--        and the profile's own owner_id must all name the SAME subject.
--        create_or_update_presenter_profile already enforces this at LINK
--        time, but this is re-verified here, live, at AUTHORIZATION time —
--        defense in depth against any future code path that could
--        otherwise decouple them.
--      - active policy version binding: both consents must have been
--        agreed under the CURRENT consent policy version, not merely
--        "verified" under some earlier (possibly superseded) version. A
--        policy-version bump (e.g. updated legal text) immediately
--        suspends every existing presenter profile for generation until
--        each subject re-confirms under the new text.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.presenter_profile_is_authorized(p_profile_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    p.photo_consent_id IS NOT NULL
    AND p.voice_consent_id IS NOT NULL
    AND p.status <> 'revoked'
    AND pc.subject_profile_id = vc.subject_profile_id
    AND pc.subject_profile_id = p.owner_id
    AND pc.status = 'verified' AND (pc.expires_at IS NULL OR pc.expires_at > now())
    AND vc.status = 'verified' AND (vc.expires_at IS NULL OR vc.expires_at > now())
    AND pc.policy_version = (SELECT version FROM public.get_current_consent_policy())
    AND vc.policy_version = (SELECT version FROM public.get_current_consent_policy())
  FROM public.video_presenter_profiles p
  LEFT JOIN public.video_media_consents pc ON pc.id = p.photo_consent_id
  LEFT JOIN public.video_media_consents vc ON vc.id = p.voice_consent_id
  WHERE p.id = p_profile_id;
$$;

REVOKE ALL ON FUNCTION public.presenter_profile_is_authorized(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.presenter_profile_is_authorized(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.presenter_profile_is_authorized(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 12. authorize_video_generation — the required gate before ANY future
--     real HeyGen/ElevenLabs call. Admin-only (Video Creation's own gate).
--     Always writes exactly one audit row, authorized or not. Never reads
--     any client-supplied consent/authorization flag — only this
--     function's own live re-derivation of the specific denial reason.
--
--     HARDENING PASS FIX (item 1 — audit durability): the original version
--     of this function INSERTed the audit row and then, on denial, called
--     RAISE EXCEPTION in the SAME statement/transaction with no exception
--     handler or savepoint in between. In PL/pgSQL, an uncaught exception
--     unwinds (rolls back) every data change made earlier in that same
--     function invocation — so the INSERT into video_generation_usage_log
--     was SILENTLY ROLLED BACK ALONGSIDE the RAISE for every single denied
--     attempt. Denied attempts — the exact rows an auditor most needs to
--     see — were never durably recorded. Verified by direct inspection of
--     PL/pgSQL's transaction semantics; no live database was available in
--     this environment to additionally reproduce it empirically (see the
--     implementation report's non-production test plan for how to do so).
--
--     FIX: this function no longer RAISEs for a consent-based denial. It
--     RETURNS a (authorized, check_result) row instead, and the INSERT
--     commits normally as part of the function's own successful (non-
--     exception) completion — exactly like any other successful write.
--     The calling server route (api/video/presenter/authorize-generation.ts)
--     is responsible for rejecting the request when authorized = false;
--     it never proceeds to a provider call in that case. RAISE EXCEPTION is
--     still used for genuine caller errors (not an admin, unrecognized
--     provider, presenter profile does not exist) — none of these have a
--     meaningful audit row to write (there is no valid, specific consent
--     decision to record), so no durability concern applies to them.
--
--     Hardening pass additions (items 2/6): also denies (and logs) a
--     subject-identity mismatch between the linked photo/voice consents
--     and the profile's own owner, and a consent whose policy_version is
--     no longer the current one — mirroring presenter_profile_is_authorized()
--     exactly so the two can never silently disagree.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.authorize_video_generation(
  p_presenter_profile_id uuid,
  p_provider             text,
  p_action               text
)
RETURNS TABLE(authorized boolean, check_result text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller       uuid := auth.uid();
  v_profile      public.video_presenter_profiles;
  v_photo        public.video_media_consents;
  v_voice        public.video_media_consents;
  v_current_policy_version integer;
  v_result       text;
  v_reason       text;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'FORBIDDEN: Video Creation access is required.';
  END IF;

  IF p_provider NOT IN ('heygen', 'elevenlabs') THEN
    RAISE EXCEPTION 'INVALID_REQUEST: Unrecognized provider.';
  END IF;

  SELECT * INTO v_profile FROM public.video_presenter_profiles WHERE id = p_presenter_profile_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: Presenter profile does not exist.';
  END IF;

  SELECT version INTO v_current_policy_version FROM public.get_current_consent_policy();

  IF v_profile.photo_consent_id IS NULL THEN
    v_result := 'denied_missing_photo_consent';
  ELSIF v_profile.voice_consent_id IS NULL THEN
    v_result := 'denied_missing_voice_consent';
  ELSE
    SELECT * INTO v_photo FROM public.video_media_consents WHERE id = v_profile.photo_consent_id;
    SELECT * INTO v_voice FROM public.video_media_consents WHERE id = v_profile.voice_consent_id;

    IF v_photo.subject_profile_id <> v_voice.subject_profile_id OR v_photo.subject_profile_id <> v_profile.owner_id THEN
      -- Structurally should be unreachable (create_or_update_presenter_profile
      -- enforces same-subject linking at write time) — re-verified live
      -- here anyway, since generation must never run against a profile
      -- whose photo/voice/owner identities have somehow diverged.
      v_result := 'denied_subject_mismatch';
    ELSIF v_photo.status = 'revoked' OR v_voice.status = 'revoked' OR v_profile.status = 'revoked' THEN
      v_result := 'denied_profile_revoked';
    ELSIF v_photo.status <> 'verified' THEN
      v_result := 'denied_photo_not_verified';
    ELSIF v_voice.status <> 'verified' THEN
      v_result := 'denied_voice_not_verified';
    ELSIF v_photo.expires_at IS NOT NULL AND v_photo.expires_at <= now() THEN
      v_result := 'denied_photo_expired';
    ELSIF v_voice.expires_at IS NOT NULL AND v_voice.expires_at <= now() THEN
      v_result := 'denied_voice_expired';
    ELSIF v_photo.policy_version <> v_current_policy_version THEN
      v_result := 'denied_photo_policy_outdated';
    ELSIF v_voice.policy_version <> v_current_policy_version THEN
      v_result := 'denied_voice_policy_outdated';
    ELSE
      v_result := 'authorized';
    END IF;
  END IF;

  IF v_result <> 'authorized' THEN
    v_reason := 'Generation denied: ' || v_result;
  END IF;

  -- No RAISE follows this INSERT on any path below — the row commits as
  -- part of this function's own normal, successful completion regardless
  -- of whether v_result is 'authorized' or a denial code. This is the
  -- durability fix itself; see this function's own header above.
  INSERT INTO public.video_generation_usage_log (
    presenter_profile_id, requested_by, provider, action, authorization_check_result, denial_reason
  ) VALUES (
    p_presenter_profile_id, v_caller, p_provider, p_action, v_result, v_reason
  );

  RETURN QUERY SELECT (v_result = 'authorized'), v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.authorize_video_generation(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.authorize_video_generation(uuid, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.authorize_video_generation(uuid, text, text) TO authenticated;

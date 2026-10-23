-- Video Creation — consent policy version 2: accurately discloses HeyGen
-- as the processor for BOTH the photo avatar AND the cloned voice, now
-- that voice cloning has moved to HeyGen's Instant Voice Clone (see
-- 20261009120000_video_heygen_voice_provider.sql). ElevenLabs is kept named as
-- an available fallback path, per explicit instruction not to remove it,
-- rather than erased from the disclosure.
--
-- Per 20261008_video_presenter_consent.sql's own header comment: "a future
-- legal-copy change is a new INSERT with version = 2, never an UPDATE of
-- an existing version's row" — version 1's row is untouched below, so any
-- consent already recorded against it keeps pointing at the exact text it
-- actually agreed to. get_current_consent_policy() picks the highest
-- version automatically (ORDER BY version DESC LIMIT 1), so this INSERT
-- alone is enough to make version 2 "current" — no other function changes.
--
-- REAL CONSEQUENCE (by design, not a bug — see authorize_video_generation()'s
-- own policy_version check): every presenter profile with a consent
-- recorded under version 1 becomes immediately unusable for generation
-- (denied_photo_policy_outdated / denied_voice_policy_outdated) until each
-- subject re-confirms under this new text.
--
-- NOT applied to any database by this change — see this migration
-- directory's own convention (and the explicit instruction for this
-- phase): adding the file is not the same as running it.

INSERT INTO public.video_consent_policy_versions (version, statements, purpose, provider_disclosure)
VALUES (
  2,
  '[
    {"key": "rights_to_media", "text": "I have the legal right to use this photo and/or voice recording, and I am authorized to grant WFG permission to use it as described below."},
    {"key": "synthetic_authorization", "text": "I authorize WFG to use this photo and voice recording to create a synthetic AI avatar and a cloned voice in my likeness."},
    {"key": "stated_purpose", "text": "I understand this synthetic avatar and cloned voice will be used only to present WFG weekly leadership reporting videos, and for no other purpose without further consent."},
    {"key": "third_party_disclosure", "text": "I understand this photo and voice recording will be processed by a third-party AI provider (currently HeyGen, for both the photo avatar and the cloned voice; ElevenLabs may be used instead for the cloned voice) to generate the synthetic media, subject to that provider''s own data retention and deletion practices."}
  ]'::jsonb,
  'WFG weekly leadership reporting video presentation',
  'Photo and voice data is sent to HeyGen for processing (photo avatar generation and, as of this policy version, voice cloning). ElevenLabs may be used instead for voice cloning. Review the applicable provider''s own data retention and deletion policy before relying on this consent for other purposes.'
)
ON CONFLICT (version) DO NOTHING;

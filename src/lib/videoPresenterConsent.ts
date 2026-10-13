// Pure, side-effect-free types + authorization logic for the Photo Avatar
// + Cloned Voice consent workflow. Zero Supabase import here (compare
// src/lib/narrationVoices.ts's own reasoning for staying dependency-free) —
// videoConsentService.ts is the only module that actually talks to
// Supabase; this file is safe to import from any UI component or test.
//
// IMPORTANT: evaluatePresenterProfileAuthorization() below is a CLIENT-SIDE
// DISPLAY HELPER ONLY — it mirrors supabase/migrations/20261008_video_presenter_consent.sql's
// presenter_profile_is_authorized()/authorize_video_generation() denial-reason
// logic so the UI can show an accurate status without an extra round trip,
// but it is NEVER itself an authorization decision. The one and only real
// authorization check is the server-side authorize_video_generation() RPC,
// re-run fresh on every generation attempt — this function's result must
// never be passed to a generation call as if it were a server decision.

export type ConsentStatus = 'pending_subject_confirmation' | 'verified' | 'rejected' | 'revoked' | 'expired'

export type PresenterMediaType = 'photo' | 'voice_sample'

export type ConsentVerificationMethod = 'self_attestation' | 'subject_self_confirmation'

export interface ConsentStatement {
  key: string
  text: string
}

export interface ConsentPolicy {
  version: number
  statements: ConsentStatement[]
  purpose: string
  providerDisclosure: string
}

export interface ConsentConfirmations {
  rightsConfirmed: boolean
  syntheticAuthorizationConfirmed: boolean
  purposeConfirmed: boolean
  disclosureAcknowledged: boolean
}

export function allConfirmed(confirmations: ConsentConfirmations): boolean {
  return (
    confirmations.rightsConfirmed &&
    confirmations.syntheticAuthorizationConfirmed &&
    confirmations.purposeConfirmed &&
    confirmations.disclosureAcknowledged
  )
}

export interface PresenterMedia {
  id: string
  uploaderId: string
  subjectProfileId: string
  mediaType: PresenterMediaType
  storagePath: string
  mimeType: string
  byteSize: number
  originalFilename: string | null
  createdAt: string
}

export interface MediaConsent {
  id: string
  mediaId: string
  subjectProfileId: string
  requestedBy: string
  policyVersion: number
  consentStatements: ConsentStatement[]
  verificationMethod: ConsentVerificationMethod
  status: ConsentStatus
  confirmedBy: string | null
  confirmedAt: string | null
  rejectedAt: string | null
  revokedAt: string | null
  revokedBy: string | null
  expiresAt: string | null
  createdAt: string
}

export type ProviderStatus = 'not_started' | 'pending' | 'ready' | 'failed'

export interface PresenterProfile {
  id: string
  ownerId: string
  displayName: string
  photoMediaId: string | null
  photoConsentId: string | null
  voiceMediaId: string | null
  voiceConsentId: string | null
  heygenAvatarProviderId: string | null
  heygenProviderStatus: ProviderStatus
  heygenVoiceProviderId: string | null
  heygenVoiceProviderStatus: ProviderStatus
  elevenlabsVoiceProviderId: string | null
  elevenlabsProviderStatus: ProviderStatus
  status: 'incomplete' | 'ready' | 'revoked'
  createdAt: string
  updatedAt: string
}

export type GenerationDenialReason =
  | 'denied_missing_photo_consent'
  | 'denied_missing_voice_consent'
  | 'denied_subject_mismatch'
  | 'denied_photo_not_verified'
  | 'denied_voice_not_verified'
  | 'denied_photo_expired'
  | 'denied_voice_expired'
  | 'denied_photo_policy_outdated'
  | 'denied_voice_policy_outdated'
  | 'denied_profile_revoked'

export interface AuthorizationCheckResult {
  authorized: boolean
  reason?: GenerationDenialReason
}

function isConsentCurrentlyVerified(consent: MediaConsent | null, nowMs: number): boolean {
  if (!consent) return false
  if (consent.status !== 'verified') return false
  if (consent.expiresAt && Date.parse(consent.expiresAt) <= nowMs) return false
  return true
}

// Mirrors authorize_video_generation()'s own branch ORDER exactly:
// missing photo / missing voice / subject mismatch / revoked / not
// verified / expired / policy outdated — so the UI's displayed reason
// always matches what the server would say — see this file's own header
// for why this is a display mirror, never the real gate.
//
// `currentPolicyVersion` must come from a live get_current_consent_policy()
// read, never a hardcoded constant — a consent is only "authorized" if it
// was agreed under the version that is ACTUALLY current right now (see the
// hardening-pass report item 2: a policy-version bump immediately
// suspends every existing presenter profile until each subject
// re-confirms under the new text).
export function evaluatePresenterProfileAuthorization(
  profile: Pick<PresenterProfile, 'status' | 'ownerId' | 'photoConsentId' | 'voiceConsentId'>,
  photoConsent: MediaConsent | null,
  voiceConsent: MediaConsent | null,
  currentPolicyVersion: number,
  nowIso: string = new Date().toISOString(),
): AuthorizationCheckResult {
  const nowMs = Date.parse(nowIso)

  if (!profile.photoConsentId) {
    return { authorized: false, reason: 'denied_missing_photo_consent' }
  }
  if (!profile.voiceConsentId) {
    return { authorized: false, reason: 'denied_missing_voice_consent' }
  }
  if (photoConsent && voiceConsent && (photoConsent.subjectProfileId !== voiceConsent.subjectProfileId || photoConsent.subjectProfileId !== profile.ownerId)) {
    return { authorized: false, reason: 'denied_subject_mismatch' }
  }
  if (profile.status === 'revoked' || photoConsent?.status === 'revoked' || voiceConsent?.status === 'revoked') {
    return { authorized: false, reason: 'denied_profile_revoked' }
  }
  if (photoConsent?.status !== 'verified') {
    return { authorized: false, reason: 'denied_photo_not_verified' }
  }
  if (voiceConsent?.status !== 'verified') {
    return { authorized: false, reason: 'denied_voice_not_verified' }
  }
  if (photoConsent.expiresAt && Date.parse(photoConsent.expiresAt) <= nowMs) {
    return { authorized: false, reason: 'denied_photo_expired' }
  }
  if (voiceConsent.expiresAt && Date.parse(voiceConsent.expiresAt) <= nowMs) {
    return { authorized: false, reason: 'denied_voice_expired' }
  }
  if (photoConsent.policyVersion !== currentPolicyVersion) {
    return { authorized: false, reason: 'denied_photo_policy_outdated' }
  }
  if (voiceConsent.policyVersion !== currentPolicyVersion) {
    return { authorized: false, reason: 'denied_voice_policy_outdated' }
  }
  if (!isConsentCurrentlyVerified(photoConsent, nowMs) || !isConsentCurrentlyVerified(voiceConsent, nowMs)) {
    // Unreachable given the checks above, kept only as a defensive final
    // guard so this function can never return `authorized: true` without
    // both consents having passed the live verified-and-unexpired check.
    return { authorized: false, reason: 'denied_photo_not_verified' }
  }

  return { authorized: true }
}

export const GENERATION_DENIAL_MESSAGES: Record<GenerationDenialReason, string> = {
  denied_missing_photo_consent: 'A verified photo consent has not been linked to this presenter profile yet.',
  denied_missing_voice_consent: 'A verified voice consent has not been linked to this presenter profile yet.',
  denied_subject_mismatch: 'The linked photo and voice consent do not name the same person — this presenter profile cannot be used.',
  denied_photo_not_verified: 'The photo consent has not been verified yet.',
  denied_voice_not_verified: 'The voice consent has not been verified yet.',
  denied_photo_expired: 'The photo consent has expired and must be renewed.',
  denied_voice_expired: 'The voice consent has expired and must be renewed.',
  denied_photo_policy_outdated: 'The photo consent was agreed under an earlier version of the consent policy and must be re-confirmed.',
  denied_voice_policy_outdated: 'The voice consent was agreed under an earlier version of the consent policy and must be re-confirmed.',
  denied_profile_revoked: 'Consent for this presenter profile has been revoked.',
}

import { supabase } from './supabaseClient'
import type {
  ConsentPolicy,
  ConsentConfirmations,
  MediaConsent,
  PresenterMedia,
  PresenterMediaType,
  PresenterProfile,
  ProviderStatus,
  ConsentStatus,
  ConsentVerificationMethod,
} from './videoPresenterConsent'

// The ONLY module that talks to Supabase for the Photo Avatar + Cloned
// Voice consent workflow. Every write goes through a SECURITY DEFINER RPC
// (see supabase/migrations/20261008_video_presenter_consent.sql) — this
// file never issues a direct INSERT/UPDATE/DELETE against
// video_presenter_media/video_media_consents/video_presenter_profiles,
// matching this project's established leadershipReportDraftService.ts
// convention.

const BUCKET = 'video-presenter-media'

export class VideoConsentError extends Error {
  code: string
  constructor(code: string, message: string) {
    super(message)
    this.code = code
  }
}

// The RPCs raise 'CODE: message' — same convention as
// leadershipReportDraftService.ts's own parseRpcError.
function parseRpcError(message: string | undefined): VideoConsentError {
  const match = message?.match(/^([A-Z_]+):\s*(.*)$/)
  if (match) return new VideoConsentError(match[1], match[2])
  return new VideoConsentError('UNKNOWN', message ?? 'An unexpected error occurred.')
}

interface PolicyRow {
  version: number
  statements: Array<{ key: string; text: string }>
  purpose: string
  provider_disclosure: string
}

function policyFromRow(row: PolicyRow): ConsentPolicy {
  return { version: row.version, statements: row.statements, purpose: row.purpose, providerDisclosure: row.provider_disclosure }
}

export async function getCurrentConsentPolicy(): Promise<ConsentPolicy> {
  const { data, error } = await supabase.rpc('get_current_consent_policy')
  if (error) throw parseRpcError(error.message)
  return policyFromRow(data as PolicyRow)
}

interface MediaConsentRow {
  id: string
  media_id: string
  subject_profile_id: string
  requested_by: string
  policy_version: number
  consent_statements: Array<{ key: string; text: string }>
  verification_method: ConsentVerificationMethod
  status: ConsentStatus
  confirmed_by: string | null
  confirmed_at: string | null
  rejected_at: string | null
  revoked_at: string | null
  revoked_by: string | null
  expires_at: string | null
  created_at: string
}

function consentFromRow(row: MediaConsentRow): MediaConsent {
  return {
    id: row.id,
    mediaId: row.media_id,
    subjectProfileId: row.subject_profile_id,
    requestedBy: row.requested_by,
    policyVersion: row.policy_version,
    consentStatements: row.consent_statements,
    verificationMethod: row.verification_method,
    status: row.status,
    confirmedBy: row.confirmed_by,
    confirmedAt: row.confirmed_at,
    rejectedAt: row.rejected_at,
    revokedAt: row.revoked_at,
    revokedBy: row.revoked_by,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
  }
}

// Uploads directly to the private Storage bucket using the caller's own
// session (Storage RLS enforced — see the migration's admin-only storage
// policies) — the file's bytes never pass through a Vercel serverless
// function at all, avoiding any request-body size limit there. Returns the
// storage path to pass into requestPresenterMediaConsent.
export async function uploadPresenterMediaFile(
  file: File | Blob,
  subjectProfileId: string,
  mediaType: PresenterMediaType,
  extension: string,
): Promise<{ storagePath: string; mimeType: string; byteSize: number }> {
  const path = `${subjectProfileId}/${mediaType}/${crypto.randomUUID()}.${extension}`
  const mimeType = file.type || (mediaType === 'photo' ? 'image/jpeg' : 'audio/webm')
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, { contentType: mimeType, upsert: false })
  if (error) throw new VideoConsentError('UPLOAD_FAILED', error.message)
  return { storagePath: path, mimeType, byteSize: file.size }
}

// Private bucket — there is no public URL for this object.
// createSignedUrl() itself still enforces the bucket's Storage RLS SELECT
// policy for the calling session before it will mint anything (an admin
// who doesn't pass that check gets an error here, not a URL) — but the
// signed URL it returns is a short-lived BEARER token: anyone who obtains
// that exact link (e.g. from a browser history entry, a proxy/access log,
// or a copy-pasted URL) can use it without any further authentication
// until it expires. Kept as short as the UI can tolerate (60s, just long
// enough for the browser to load the preview it was requested for) rather
// than a longer default, specifically to minimize that exposure window —
// see the hardening-pass report's remaining-risks section for the
// residual risk this does not eliminate.
export async function getPresenterMediaPreviewUrl(storagePath: string): Promise<string> {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(storagePath, 60)
  if (error || !data) throw new VideoConsentError('PREVIEW_FAILED', error?.message ?? 'Could not create a preview link.')
  return data.signedUrl
}

export interface RequestPresenterMediaConsentInput {
  subjectProfileId: string
  mediaType: PresenterMediaType
  storagePath: string
  mimeType: string
  byteSize: number
  originalFilename: string | null
  confirmations: ConsentConfirmations
}

export async function requestPresenterMediaConsent(input: RequestPresenterMediaConsentInput): Promise<MediaConsent> {
  const { data, error } = await supabase.rpc('request_presenter_media_consent', {
    p_subject_profile_id: input.subjectProfileId,
    p_media_type: input.mediaType,
    p_storage_path: input.storagePath,
    p_mime_type: input.mimeType,
    p_byte_size: input.byteSize,
    p_original_filename: input.originalFilename,
    p_rights_confirmed: input.confirmations.rightsConfirmed,
    p_synthetic_authorization_confirmed: input.confirmations.syntheticAuthorizationConfirmed,
    p_purpose_confirmed: input.confirmations.purposeConfirmed,
    p_disclosure_acknowledged: input.confirmations.disclosureAcknowledged,
  })
  if (error) throw parseRpcError(error.message)
  return consentFromRow(data as MediaConsentRow)
}

export async function confirmSubjectMediaConsent(consentId: string, confirmations: ConsentConfirmations): Promise<MediaConsent> {
  const { data, error } = await supabase.rpc('confirm_subject_media_consent', {
    p_consent_id: consentId,
    p_rights_confirmed: confirmations.rightsConfirmed,
    p_synthetic_authorization_confirmed: confirmations.syntheticAuthorizationConfirmed,
    p_purpose_confirmed: confirmations.purposeConfirmed,
    p_disclosure_acknowledged: confirmations.disclosureAcknowledged,
  })
  if (error) throw parseRpcError(error.message)
  return consentFromRow(data as MediaConsentRow)
}

export async function rejectSubjectMediaConsent(consentId: string): Promise<MediaConsent> {
  const { data, error } = await supabase.rpc('reject_subject_media_consent', { p_consent_id: consentId })
  if (error) throw parseRpcError(error.message)
  return consentFromRow(data as MediaConsentRow)
}

export async function revokeMediaConsent(consentId: string): Promise<MediaConsent> {
  const { data, error } = await supabase.rpc('revoke_media_consent', { p_consent_id: consentId })
  if (error) throw parseRpcError(error.message)
  return consentFromRow(data as MediaConsentRow)
}

interface PresenterProfileRow {
  id: string
  owner_id: string
  display_name: string
  photo_media_id: string | null
  photo_consent_id: string | null
  voice_media_id: string | null
  voice_consent_id: string | null
  heygen_avatar_provider_id: string | null
  heygen_provider_status: ProviderStatus
  heygen_voice_provider_id: string | null
  heygen_voice_provider_status: ProviderStatus
  elevenlabs_voice_provider_id: string | null
  elevenlabs_provider_status: ProviderStatus
  status: 'incomplete' | 'ready' | 'revoked'
  created_at: string
  updated_at: string
}

function profileFromRow(row: PresenterProfileRow): PresenterProfile {
  return {
    id: row.id,
    ownerId: row.owner_id,
    displayName: row.display_name,
    photoMediaId: row.photo_media_id,
    photoConsentId: row.photo_consent_id,
    voiceMediaId: row.voice_media_id,
    voiceConsentId: row.voice_consent_id,
    heygenAvatarProviderId: row.heygen_avatar_provider_id,
    heygenProviderStatus: row.heygen_provider_status,
    heygenVoiceProviderId: row.heygen_voice_provider_id,
    heygenVoiceProviderStatus: row.heygen_voice_provider_status,
    elevenlabsVoiceProviderId: row.elevenlabs_voice_provider_id,
    elevenlabsProviderStatus: row.elevenlabs_provider_status,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export async function createOrUpdatePresenterProfile(
  profileId: string | null,
  displayName: string,
  photoConsentId: string,
  voiceConsentId: string,
): Promise<PresenterProfile> {
  const { data, error } = await supabase.rpc('create_or_update_presenter_profile', {
    p_profile_id: profileId,
    p_display_name: displayName,
    p_photo_consent_id: photoConsentId,
    p_voice_consent_id: voiceConsentId,
  })
  if (error) throw parseRpcError(error.message)
  return profileFromRow(data as PresenterProfileRow)
}

// Reads — RLS-scoped exactly like fetchPersistedAnalysis/the leadership
// report draft reads: the caller only ever receives rows they are already
// entitled to see (subject, requester, or admin for consents; owner or
// admin for profiles).
export async function listMyPendingConsentRequests(): Promise<MediaConsent[]> {
  const { data, error } = await supabase
    .from('video_media_consents')
    .select('*')
    .eq('status', 'pending_subject_confirmation')
    .order('created_at', { ascending: false })
  if (error) throw new VideoConsentError('FETCH_FAILED', error.message)
  return (data as MediaConsentRow[]).map(consentFromRow)
}

export async function listMediaConsentsForMedia(mediaId: string): Promise<MediaConsent[]> {
  const { data, error } = await supabase.from('video_media_consents').select('*').eq('media_id', mediaId).order('created_at', { ascending: false })
  if (error) throw new VideoConsentError('FETCH_FAILED', error.message)
  return (data as MediaConsentRow[]).map(consentFromRow)
}

export async function getMediaConsent(consentId: string): Promise<MediaConsent | null> {
  const { data, error } = await supabase.from('video_media_consents').select('*').eq('id', consentId).maybeSingle()
  if (error) throw new VideoConsentError('FETCH_FAILED', error.message)
  return data ? consentFromRow(data as MediaConsentRow) : null
}

export async function listMyPresenterMedia(subjectProfileId: string): Promise<PresenterMedia[]> {
  const { data, error } = await supabase
    .from('video_presenter_media')
    .select('*')
    .eq('subject_profile_id', subjectProfileId)
    .order('created_at', { ascending: false })
  if (error) throw new VideoConsentError('FETCH_FAILED', error.message)
  return (data as Array<Record<string, unknown>>).map((row) => ({
    id: row.id as string,
    uploaderId: row.uploader_id as string,
    subjectProfileId: row.subject_profile_id as string,
    mediaType: row.media_type as PresenterMediaType,
    storagePath: row.storage_path as string,
    mimeType: row.mime_type as string,
    byteSize: row.byte_size as number,
    originalFilename: row.original_filename as string | null,
    createdAt: row.created_at as string,
  }))
}

export async function listMyPresenterProfiles(ownerId: string): Promise<PresenterProfile[]> {
  const { data, error } = await supabase.from('video_presenter_profiles').select('*').eq('owner_id', ownerId).order('created_at', { ascending: false })
  if (error) throw new VideoConsentError('FETCH_FAILED', error.message)
  return (data as PresenterProfileRow[]).map(profileFromRow)
}

// A clip-job stage's status — one wider than ProviderStatus (which the
// photo-avatar/cloned-voice statuses still use) because
// video_presenter_clip_jobs also allows 'uncertain' (see
// supabase/migrations/20261012180000_video_heygen_clip_job_tracking.sql).
export type ClipJobStatus = ProviderStatus | 'uncertain'

export interface PresenterClipJob {
  sceneId: string
  narrationStatus: ClipJobStatus
  videoStatus: ClipJobStatus
  generatedStoragePath: string | null
}

// READ-ONLY — selects from video_presenter_clip_jobs (admin-only RLS,
// identical trust model to video_presenter_profiles above). Used only to
// safely RESTORE an already-successful clip's local asset onto a
// newly-created or resumed storyboard (see VideoCreation.tsx) — never to
// decide whether a NEW paid generation should run. That gate is entirely
// server-side (claim_heygen_clip_narration/claim_heygen_clip_video); this
// function cannot start, retry, or resolve a job, only read its state.
export async function listPresenterClipJobs(presenterProfileId: string): Promise<PresenterClipJob[]> {
  const { data, error } = await supabase
    .from('video_presenter_clip_jobs')
    .select('scene_id, narration_status, video_status, generated_storage_path')
    .eq('presenter_profile_id', presenterProfileId)
  if (error) throw new VideoConsentError('FETCH_FAILED', error.message)
  return (data ?? []).map((row) => ({
    sceneId: row.scene_id as string,
    narrationStatus: row.narration_status as ClipJobStatus,
    videoStatus: row.video_status as ClipJobStatus,
    generatedStoragePath: row.generated_storage_path as string | null,
  }))
}

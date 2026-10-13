// Type-only import — fully erased by `--experimental-strip-types`, so it
// causes no runtime module resolution at all (unlike a value import, this
// can never hit the .js-suffixed-specifier-vs-sibling-.ts-file gap
// confirmed in the hardening-pass report's item 7). The real functions are
// instead loaded lazily via dynamic import() inside getRealStorageDeps()
// below, so that resolution is only ever attempted by an ACTUAL caller
// that omits `deps` — never by videoProviderClients.test.ts, which always
// passes its own fakes and so never triggers it.
import type { downloadPresenterMediaBytes, uploadGeneratedPresenterMedia, createPresenterMediaSignedUrl } from './supabaseServiceClient.js'

// Storage I/O is injected (defaulting to the real Supabase-backed
// functions) specifically so api/_lib/videoProviderClients.test.ts can
// exercise the HTTP/polling/retry logic below with plain `node --test` —
// no live Supabase project, no experimental module-mocking flags, just a
// different object passed in. Every real caller omits this parameter
// entirely and gets the exact real behavior.
export interface ProviderStorageDeps {
  downloadBytes: typeof downloadPresenterMediaBytes
  uploadBytes: typeof uploadGeneratedPresenterMedia
  createSignedUrl: typeof createPresenterMediaSignedUrl
}

let realStorageDepsPromise: Promise<ProviderStorageDeps> | null = null
function getRealStorageDeps(): Promise<ProviderStorageDeps> {
  if (!realStorageDepsPromise) {
    realStorageDepsPromise = import('./supabaseServiceClient.js').then((m) => ({
      downloadBytes: m.downloadPresenterMediaBytes,
      uploadBytes: m.uploadGeneratedPresenterMedia,
      createSignedUrl: m.createPresenterMediaSignedUrl,
    }))
  }
  return realStorageDepsPromise
}

// Real server-side provider integrations: HeyGen handles BOTH the photo
// avatar and (as of Oct 2026) the cloned voice via its Instant Voice Clone
// API, making it the default/active voice path; ElevenLabs' voice-clone
// functions are kept below unchanged as an intact fallback, per explicit
// instruction not to remove them — nothing calls them by default anymore,
// but they still work if a caller asks for provider: 'elevenlabs'.
// Reviewed against each provider's current official API documentation as
// of this writing (HeyGen: developers.heygen.com/docs/voices/instant-voice-clone,
// /reference/clone-a-voice, /reference/create-speech, /photo-avatar,
// /docs/avatar-consent, /docs/quick-start; ElevenLabs:
// elevenlabs.io/docs/api-reference/voices/ivc/create,
// /text-to-speech/convert, /eleven-api/guides/how-to/voices/instant-voice-cloning).
// Endpoint paths/fields are accurate as reviewed, but no provider API has
// been called for real in this environment — re-verify the exact response
// shapes against the live reference before the first real paid call.
//
// KEY FINDING (drives this file's whole design): HeyGen's own consent API
// (POST /v3/avatars/{group_id}/consent) applies ONLY to type:"digital_twin"
// avatars. For type:"photo" avatars — what this integration uses —
// consent_status is always null and HeyGen performs and records NO consent
// check of its own ("the user is responsible for getting the subject's
// agreement and keeping a record" — HeyGen's own docs). The same is true
// of HeyGen's voice-clone endpoints: neither the Instant nor Professional
// Clone documentation mentions any consent requirement or enforcement of
// its own. This means WFG's own consent workflow (supabase/migrations/20261008_video_presenter_consent.sql)
// is the ONLY real consent gate in this entire pipeline, for the voice
// exactly as it already was for the photo — there is no provider-side
// check to fall back on for either. Every function below is therefore
// still gated by authorize_video_generation() having already succeeded,
// called by api/video/presenter/authorize-generation.ts BEFORE any
// function here runs, and again before every retry — never the reverse.
//
// SAFETY: a real HTTP call never fires unless BOTH are true:
//   1. VIDEO_PROVIDER_CALLS_ENABLED=true is set (a deliberate kill switch,
//      separate from merely having an API key configured — per the
//      explicit instruction to keep real paid generation disabled for
//      now).
//   2. The corresponding provider API key env var is actually present.
// Missing either raises before any network request is constructed.

const HEYGEN_API_BASE = 'https://api.heygen.com'
const ELEVENLABS_API_BASE = 'https://api.elevenlabs.io'

export class ProviderNotConfiguredError extends Error {
  provider: 'heygen' | 'elevenlabs'
  constructor(provider: 'heygen' | 'elevenlabs', detail: string) {
    super(`NOT_CONFIGURED: ${provider} — ${detail}`)
    this.provider = provider
  }
}

export class ProviderCallsDisabledError extends Error {
  constructor() {
    super('PROVIDER_CALLS_DISABLED: Real provider calls require VIDEO_PROVIDER_CALLS_ENABLED=true, which is not set. No credits were spent.')
  }
}

export class ProviderRequestError extends Error {
  provider: 'heygen' | 'elevenlabs'
  status: number | null
  constructor(provider: 'heygen' | 'elevenlabs', message: string, status: number | null = null) {
    super(`PROVIDER_REQUEST_FAILED: ${provider} — ${message}`)
    this.provider = provider
    this.status = status
  }
}

export class ProviderJobFailedError extends Error {
  provider: 'heygen' | 'elevenlabs'
  constructor(provider: 'heygen' | 'elevenlabs', detail: string) {
    super(`PROVIDER_JOB_FAILED: ${provider} — ${detail}`)
    this.provider = provider
  }
}

export class ProviderVerificationRequiredError extends Error {
  constructor(providerVoiceId: string) {
    super(
      `PROVIDER_VERIFICATION_REQUIRED: ElevenLabs flagged voice ${providerVoiceId} as requiring verification before it can be used. ` +
        'Complete verification in the ElevenLabs dashboard for this voice, then retry.',
    )
  }
}

function assertProviderCallsEnabled(): void {
  if (process.env.VIDEO_PROVIDER_CALLS_ENABLED !== 'true') {
    throw new ProviderCallsDisabledError()
  }
}

function requireHeyGenApiKey(): string {
  const key = process.env.HEYGEN_API_KEY
  if (!key) throw new ProviderNotConfiguredError('heygen', 'HEYGEN_API_KEY is not set.')
  return key
}

function requireElevenLabsApiKey(): string {
  const key = process.env.ELEVENLABS_API_KEY
  if (!key) throw new ProviderNotConfiguredError('elevenlabs', 'ELEVENLABS_API_KEY is not set.')
  return key
}

// Generic bounded poll loop — used for both HeyGen avatar training and
// HeyGen video generation, which share the same pending/processing/
// completed/failed shape. Never retries past maxAttempts; the caller
// decides what "done" and "failed" mean for its own response shape.
async function pollUntilDone<T>(opts: {
  fetchStatus: () => Promise<T>
  isDone: (result: T) => boolean
  isFailed: (result: T) => boolean
  failureDetail: (result: T) => string
  provider: 'heygen' | 'elevenlabs'
  intervalMs?: number
  maxAttempts?: number
}): Promise<T> {
  const intervalMs = opts.intervalMs ?? 10_000
  const maxAttempts = opts.maxAttempts ?? 60 // 60 * 10s = 10 minutes
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const result = await opts.fetchStatus()
    if (opts.isFailed(result)) {
      throw new ProviderJobFailedError(opts.provider, opts.failureDetail(result))
    }
    if (opts.isDone(result)) {
      return result
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
  throw new ProviderRequestError(opts.provider, 'Timed out waiting for the job to complete.')
}

async function heygenFetch(path: string, init: RequestInit & { apiKey: string }): Promise<Response> {
  const { apiKey, ...rest } = init
  const response = await fetch(`${HEYGEN_API_BASE}${path}`, {
    ...rest,
    headers: { ...(rest.headers ?? {}), 'x-api-key': apiKey },
  })
  if (!response.ok && response.status >= 500) {
    throw new ProviderRequestError('heygen', `HTTP ${response.status} from ${path}`, response.status)
  }
  return response
}

async function elevenLabsFetch(path: string, init: RequestInit & { apiKey: string }): Promise<Response> {
  const { apiKey, ...rest } = init
  const response = await fetch(`${ELEVENLABS_API_BASE}${path}`, {
    ...rest,
    headers: { ...(rest.headers ?? {}), 'xi-api-key': apiKey },
  })
  if (!response.ok && response.status >= 500) {
    throw new ProviderRequestError('elevenlabs', `HTTP ${response.status} from ${path}`, response.status)
  }
  return response
}

export interface CreateHeyGenAvatarInput {
  presenterProfileId: string
  photoStoragePath: string
}

export interface CreateHeyGenAvatarResult {
  providerAvatarId: string
}

// POST /v3/avatars (type: "photo") -> poll GET /v3/avatars/{id} until
// status leaves "processing". See this file's own header: HeyGen performs
// NO consent check for this avatar type — our own consent workflow is the
// entire gate.
export async function createHeyGenAvatar(input: CreateHeyGenAvatarInput, deps?: ProviderStorageDeps): Promise<CreateHeyGenAvatarResult> {
  assertProviderCallsEnabled()
  const apiKey = requireHeyGenApiKey()
  const resolvedDeps = deps ?? (await getRealStorageDeps())

  // A signed URL into OUR private bucket, just long enough for HeyGen to
  // fetch it — never a public bucket, never exposed to the browser.
  const photoUrl = await resolvedDeps.createSignedUrl(input.photoStoragePath, 600)

  const createResponse = await heygenFetch('/v3/avatars', {
    apiKey,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'photo',
      name: `wfg-presenter-${input.presenterProfileId}`,
      file: { type: 'url', url: photoUrl },
    }),
  })
  if (!createResponse.ok) {
    throw new ProviderRequestError('heygen', `avatar creation request rejected (HTTP ${createResponse.status})`, createResponse.status)
  }
  const createBody = (await createResponse.json()) as { data?: { avatar_item?: { id?: string } } }
  const avatarId = createBody.data?.avatar_item?.id
  if (!avatarId) {
    throw new ProviderRequestError('heygen', 'avatar creation response did not include avatar_item.id')
  }

  await pollUntilDone({
    provider: 'heygen',
    fetchStatus: async () => {
      const statusResponse = await heygenFetch(`/v3/avatars/${avatarId}`, { apiKey, method: 'GET' })
      if (!statusResponse.ok) {
        throw new ProviderRequestError('heygen', `avatar status check failed (HTTP ${statusResponse.status})`, statusResponse.status)
      }
      return (await statusResponse.json()) as { data?: { status?: string; failure_message?: string } }
    },
    isDone: (result) => result.data?.status === 'completed',
    isFailed: (result) => result.data?.status === 'failed',
    failureDetail: (result) => result.data?.failure_message ?? 'avatar training failed with no further detail',
  })

  return { providerAvatarId: avatarId }
}

export interface CreateHeyGenAvatarVideoInput {
  presenterProfileId: string
  avatarId: string
  narrationAudioStoragePath: string
}

export interface CreateHeyGenAvatarVideoResult {
  providerVideoId: string
  generatedStoragePath: string
}

// POST /v3/videos (type: "avatar", audio_url — never script/voice_id, so
// the SAME ElevenLabs-cloned-voice narration audio drives both the
// presenter's lip-sync and the spoken narration, never two different
// voices) -> poll GET /v3/videos/{id} -> download the completed video and
// store it in OUR OWN private bucket rather than leaving the only copy on
// HeyGen's own temporary video_url.
export async function createHeyGenAvatarVideo(input: CreateHeyGenAvatarVideoInput, deps?: ProviderStorageDeps): Promise<CreateHeyGenAvatarVideoResult> {
  assertProviderCallsEnabled()
  const apiKey = requireHeyGenApiKey()
  const resolvedDeps = deps ?? (await getRealStorageDeps())

  const audioUrl = await resolvedDeps.createSignedUrl(input.narrationAudioStoragePath, 3600)

  const createResponse = await heygenFetch('/v3/videos', {
    apiKey,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'avatar',
      avatar_id: input.avatarId,
      audio_url: audioUrl,
      resolution: '1080p',
      aspect_ratio: '16:9',
    }),
  })
  if (!createResponse.ok) {
    throw new ProviderRequestError('heygen', `video creation request rejected (HTTP ${createResponse.status})`, createResponse.status)
  }
  const createBody = (await createResponse.json()) as { data?: { video_id?: string } }
  const videoId = createBody.data?.video_id
  if (!videoId) {
    throw new ProviderRequestError('heygen', 'video creation response did not include video_id')
  }

  const final = await pollUntilDone({
    provider: 'heygen',
    intervalMs: 15_000,
    maxAttempts: 80, // up to ~20 minutes — HeyGen's own guidance: processing is typically 5-10x final video length
    fetchStatus: async () => {
      const statusResponse = await heygenFetch(`/v3/videos/${videoId}`, { apiKey, method: 'GET' })
      if (!statusResponse.ok) {
        throw new ProviderRequestError('heygen', `video status check failed (HTTP ${statusResponse.status})`, statusResponse.status)
      }
      return (await statusResponse.json()) as { data?: { status?: string; video_url?: string; failure_message?: string } }
    },
    isDone: (result) => result.data?.status === 'completed',
    isFailed: (result) => result.data?.status === 'failed',
    failureDetail: (result) => result.data?.failure_message ?? 'video generation failed with no further detail',
  })

  const videoUrl = final.data?.video_url
  if (!videoUrl) {
    throw new ProviderRequestError('heygen', 'completed video response did not include video_url')
  }
  const videoDownload = await fetch(videoUrl)
  if (!videoDownload.ok) {
    throw new ProviderRequestError('heygen', `could not download the completed video (HTTP ${videoDownload.status})`, videoDownload.status)
  }
  const videoBytes = new Uint8Array(await videoDownload.arrayBuffer())
  const generatedStoragePath = `${input.presenterProfileId}/avatar-video/${videoId}.mp4`
  await resolvedDeps.uploadBytes(generatedStoragePath, videoBytes, 'video/mp4')

  return { providerVideoId: videoId, generatedStoragePath: `generated/${generatedStoragePath}` }
}

export interface CreateElevenLabsVoiceCloneInput {
  presenterProfileId: string
  voiceStoragePath: string
}

export interface CreateElevenLabsVoiceCloneResult {
  providerVoiceId: string
  requiresVerification: boolean
}

// POST /v1/voices/add (multipart: name + files). If the response's
// requires_verification is true, the voice is NOT yet usable for
// text-to-speech — ElevenLabs' own verification step (completed in their
// dashboard; no documented API endpoint for it as of this review) must
// finish first. This function surfaces that as a distinct, non-silent
// state (ProviderVerificationRequiredError on later use), never treated
// as "ready".
export async function createElevenLabsVoiceClone(input: CreateElevenLabsVoiceCloneInput, deps?: ProviderStorageDeps): Promise<CreateElevenLabsVoiceCloneResult> {
  assertProviderCallsEnabled()
  const apiKey = requireElevenLabsApiKey()
  const resolvedDeps = deps ?? (await getRealStorageDeps())

  const { bytes, contentType } = await resolvedDeps.downloadBytes(input.voiceStoragePath)

  const form = new FormData()
  form.set('name', `wfg-presenter-${input.presenterProfileId}`)
  form.set('files', new Blob([bytes], { type: contentType }), 'voice-sample')

  const response = await elevenLabsFetch('/v1/voices/add', { apiKey, method: 'POST', body: form })
  if (!response.ok) {
    throw new ProviderRequestError('elevenlabs', `voice clone request rejected (HTTP ${response.status})`, response.status)
  }
  const body = (await response.json()) as { voice_id?: string; requires_verification?: boolean }
  if (!body.voice_id) {
    throw new ProviderRequestError('elevenlabs', 'voice clone response did not include voice_id')
  }

  return { providerVoiceId: body.voice_id, requiresVerification: Boolean(body.requires_verification) }
}

export interface CreateHeyGenVoiceCloneInput {
  presenterProfileId: string
  voiceStoragePath: string
}

export interface CreateHeyGenVoiceCloneResult {
  providerVoiceId: string
}

// HeyGen-only voice integration (Oct 2026 research, verified against
// developers.heygen.com/reference/clone-a-voice): Instant Voice Clone —
// POST /v3/voices/clone (audio: {type:"url"}, same signed-URL pattern
// createHeyGenAvatar already uses for the photo) -> poll GET
// /v3/voices/{voice_clone_id} until status is "complete" (the exact
// string HeyGen's own reference gives; "failed" is assumed to mirror
// every other HeyGen polling shape in this file — re-verify both against
// the live reference before the first real paid call, per this file's own
// header). The returned id then works directly as a voice_id for BOTH
// generateHeyGenNarration below AND createHeyGenAvatarVideo above (HeyGen's
// reference states a complete voice_clone_id "works like a voice_id: you
// can pass it to text-to-speech or to POST /v3/videos") — unlike
// ElevenLabs, there is no separate requires_verification state documented
// for Instant Clone.
export async function createHeyGenVoiceClone(input: CreateHeyGenVoiceCloneInput, deps?: ProviderStorageDeps): Promise<CreateHeyGenVoiceCloneResult> {
  assertProviderCallsEnabled()
  const apiKey = requireHeyGenApiKey()
  const resolvedDeps = deps ?? (await getRealStorageDeps())

  const voiceUrl = await resolvedDeps.createSignedUrl(input.voiceStoragePath, 600)

  const createResponse = await heygenFetch('/v3/voices/clone', {
    apiKey,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      voice_name: `wfg-presenter-${input.presenterProfileId}`,
      audio: { type: 'url', url: voiceUrl },
    }),
  })
  if (!createResponse.ok) {
    throw new ProviderRequestError('heygen', `voice clone request rejected (HTTP ${createResponse.status})`, createResponse.status)
  }
  const createBody = (await createResponse.json()) as { data?: { voice_clone_id?: string } }
  const voiceCloneId = createBody.data?.voice_clone_id
  if (!voiceCloneId) {
    throw new ProviderRequestError('heygen', 'voice clone response did not include voice_clone_id')
  }

  await pollUntilDone({
    provider: 'heygen',
    fetchStatus: async () => {
      const statusResponse = await heygenFetch(`/v3/voices/${voiceCloneId}`, { apiKey, method: 'GET' })
      if (!statusResponse.ok) {
        throw new ProviderRequestError('heygen', `voice clone status check failed (HTTP ${statusResponse.status})`, statusResponse.status)
      }
      return (await statusResponse.json()) as { data?: { status?: string; failure_message?: string } }
    },
    isDone: (result) => result.data?.status === 'complete',
    isFailed: (result) => result.data?.status === 'failed',
    failureDetail: (result) => result.data?.failure_message ?? 'voice clone training failed with no further detail',
  })

  return { providerVoiceId: voiceCloneId }
}

export interface GenerateHeyGenNarrationInput {
  presenterProfileId: string
  providerVoiceId: string
  text: string
}

export interface GenerateHeyGenNarrationResult {
  generatedStoragePath: string
}

// POST /v3/voices/speech ({ voice_id, text }) — exact field names per
// developers.heygen.com/reference's own schema for this endpoint. Returns
// one completed WAV at data.audio_url synchronously (no polling, per
// HeyGen's own docs: "the request stays open until the file is
// assembled"), downloaded and re-stored in OUR OWN private bucket rather
// than left on HeyGen's URL — same pattern as generateElevenLabsNarration
// and createHeyGenAvatarVideo.
export async function generateHeyGenNarration(input: GenerateHeyGenNarrationInput, deps?: ProviderStorageDeps): Promise<GenerateHeyGenNarrationResult> {
  assertProviderCallsEnabled()
  const apiKey = requireHeyGenApiKey()
  const resolvedDeps = deps ?? (await getRealStorageDeps())

  const response = await heygenFetch('/v3/voices/speech', {
    apiKey,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ voice_id: input.providerVoiceId, text: input.text }),
  })
  if (!response.ok) {
    throw new ProviderRequestError('heygen', `speech generation request rejected (HTTP ${response.status})`, response.status)
  }
  const body = (await response.json()) as { data?: { audio_url?: string } }
  const audioUrl = body.data?.audio_url
  if (!audioUrl) {
    throw new ProviderRequestError('heygen', 'speech generation response did not include audio_url')
  }
  const audioDownload = await fetch(audioUrl)
  if (!audioDownload.ok) {
    throw new ProviderRequestError('heygen', `could not download the generated narration (HTTP ${audioDownload.status})`, audioDownload.status)
  }
  const audioBytes = new Uint8Array(await audioDownload.arrayBuffer())
  const generatedStoragePath = `${input.presenterProfileId}/narration/${Date.now()}.wav`
  await resolvedDeps.uploadBytes(generatedStoragePath, audioBytes, 'audio/wav')

  return { generatedStoragePath: `generated/${generatedStoragePath}` }
}

export interface HeyGenAccountInfo {
  remainingQuota: number
  remainingCredits: number
}

// A read-only, documented, NON-BILLABLE check (GET /v2/user/remaining_quota)
// — per HeyGen's own docs, this reports wallet balance only (quota ÷ 60 =
// credits remaining), never a "voice cloning enabled" flag. HeyGen does
// not document a dedicated feature-entitlement endpoint: the only
// authoritative confirmation that Instant Voice Clone is enabled for this
// account is the clone endpoint's own 403 plan_upgrade_required response,
// which — being a rejection before any audio is processed — is not itself
// a billable generation. This function is for optional, informational use
// only (e.g. confirming the key is valid and the wallet isn't empty before
// a real test); it must never be treated as proof that voice cloning is
// enabled, and this phase never calls it for real.
export async function getHeyGenAccountInfo(): Promise<HeyGenAccountInfo> {
  assertProviderCallsEnabled()
  const apiKey = requireHeyGenApiKey()

  const response = await heygenFetch('/v2/user/remaining_quota', { apiKey, method: 'GET' })
  if (!response.ok) {
    throw new ProviderRequestError('heygen', `account info request rejected (HTTP ${response.status})`, response.status)
  }
  const body = (await response.json()) as { data?: { remaining_quota?: number } }
  const remainingQuota = body.data?.remaining_quota
  if (typeof remainingQuota !== 'number') {
    throw new ProviderRequestError('heygen', 'account info response did not include remaining_quota')
  }
  return { remainingQuota, remainingCredits: remainingQuota / 60 }
}

export interface GenerateElevenLabsNarrationInput {
  presenterProfileId: string
  providerVoiceId: string
  requiresVerification: boolean
  text: string
}

export interface GenerateElevenLabsNarrationResult {
  generatedStoragePath: string
}

// POST /v1/text-to-speech/{voice_id}. Refuses outright if the voice was
// ever flagged requires_verification — never silently attempts generation
// against an unverified clone.
export async function generateElevenLabsNarration(input: GenerateElevenLabsNarrationInput, deps?: ProviderStorageDeps): Promise<GenerateElevenLabsNarrationResult> {
  assertProviderCallsEnabled()
  if (input.requiresVerification) {
    throw new ProviderVerificationRequiredError(input.providerVoiceId)
  }
  const apiKey = requireElevenLabsApiKey()
  const resolvedDeps = deps ?? (await getRealStorageDeps())

  const response = await elevenLabsFetch(`/v1/text-to-speech/${input.providerVoiceId}`, {
    apiKey,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: input.text, model_id: 'eleven_multilingual_v2' }),
  })
  if (!response.ok) {
    throw new ProviderRequestError('elevenlabs', `speech generation request rejected (HTTP ${response.status})`, response.status)
  }
  const audioBytes = new Uint8Array(await response.arrayBuffer())
  const generatedStoragePath = `${input.presenterProfileId}/narration/${Date.now()}.mp3`
  await resolvedDeps.uploadBytes(generatedStoragePath, audioBytes, 'audio/mpeg')

  return { generatedStoragePath: `generated/${generatedStoragePath}` }
}

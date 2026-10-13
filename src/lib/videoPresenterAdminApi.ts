import { getValidAccessToken } from './sessionService'

// Thin client for the two admin-only server routes this feature adds —
// same accessToken + fetch pattern as adminUserManagementService.ts's own
// calls into api/admin/users/*.ts.

export interface PresenterSubjectCandidate {
  profileId: string
  fullName: string | null
  email: string
  role: 'manager' | 'admin'
}

export class VideoPresenterApiError extends Error {
  code: string
  constructor(code: string, message: string) {
    super(message)
    this.code = code
  }
}

export async function fetchPresenterSubjectCandidates(): Promise<PresenterSubjectCandidate[]> {
  let accessToken: string
  try {
    accessToken = await getValidAccessToken()
  } catch {
    throw new VideoPresenterApiError('NO_SESSION', 'Your session has expired. Please sign in again.')
  }

  const response = await fetch('/api/video/presenter/subjects', {
    method: 'GET',
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  const body = await response.json().catch(() => null)
  if (!response.ok) {
    throw new VideoPresenterApiError(body?.error ?? 'UNKNOWN', body?.message ?? 'Could not load the subject list.')
  }
  return (body?.subjects ?? []) as PresenterSubjectCandidate[]
}

export interface AuthorizeGenerationResult {
  authorized?: boolean
  providerAvatarId?: string
  providerVoiceId?: string
  requiresVerification?: boolean
  generatedStoragePath?: string
  providerVideoId?: string
  alreadyReady?: boolean
}

export type VideoGenerationAction = 'create_avatar' | 'clone_voice' | 'generate_narration' | 'generate_avatar_video'

// Calls the server-side gate directly — the ONE path that can lead to a
// real, paid HeyGen/ElevenLabs call. The route re-checks authorization
// live (never trusts anything cached client-side) immediately before any
// provider request, and again before any retry — see
// api/video/presenter/authorize-generation.ts's own header. Real provider
// calls still require VIDEO_PROVIDER_CALLS_ENABLED=true server-side; until
// then this always either denies (with a specific reason) or reports the
// provider as not configured — it never spends a credit.
export async function requestVideoGenerationAuthorization(
  presenterProfileId: string,
  provider: 'heygen' | 'elevenlabs',
  action: VideoGenerationAction,
  extra?: { narrationText?: string; narrationAudioStoragePath?: string; sceneId?: string },
): Promise<AuthorizeGenerationResult> {
  let accessToken: string
  try {
    accessToken = await getValidAccessToken()
  } catch {
    throw new VideoPresenterApiError('NO_SESSION', 'Your session has expired. Please sign in again.')
  }

  const response = await fetch('/api/video/presenter/authorize-generation', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ presenterProfileId, provider, action, ...extra }),
  })
  const body = await response.json().catch(() => null)
  if (!response.ok) {
    throw new VideoPresenterApiError(body?.error ?? 'UNKNOWN', body?.message ?? 'Generation could not be authorized.')
  }
  return body as AuthorizeGenerationResult
}

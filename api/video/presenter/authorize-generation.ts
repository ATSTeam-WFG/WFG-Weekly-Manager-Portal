import { authenticateAdmin } from '../../_lib/adminAuth.js'
import {
  createHeyGenAvatar,
  createHeyGenAvatarVideo,
  createHeyGenVoiceClone,
  generateHeyGenNarration,
  createElevenLabsVoiceClone,
  generateElevenLabsNarration,
  ProviderNotConfiguredError,
  ProviderCallsDisabledError,
  ProviderRequestError,
  ProviderJobFailedError,
  ProviderVerificationRequiredError,
} from '../../_lib/videoProviderClients.js'
import { recordBestEffort } from '../../_lib/supabasePromiseHelpers.js'

interface VercelRequest {
  method?: string
  headers: Record<string, string | string[] | undefined>
  body: unknown
}

interface VercelResponse {
  status(code: number): VercelResponse
  json(body: unknown): void
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY

function sendError(res: VercelResponse, status: number, code: string, message: string) {
  res.status(status).json({ error: code, message })
}

type Provider = 'heygen' | 'elevenlabs'
type Action = 'create_avatar' | 'clone_voice' | 'generate_narration' | 'generate_avatar_video'

function isProvider(value: unknown): value is Provider {
  return value === 'heygen' || value === 'elevenlabs'
}

function isAction(value: unknown): value is Action {
  return value === 'create_avatar' || value === 'clone_voice' || value === 'generate_narration' || value === 'generate_avatar_video'
}

interface PresenterProfileRow {
  id: string
  photo_media_id: string | null
  voice_media_id: string | null
  heygen_avatar_provider_id: string | null
  heygen_provider_status: string
  heygen_voice_provider_id: string | null
  heygen_voice_provider_status: string
  elevenlabs_voice_provider_id: string | null
  elevenlabs_provider_status: string
}

interface MediaRow {
  id: string
  storage_path: string
}

const MAX_ATTEMPTS = 2 // one original attempt + one retry

// THE required gate before any real HeyGen/ElevenLabs call, and the
// orchestrator for the actual provider work — see
// api/_lib/videoProviderClients.ts's own header for the full design
// rationale (especially: HeyGen performs NO consent check of its own for
// photo avatars, so this gate is the ONLY real one in the entire
// pipeline).
//
// Every one of the four actions below:
//   1. Re-reads the presenter profile's REAL media/provider state from the
//      database via the caller's OWN RLS-scoped session — never from a
//      client-supplied path. A request body can only ever say WHICH
//      profile/action; it can never say which file to use.
//   2. Calls authorize_video_generation() — which re-derives authorization
//      live and durably logs the attempt — IMMEDIATELY before each
//      provider HTTP call, including before every retry attempt. A
//      consent revoked between an original attempt and its retry is
//      caught on the retry's own fresh check, not assumed still valid
//      from moments earlier.
//   3. Retries at most once, and ONLY for a transient (5xx/timeout)
//      provider error — never for a job that completed but failed
//      (ProviderJobFailedError), never for missing verification
//      (ProviderVerificationRequiredError), never for a config/kill-switch
//      problem.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== 'POST') {
      return sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Only POST requests are supported.')
    }

    const auth = await authenticateAdmin({
      supabaseUrl: SUPABASE_URL,
      supabasePublishableKey: SUPABASE_PUBLISHABLE_KEY,
      authorizationHeader: req.headers.authorization,
    })
    if (!auth.ok) {
      return sendError(res, auth.status, auth.code, auth.message)
    }

    const body = (req.body ?? {}) as Record<string, unknown>
    const presenterProfileId = typeof body.presenterProfileId === 'string' ? body.presenterProfileId : undefined
    const provider = body.provider
    const action = body.action
    const narrationText = typeof body.narrationText === 'string' ? body.narrationText : undefined
    // Required for generate_narration/generate_avatar_video only — these
    // two track duplicate-protection state per (profile, scene), e.g.
    // 'opening'/'closing', so each scene's clip can be generated and
    // recovered independently of the other. Same safe-character rule as
    // every other scene-id-shaped value in this codebase.
    const rawSceneId = typeof body.sceneId === 'string' ? body.sceneId : undefined
    const sceneId = rawSceneId && /^[a-z0-9-]+$/i.test(rawSceneId) ? rawSceneId : undefined

    if (!presenterProfileId || !isProvider(provider) || !isAction(action)) {
      return sendError(res, 400, 'INVALID_REQUEST', 'presenterProfileId, a valid provider, and a valid action are required.')
    }

    const recheckAuthorization = async (): Promise<{ ok: true } | { ok: false; status: number; message: string }> => {
      const { data: authResult, error: rpcError } = await auth.supabase
        .rpc('authorize_video_generation', { p_presenter_profile_id: presenterProfileId, p_provider: provider, p_action: action })
        .single<{ authorized: boolean; check_result: string }>()
      if (rpcError) {
        return { ok: false, status: 403, message: rpcError.message }
      }
      if (!authResult?.authorized) {
        return { ok: false, status: 403, message: `Generation denied: ${authResult?.check_result ?? 'unknown'}` }
      }
      return { ok: true }
    }

    // Resolved ONCE per request from the database — the authoritative
    // source for every path a provider call will touch. Re-fetched is not
    // necessary between retries (media rows don't change mid-request); only
    // the authorization CHECK itself is re-run before each attempt.
    const { data: profile, error: profileError } = await auth.supabase
      .from('video_presenter_profiles')
      .select(
        'id, photo_media_id, voice_media_id, heygen_avatar_provider_id, heygen_provider_status, heygen_voice_provider_id, heygen_voice_provider_status, elevenlabs_voice_provider_id, elevenlabs_provider_status',
      )
      .eq('id', presenterProfileId)
      .maybeSingle<PresenterProfileRow>()
    if (profileError || !profile) {
      return sendError(res, 404, 'NOT_FOUND', 'Presenter profile could not be found.')
    }

    const loadMediaPath = async (mediaId: string | null): Promise<string | null> => {
      if (!mediaId) return null
      const { data } = await auth.supabase.from('video_presenter_media').select('storage_path').eq('id', mediaId).maybeSingle<MediaRow>()
      return data?.storage_path ?? null
    }

    let lastError: unknown = null
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const authCheck = await recheckAuthorization()
      if (!authCheck.ok) {
        return sendError(res, authCheck.status, 'GENERATION_NOT_AUTHORIZED', authCheck.message)
      }

      try {
        if (action === 'create_avatar') {
          const photoStoragePath = await loadMediaPath(profile.photo_media_id)
          if (!photoStoragePath) return sendError(res, 400, 'INVALID_STATE', 'No photo media is linked to this presenter profile.')
          // Checked explicitly, before ever attempting the atomic claim
          // below, so a disabled kill switch writes nothing to the database
          // at all — identical to this route's behavior before this change
          // whenever VIDEO_PROVIDER_CALLS_ENABLED is not 'true'.
          if (process.env.VIDEO_PROVIDER_CALLS_ENABLED !== 'true') throw new ProviderCallsDisabledError()

          // Atomic compare-and-swap (migration
          // 20261012140000_video_heygen_avatar_atomic_claim.sql): a single
          // UPDATE ... WHERE heygen_provider_status IN ('not_started',
          // 'failed') ... RETURNING inside the function, so at most one
          // concurrent request can ever see claimed = true for this
          // profile — unlike a plain read-then-write from here, which
          // cannot close that race on its own.
          const { data: claim, error: claimError } = await auth.supabase
            .rpc('claim_heygen_avatar_creation', { p_profile_id: presenterProfileId })
            .single<{ claimed: boolean; current_status: string; current_avatar_provider_id: string | null }>()
          if (claimError || !claim) {
            return sendError(res, 500, 'CLAIM_FAILED', claimError?.message ?? 'Could not evaluate the current avatar-creation claim.')
          }

          if (!claim.claimed) {
            if (claim.current_status === 'ready') {
              return res.status(200).json({ providerAvatarId: claim.current_avatar_provider_id, alreadyReady: true })
            }
            if (claim.current_status === 'pending') {
              // Another request already claimed this profile's
              // avatar-creation slot and hasn't finished yet — never start a
              // second, concurrent paid creation for the same profile.
              return sendError(res, 409, 'AVATAR_CREATION_IN_PROGRESS', 'A photo avatar creation request for this presenter is already in progress. Wait for it to finish before trying again.')
            }
            if (claim.current_status === 'uncertain') {
              // A prior attempt ended ambiguously (timeout, or a
              // request-level error mid-poll) — HeyGen's real side effect is
              // unknown, so this must never become claimable again on its
              // own. An admin must check HeyGen directly and call
              // resolve_uncertain_heygen_avatar_status before any further
              // attempt is possible.
              return sendError(
                res,
                409,
                'AVATAR_CREATION_UNCERTAIN',
                'A previous photo avatar creation attempt for this presenter ended in an uncertain state (timeout or ambiguous provider response). An admin must confirm with HeyGen directly whether an avatar was actually created, then resolve this status, before trying again.',
              )
            }
            return sendError(res, 409, 'AVATAR_CREATION_NOT_CLAIMABLE', `Cannot start photo avatar creation from the current status: ${claim.current_status}.`)
          }

          try {
            const result = await createHeyGenAvatar({ presenterProfileId, photoStoragePath })
            await auth.supabase.rpc('record_heygen_avatar_provider', { p_profile_id: presenterProfileId, p_provider_avatar_id: result.providerAvatarId, p_status: 'ready' })
            return res.status(200).json(result)
          } catch (err) {
            // Distinguish a DEFINITE rejection from an UNCERTAIN one so a
            // timeout can never make this profile immediately eligible for
            // another paid attempt:
            //   - ProviderJobFailedError: HeyGen's own job status came back
            //     'failed' — a confirmed, completed rejection. No usable
            //     avatar exists; safe to claim again.
            //   - ProviderNotConfiguredError: we never even reached HeyGen
            //     (e.g. missing API key) — also safe to claim again once fixed.
            //   - anything else (ProviderRequestError — including the
            //     poll-timeout case — or any unexpected error): we do not
            //     know what HeyGen actually did. Recorded as 'uncertain',
            //     which claim_heygen_avatar_creation will never claim again
            //     on its own.
            const nextStatus = err instanceof ProviderJobFailedError || err instanceof ProviderNotConfiguredError ? 'failed' : 'uncertain'
            await recordBestEffort(auth.supabase.rpc('record_heygen_avatar_provider', { p_profile_id: presenterProfileId, p_provider_avatar_id: null, p_status: nextStatus }))
            throw err
          }
        }

        if (action === 'clone_voice') {
          // HeyGen is the default/active voice provider (Oct 2026); the
          // ElevenLabs path below is kept fully intact as a fallback —
          // same profile row, same authorization gate, selected purely by
          // the caller's own `provider` field.
          if (provider === 'heygen') {
            if (profile.heygen_voice_provider_id && profile.heygen_voice_provider_status === 'ready') {
              return res.status(200).json({ providerVoiceId: profile.heygen_voice_provider_id, alreadyReady: true })
            }
            const voiceStoragePath = await loadMediaPath(profile.voice_media_id)
            if (!voiceStoragePath) return sendError(res, 400, 'INVALID_STATE', 'No voice media is linked to this presenter profile.')
            const result = await createHeyGenVoiceClone({ presenterProfileId, voiceStoragePath })
            await auth.supabase.rpc('record_heygen_voice_provider', {
              p_profile_id: presenterProfileId,
              p_provider_voice_id: result.providerVoiceId,
              p_status: 'ready',
            })
            return res.status(200).json(result)
          }

          if (profile.elevenlabs_voice_provider_id && profile.elevenlabs_provider_status === 'ready') {
            return res.status(200).json({ providerVoiceId: profile.elevenlabs_voice_provider_id, alreadyReady: true })
          }
          const voiceStoragePath = await loadMediaPath(profile.voice_media_id)
          if (!voiceStoragePath) return sendError(res, 400, 'INVALID_STATE', 'No voice media is linked to this presenter profile.')
          const result = await createElevenLabsVoiceClone({ presenterProfileId, voiceStoragePath })
          await auth.supabase.rpc('record_elevenlabs_voice_provider', {
            p_profile_id: presenterProfileId,
            p_provider_voice_id: result.providerVoiceId,
            p_status: result.requiresVerification ? 'pending' : 'ready',
          })
          return res.status(200).json(result)
        }

        if (action === 'generate_narration') {
          if (!narrationText) return sendError(res, 400, 'INVALID_REQUEST', 'narrationText is required for generate_narration.')

          if (provider === 'heygen') {
            if (!sceneId) return sendError(res, 400, 'INVALID_REQUEST', 'sceneId is required for generate_narration.')
            if (!profile.heygen_voice_provider_id) return sendError(res, 400, 'INVALID_STATE', 'No cloned voice exists for this presenter profile yet — run clone_voice first.')
            // Checked explicitly before claiming, same kill-switch
            // discipline as create_avatar — a disabled call writes nothing
            // to the database at all.
            if (process.env.VIDEO_PROVIDER_CALLS_ENABLED !== 'true') throw new ProviderCallsDisabledError()

            // Atomic claim (migration
            // 20261012180000_video_heygen_clip_job_tracking.sql) — same
            // compare-and-swap guarantee as create_avatar's own claim,
            // applied per (profile, scene) so opening/closing are fully
            // independent.
            const { data: claim, error: claimError } = await auth.supabase
              .rpc('claim_heygen_clip_narration', { p_profile_id: presenterProfileId, p_scene_id: sceneId })
              .single<{ claimed: boolean; current_status: string; current_audio_path: string | null }>()
            if (claimError || !claim) {
              return sendError(res, 500, 'CLAIM_FAILED', claimError?.message ?? 'Could not evaluate the current narration claim.')
            }

            if (!claim.claimed) {
              if (claim.current_status === 'ready') {
                return res.status(200).json({ generatedStoragePath: claim.current_audio_path, alreadyReady: true })
              }
              if (claim.current_status === 'pending') {
                return sendError(res, 409, 'NARRATION_IN_PROGRESS', 'A narration generation request for this scene is already in progress. Wait for it to finish before trying again.')
              }
              if (claim.current_status === 'uncertain') {
                return sendError(
                  res,
                  409,
                  'NARRATION_UNCERTAIN',
                  'A previous narration attempt for this scene ended in an uncertain state. An admin must confirm with HeyGen directly whether audio was actually generated, then resolve this status, before trying again.',
                )
              }
              return sendError(res, 409, 'NARRATION_NOT_CLAIMABLE', `Cannot start narration generation from the current status: ${claim.current_status}.`)
            }

            try {
              const result = await generateHeyGenNarration({ presenterProfileId, providerVoiceId: profile.heygen_voice_provider_id, text: narrationText })
              await auth.supabase.rpc('record_heygen_clip_narration', {
                p_profile_id: presenterProfileId,
                p_scene_id: sceneId,
                p_status: 'ready',
                p_audio_storage_path: result.generatedStoragePath,
              })
              return res.status(200).json(result)
            } catch (err) {
              // Same definite-vs-uncertain classification as create_avatar:
              // a confirmed job failure or a never-reached-provider error is
              // safe to retry later; anything else (including this
              // single-request endpoint's own transient HTTP failure) is
              // recorded as uncertain rather than assumed safe to redo.
              const nextStatus = err instanceof ProviderJobFailedError || err instanceof ProviderNotConfiguredError ? 'failed' : 'uncertain'
              await recordBestEffort(
                auth.supabase.rpc('record_heygen_clip_narration', { p_profile_id: presenterProfileId, p_scene_id: sceneId, p_status: nextStatus, p_audio_storage_path: null }),
              )
              throw err
            }
          }

          // ElevenLabs fallback path — intentionally left untouched. HeyGen
          // is the default/active voice provider and the only one this
          // phase's generation plan actually uses; adding the same
          // per-scene claim tracking here is out of scope for this change.
          if (!profile.elevenlabs_voice_provider_id) return sendError(res, 400, 'INVALID_STATE', 'No cloned voice exists for this presenter profile yet — run clone_voice first.')
          const result = await generateElevenLabsNarration({
            presenterProfileId,
            providerVoiceId: profile.elevenlabs_voice_provider_id,
            requiresVerification: profile.elevenlabs_provider_status !== 'ready',
            text: narrationText,
          })
          return res.status(200).json(result)
        }

        // generate_avatar_video
        if (!sceneId) return sendError(res, 400, 'INVALID_REQUEST', 'sceneId is required for generate_avatar_video.')
        if (!profile.heygen_avatar_provider_id || profile.heygen_provider_status !== 'ready') {
          return sendError(res, 400, 'INVALID_STATE', 'No ready photo avatar exists for this presenter profile yet — run create_avatar first.')
        }
        if (process.env.VIDEO_PROVIDER_CALLS_ENABLED !== 'true') throw new ProviderCallsDisabledError()

        {
          const { data: claim, error: claimError } = await auth.supabase
            .rpc('claim_heygen_clip_video', { p_profile_id: presenterProfileId, p_scene_id: sceneId })
            .single<{
              claimed: boolean
              narration_status: string
              video_status: string
              narration_audio_path: string | null
              current_video_id: string | null
              current_storage_path: string | null
            }>()
          if (claimError || !claim) {
            return sendError(res, 500, 'CLAIM_FAILED', claimError?.message ?? 'Could not evaluate the current avatar-video claim.')
          }

          if (!claim.claimed) {
            if (claim.narration_status !== 'ready') {
              return sendError(
                res,
                400,
                'INVALID_STATE',
                `No ready narration audio exists for this scene yet (narration status: ${claim.narration_status}) — run generate_narration first.`,
              )
            }
            if (claim.video_status === 'ready') {
              return res.status(200).json({ providerVideoId: claim.current_video_id, generatedStoragePath: claim.current_storage_path, alreadyReady: true })
            }
            if (claim.video_status === 'pending') {
              return sendError(
                res,
                409,
                'AVATAR_VIDEO_IN_PROGRESS',
                'An avatar-video generation request for this scene is already in progress — this can take up to ~20 minutes. Wait for it to finish before trying again.',
              )
            }
            if (claim.video_status === 'uncertain') {
              return sendError(
                res,
                409,
                'AVATAR_VIDEO_UNCERTAIN',
                'A previous avatar-video attempt for this scene ended in an uncertain state (timeout or ambiguous provider response). An admin must confirm with HeyGen directly whether a video was actually created, then resolve this status, before trying again.',
              )
            }
            return sendError(res, 409, 'AVATAR_VIDEO_NOT_CLAIMABLE', `Cannot start avatar-video generation from the current status: ${claim.video_status}.`)
          }

          try {
            // The narration audio path is read from the claim's own row
            // (recorded by generate_narration above), never trusted from
            // the request body — one less thing a reloaded/stale client
            // could get wrong, and it's what makes an interrupted flow
            // resumable from sceneId alone.
            const result = await createHeyGenAvatarVideo({ presenterProfileId, avatarId: profile.heygen_avatar_provider_id, narrationAudioStoragePath: claim.narration_audio_path! })
            await auth.supabase.rpc('record_heygen_clip_video', {
              p_profile_id: presenterProfileId,
              p_scene_id: sceneId,
              p_status: 'ready',
              p_provider_video_id: result.providerVideoId,
              p_generated_storage_path: result.generatedStoragePath,
            })
            return res.status(200).json(result)
          } catch (err) {
            const nextStatus = err instanceof ProviderJobFailedError || err instanceof ProviderNotConfiguredError ? 'failed' : 'uncertain'
            await recordBestEffort(
              auth.supabase.rpc('record_heygen_clip_video', { p_profile_id: presenterProfileId, p_scene_id: sceneId, p_status: nextStatus, p_provider_video_id: null, p_generated_storage_path: null }),
            )
            throw err
          }
        }
      } catch (err) {
        lastError = err
        if (err instanceof ProviderNotConfiguredError) {
          return sendError(res, 501, 'PROVIDER_NOT_CONFIGURED', err.message)
        }
        if (err instanceof ProviderCallsDisabledError) {
          return sendError(res, 501, 'PROVIDER_CALLS_DISABLED', err.message)
        }
        if (err instanceof ProviderVerificationRequiredError) {
          return sendError(res, 409, 'PROVIDER_VERIFICATION_REQUIRED', err.message)
        }
        if (err instanceof ProviderJobFailedError) {
          // The job ran and genuinely failed — never worth retrying as-is.
          return sendError(res, 502, 'PROVIDER_JOB_FAILED', err.message)
        }
        const NEVER_AUTO_RETRY_ACTIONS: ReadonlySet<Action> = new Set(['create_avatar', 'generate_narration', 'generate_avatar_video'])
        if (err instanceof ProviderRequestError && attempt < MAX_ATTEMPTS && !NEVER_AUTO_RETRY_ACTIONS.has(action)) {
          // Transient (network/5xx) failure — loop again, which re-runs the
          // authorization recheck above before the next attempt. Excludes
          // create_avatar, generate_narration, and generate_avatar_video:
          // each of those branches already recorded 'failed'/'uncertain'
          // itself and has no idempotency key with HeyGen, so an automatic
          // retry here could silently create a second, separately billed
          // job if the timeout happened after HeyGen's own request already
          // succeeded — generate_avatar_video's own poll can run up to
          // ~20 minutes, the longest window of any action in this route.
          continue
        }
        throw err
      }
    }

    console.error('video/presenter/authorize-generation: exhausted retries:', lastError)
    return sendError(res, 502, 'PROVIDER_REQUEST_FAILED', 'The provider request failed after retrying once.')
  } catch (err) {
    console.error('video/presenter/authorize-generation: unexpected error:', err)
    return sendError(res, 500, 'UNKNOWN', 'An unexpected error occurred.')
  }
}

// Run with: node --experimental-strip-types --test api/_lib/videoProviderClients.test.ts
//
// Mocked integration tests for the HeyGen/ElevenLabs provider-client layer
// — global fetch is replaced per-test (restored in an `after` hook), and
// the Supabase-backed storage I/O (downloadPresenterMediaBytes/
// uploadGeneratedPresenterMedia/createPresenterMediaSignedUrl) is injected
// via each function's own optional `deps` parameter (see
// videoProviderClients.ts's own header on ProviderStorageDeps) — no live
// Supabase project, no experimental module-mocking flags required.
//
// What this does NOT test: authorize_video_generation() itself (that's
// supabase/video_presenter_consent_integration_test.sql, run for real
// against a live local Postgres — see the hardening-pass report) or the
// route's own orchestration/retry wiring (that's
// api/video/presenter/authorizeGenerationRouteWiring.test.ts, source
// inspection, matching this project's established convention for a file
// with a live Supabase import chain it isn't safe to execute directly).
import { test, describe, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import {
  createHeyGenAvatar,
  createHeyGenAvatarVideo,
  createHeyGenVoiceClone,
  generateHeyGenNarration,
  getHeyGenAccountInfo,
  createElevenLabsVoiceClone,
  generateElevenLabsNarration,
  ProviderNotConfiguredError,
  ProviderCallsDisabledError,
  ProviderRequestError,
  ProviderJobFailedError,
  ProviderVerificationRequiredError,
  type ProviderStorageDeps,
} from './videoProviderClients.ts'

const originalFetch = globalThis.fetch
const originalEnv = { ...process.env }

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

const fakeDeps: ProviderStorageDeps = {
  createSignedUrl: async () => 'https://example.test/signed-url',
  downloadBytes: async () => ({ bytes: new Uint8Array([1, 2, 3]), contentType: 'audio/wav' }),
  uploadBytes: async () => {},
}

beforeEach(() => {
  process.env = { ...originalEnv }
  process.env.VIDEO_PROVIDER_CALLS_ENABLED = 'true'
  process.env.HEYGEN_API_KEY = 'test-heygen-key'
  process.env.ELEVENLABS_API_KEY = 'test-elevenlabs-key'
})

after(() => {
  globalThis.fetch = originalFetch
  process.env = originalEnv
})

describe('kill switch and configuration gates — no network call ever happens without both', () => {
  test('VIDEO_PROVIDER_CALLS_ENABLED unset: no fetch call is made at all', async () => {
    delete process.env.VIDEO_PROVIDER_CALLS_ENABLED
    let fetchCalled = false
    globalThis.fetch = (async () => {
      fetchCalled = true
      throw new Error('fetch should never be called')
    }) as typeof fetch

    await assert.rejects(() => createHeyGenAvatar({ presenterProfileId: 'p1', photoStoragePath: 'x.jpg' }, fakeDeps), ProviderCallsDisabledError)
    assert.equal(fetchCalled, false)
  })

  test('missing HEYGEN_API_KEY: no fetch call is made even with the kill switch on', async () => {
    delete process.env.HEYGEN_API_KEY
    let fetchCalled = false
    globalThis.fetch = (async () => {
      fetchCalled = true
      throw new Error('fetch should never be called')
    }) as typeof fetch

    await assert.rejects(() => createHeyGenAvatar({ presenterProfileId: 'p1', photoStoragePath: 'x.jpg' }, fakeDeps), ProviderNotConfiguredError)
    assert.equal(fetchCalled, false)
  })

  test('missing ELEVENLABS_API_KEY: no fetch call is made', async () => {
    delete process.env.ELEVENLABS_API_KEY
    globalThis.fetch = (async () => {
      throw new Error('fetch should never be called')
    }) as typeof fetch

    await assert.rejects(() => createElevenLabsVoiceClone({ presenterProfileId: 'p1', voiceStoragePath: 'x.wav' }, fakeDeps), ProviderNotConfiguredError)
  })

  test('createHeyGenVoiceClone: VIDEO_PROVIDER_CALLS_ENABLED unset — no fetch call is made, same gate as every other HeyGen/ElevenLabs function', async () => {
    delete process.env.VIDEO_PROVIDER_CALLS_ENABLED
    let fetchCalled = false
    globalThis.fetch = (async () => {
      fetchCalled = true
      throw new Error('fetch should never be called')
    }) as typeof fetch

    await assert.rejects(() => createHeyGenVoiceClone({ presenterProfileId: 'p1', voiceStoragePath: 'x.wav' }, fakeDeps), ProviderCallsDisabledError)
    assert.equal(fetchCalled, false)
  })

  test('generateHeyGenNarration: missing HEYGEN_API_KEY — no fetch call is made', async () => {
    delete process.env.HEYGEN_API_KEY
    globalThis.fetch = (async () => {
      throw new Error('fetch should never be called')
    }) as typeof fetch

    await assert.rejects(
      () => generateHeyGenNarration({ presenterProfileId: 'p1', providerVoiceId: 'voice-1', text: 'hello' }, fakeDeps),
      ProviderNotConfiguredError,
    )
  })

  test('getHeyGenAccountInfo (the non-billable eligibility-adjacent check) is gated by the SAME kill switch as every billable call — it never bypasses VIDEO_PROVIDER_CALLS_ENABLED', async () => {
    delete process.env.VIDEO_PROVIDER_CALLS_ENABLED
    let fetchCalled = false
    globalThis.fetch = (async () => {
      fetchCalled = true
      throw new Error('fetch should never be called')
    }) as typeof fetch

    await assert.rejects(() => getHeyGenAccountInfo(), ProviderCallsDisabledError)
    assert.equal(fetchCalled, false)
  })
})

describe('success paths', () => {
  test('createHeyGenAvatar: create -> poll completed -> returns providerAvatarId', async () => {
    const calls: string[] = []
    globalThis.fetch = (async (url: string) => {
      calls.push(url)
      if (url.endsWith('/v3/avatars')) return jsonResponse(200, { data: { avatar_item: { id: 'avatar-123' } } })
      if (url.includes('/v3/avatars/avatar-123')) return jsonResponse(200, { data: { status: 'completed' } })
      throw new Error(`unexpected URL ${url}`)
    }) as typeof fetch

    const result = await createHeyGenAvatar({ presenterProfileId: 'p1', photoStoragePath: 'photo.jpg' }, fakeDeps)
    assert.equal(result.providerAvatarId, 'avatar-123')
    assert.deepEqual(calls, ['https://api.heygen.com/v3/avatars', 'https://api.heygen.com/v3/avatars/avatar-123'])
  })

  test('createElevenLabsVoiceClone: returns voice_id and requiresVerification', async () => {
    globalThis.fetch = (async () => jsonResponse(200, { voice_id: 'voice-456', requires_verification: true })) as typeof fetch

    const result = await createElevenLabsVoiceClone({ presenterProfileId: 'p1', voiceStoragePath: 'voice.wav' }, fakeDeps)
    assert.equal(result.providerVoiceId, 'voice-456')
    assert.equal(result.requiresVerification, true)
  })

  test('createHeyGenVoiceClone: create -> poll complete -> returns a voice_clone_id usable as a voice_id', async () => {
    const calls: string[] = []
    globalThis.fetch = (async (url: string) => {
      calls.push(url)
      if (url.endsWith('/v3/voices/clone')) return jsonResponse(200, { data: { voice_clone_id: 'clone-789' } })
      if (url.includes('/v3/voices/clone-789')) return jsonResponse(200, { data: { status: 'complete' } })
      throw new Error(`unexpected URL ${url}`)
    }) as typeof fetch

    const result = await createHeyGenVoiceClone({ presenterProfileId: 'p1', voiceStoragePath: 'voice.wav' }, fakeDeps)
    assert.equal(result.providerVoiceId, 'clone-789')
    assert.deepEqual(calls, ['https://api.heygen.com/v3/voices/clone', 'https://api.heygen.com/v3/voices/clone-789'])
  })

  test('generateHeyGenNarration: uploads the synthesized WAV and returns its storage path', async () => {
    let uploadedPath: string | null = null
    let uploadedContentType: string | null = null
    const deps: ProviderStorageDeps = {
      ...fakeDeps,
      uploadBytes: async (path, _bytes, contentType) => {
        uploadedPath = path
        uploadedContentType = contentType
      },
    }
    globalThis.fetch = (async (url: string) => {
      if (url.endsWith('/v3/voices/speech')) return jsonResponse(200, { data: { audio_url: 'https://heygen.example/speech.wav' } })
      if (url === 'https://heygen.example/speech.wav') return new Response(new Uint8Array([7, 7, 7]), { status: 200 })
      throw new Error(`unexpected URL ${url}`)
    }) as typeof fetch

    const result = await generateHeyGenNarration({ presenterProfileId: 'p1', providerVoiceId: 'clone-789', text: 'hello' }, deps)
    assert.match(result.generatedStoragePath, /^generated\/p1\/narration\/\d+\.wav$/)
    assert.equal(uploadedContentType, 'audio/wav')
    assert.match(uploadedPath!, /^p1\/narration\/\d+\.wav$/)
  })

  test('generateElevenLabsNarration: uploads the synthesized audio and returns its storage path', async () => {
    let uploadedPath: string | null = null
    let uploadedContentType: string | null = null
    const deps: ProviderStorageDeps = {
      ...fakeDeps,
      uploadBytes: async (path, _bytes, contentType) => {
        uploadedPath = path
        uploadedContentType = contentType
      },
    }
    globalThis.fetch = (async () => new Response(new Uint8Array([9, 9, 9]), { status: 200 })) as typeof fetch

    const result = await generateElevenLabsNarration({ presenterProfileId: 'p1', providerVoiceId: 'voice-456', requiresVerification: false, text: 'hello' }, deps)
    assert.match(result.generatedStoragePath, /^generated\/p1\/narration\/\d+\.mp3$/)
    assert.equal(uploadedContentType, 'audio/mpeg')
    assert.match(uploadedPath!, /^p1\/narration\/\d+\.mp3$/)
  })
})

describe('failure paths', () => {
  test('createHeyGenAvatar: a job that reaches status=failed throws ProviderJobFailedError with the provider\'s own failure_message', async () => {
    globalThis.fetch = (async (url: string) => {
      if (url.endsWith('/v3/avatars')) return jsonResponse(200, { data: { avatar_item: { id: 'avatar-1' } } })
      return jsonResponse(200, { data: { status: 'failed', failure_message: 'face not detected' } })
    }) as typeof fetch

    await assert.rejects(
      () => createHeyGenAvatar({ presenterProfileId: 'p1', photoStoragePath: 'photo.jpg' }, fakeDeps),
      (err: unknown) => err instanceof ProviderJobFailedError && err.message.includes('face not detected'),
    )
  })

  test('a 5xx HTTP response is classified as ProviderRequestError (transient — retryable by the caller), never ProviderJobFailedError', async () => {
    globalThis.fetch = (async () => new Response('server error', { status: 503 })) as typeof fetch

    await assert.rejects(
      () => createHeyGenAvatar({ presenterProfileId: 'p1', photoStoragePath: 'photo.jpg' }, fakeDeps),
      (err: unknown) => err instanceof ProviderRequestError && !(err instanceof ProviderJobFailedError),
    )
  })

  test('createElevenLabsVoiceClone: a validation (422) response is a non-5xx ProviderRequestError, distinguishable from a transient failure', async () => {
    globalThis.fetch = (async () => jsonResponse(422, { detail: [{ msg: 'invalid audio' }] })) as typeof fetch

    await assert.rejects(() => createElevenLabsVoiceClone({ presenterProfileId: 'p1', voiceStoragePath: 'voice.wav' }, fakeDeps), ProviderRequestError)
  })

  test('createHeyGenVoiceClone: a job that reaches status=failed throws ProviderJobFailedError with the provider\'s own failure_message', async () => {
    globalThis.fetch = (async (url: string) => {
      if (url.endsWith('/v3/voices/clone')) return jsonResponse(200, { data: { voice_clone_id: 'clone-1' } })
      return jsonResponse(200, { data: { status: 'failed', failure_message: 'audio too short' } })
    }) as typeof fetch

    await assert.rejects(
      () => createHeyGenVoiceClone({ presenterProfileId: 'p1', voiceStoragePath: 'voice.wav' }, fakeDeps),
      (err: unknown) => err instanceof ProviderJobFailedError && err.message.includes('audio too short'),
    )
  })

  test('createHeyGenVoiceClone: a 5xx HTTP response is classified as ProviderRequestError (transient — retryable), never ProviderJobFailedError', async () => {
    globalThis.fetch = (async () => new Response('server error', { status: 503 })) as typeof fetch

    await assert.rejects(
      () => createHeyGenVoiceClone({ presenterProfileId: 'p1', voiceStoragePath: 'voice.wav' }, fakeDeps),
      (err: unknown) => err instanceof ProviderRequestError && !(err instanceof ProviderJobFailedError),
    )
  })

  test('generateHeyGenNarration: a non-5xx error response (e.g. 400 for a stale/expired voice_clone_id) is a plain ProviderRequestError', async () => {
    globalThis.fetch = (async () => jsonResponse(400, { error: { code: 'invalid_parameter', message: 'voice not found' } })) as typeof fetch

    await assert.rejects(() => generateHeyGenNarration({ presenterProfileId: 'p1', providerVoiceId: 'clone-1', text: 'hello' }, fakeDeps), ProviderRequestError)
  })

  test('generateElevenLabsNarration refuses outright when requiresVerification is true — never attempts the request', async () => {
    let fetchCalled = false
    globalThis.fetch = (async () => {
      fetchCalled = true
      throw new Error('fetch should never be called')
    }) as typeof fetch

    await assert.rejects(
      () => generateElevenLabsNarration({ presenterProfileId: 'p1', providerVoiceId: 'voice-456', requiresVerification: true, text: 'hello' }, fakeDeps),
      ProviderVerificationRequiredError,
    )
    assert.equal(fetchCalled, false)
  })
})

describe('video generation (avatar + narration bound together)', () => {
  test('createHeyGenAvatarVideo: create -> poll completed -> downloads and re-stores the video, never leaving the only copy on HeyGen\'s own URL', async () => {
    let downloadedFromProviderUrl = false
    let storedPath: string | null = null
    const deps: ProviderStorageDeps = {
      ...fakeDeps,
      uploadBytes: async (path) => {
        storedPath = path
      },
    }
    globalThis.fetch = (async (url: string) => {
      if (url.endsWith('/v3/videos')) return jsonResponse(200, { data: { video_id: 'vid-1' } })
      if (url.includes('/v3/videos/vid-1')) return jsonResponse(200, { data: { status: 'completed', video_url: 'https://heygen.example/vid-1.mp4' } })
      if (url === 'https://heygen.example/vid-1.mp4') {
        downloadedFromProviderUrl = true
        return new Response(new Uint8Array([1, 2, 3, 4]), { status: 200 })
      }
      throw new Error(`unexpected URL ${url}`)
    }) as typeof fetch

    const result = await createHeyGenAvatarVideo({ presenterProfileId: 'p1', avatarId: 'avatar-123', narrationAudioStoragePath: 'p1/narration/1.mp3' }, deps)
    assert.equal(result.providerVideoId, 'vid-1')
    assert.equal(downloadedFromProviderUrl, true)
    assert.match(storedPath!, /^p1\/avatar-video\/vid-1\.mp4$/)
    assert.match(result.generatedStoragePath, /^generated\/p1\/avatar-video\/vid-1\.mp4$/)
  })

  test('the full HeyGen-only voice pipeline: a cloned voice_id generates standalone narration AND feeds the same avatar video narration — no separate ElevenLabs step required', async () => {
    globalThis.fetch = (async (url: string) => {
      if (url.endsWith('/v3/voices/clone')) return jsonResponse(200, { data: { voice_clone_id: 'clone-shared' } })
      if (url.includes('/v3/voices/clone-shared')) return jsonResponse(200, { data: { status: 'complete' } })
      if (url.endsWith('/v3/voices/speech')) return jsonResponse(200, { data: { audio_url: 'https://heygen.example/narration.wav' } })
      if (url === 'https://heygen.example/narration.wav') return new Response(new Uint8Array([1]), { status: 200 })
      if (url.endsWith('/v3/videos')) return jsonResponse(200, { data: { video_id: 'vid-shared' } })
      if (url.includes('/v3/videos/vid-shared')) return jsonResponse(200, { data: { status: 'completed', video_url: 'https://heygen.example/vid-shared.mp4' } })
      if (url === 'https://heygen.example/vid-shared.mp4') return new Response(new Uint8Array([2]), { status: 200 })
      throw new Error(`unexpected URL ${url}`)
    }) as typeof fetch

    const clone = await createHeyGenVoiceClone({ presenterProfileId: 'p1', voiceStoragePath: 'voice.wav' }, fakeDeps)
    const narration = await generateHeyGenNarration({ presenterProfileId: 'p1', providerVoiceId: clone.providerVoiceId, text: 'weekly update' }, fakeDeps)
    const video = await createHeyGenAvatarVideo({ presenterProfileId: 'p1', avatarId: 'avatar-1', narrationAudioStoragePath: narration.generatedStoragePath }, fakeDeps)

    assert.equal(clone.providerVoiceId, 'clone-shared')
    assert.equal(video.providerVideoId, 'vid-shared')
  })
})

describe('HeyGen account info (non-billable, documented eligibility-adjacent check)', () => {
  test('getHeyGenAccountInfo: reports remaining quota converted to credits (quota ÷ 60, per HeyGen\'s own docs) — never claims this proves voice-clone entitlement', async () => {
    globalThis.fetch = (async (url: string) => {
      assert.match(url, /\/v2\/user\/remaining_quota$/)
      return jsonResponse(200, { data: { remaining_quota: 3600 } })
    }) as typeof fetch

    const info = await getHeyGenAccountInfo()
    assert.equal(info.remainingQuota, 3600)
    assert.equal(info.remainingCredits, 60)
  })
})

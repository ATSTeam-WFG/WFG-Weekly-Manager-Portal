// Run with: node --test api/video/presenter/authorizeGenerationRouteWiring.test.ts
//
// authorize-generation.ts has a real @supabase/supabase-js import chain
// (via adminAuth.js), so it isn't safe to execute directly here — same
// reasoning as api/_lib/completeProfileWiring.test.ts. This verifies its
// orchestration/security wiring via source inspection: authorization is
// re-checked before every action AND before every retry, media paths come
// from the database rather than the request body, and only a transient
// provider error is ever retried.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const dir = path.dirname(fileURLToPath(import.meta.url))
const src = readFileSync(path.join(dir, 'authorize-generation.ts'), 'utf8')

// Regression guard for the 2026-10-12 incident: a supabase-js .rpc(...)
// call returns a thenable that does NOT implement .catch()/.finally() as
// real methods (confirmed against the installed @supabase/postgrest-js —
// see api/_lib/supabasePromiseHelpers.ts's own header and
// supabasePromiseHelpers.test.ts for a real-execution reproduction).
// Chaining `.catch(...)` directly on one throws synchronously, which once
// replaced a real provider error with an unrelated TypeError and left a
// clip-job row stuck at 'pending'. This checks the WHOLE file, not just
// one branch, so this exact mistake can't quietly reappear anywhere else
// in this route either.
describe('regression guard — never chain .catch()/.finally() directly on an auth.supabase.rpc(...) call anywhere in this file', () => {
  test('every best-effort record-and-swallow uses recordBestEffort, never a raw .catch() on the rpc() builder', () => {
    assert.doesNotMatch(src, /\.rpc\([^)]*\)\s*\.catch\(/)
    assert.doesNotMatch(src, /\.rpc\([^)]*\)\s*\.finally\(/)
    assert.match(src, /import \{ recordBestEffort \} from '\.\.\/\.\.\/_lib\/supabasePromiseHelpers\.js'/)
    const recordBestEffortCallCount = (src.match(/recordBestEffort\(/g) ?? []).length
    assert.equal(recordBestEffortCallCount, 3, 'expected exactly the three known best-effort record sites (create_avatar, generate_narration, generate_avatar_video)')
  })
})

describe('item 4 — bound to the database-resolved profile/media, never a client-supplied path', () => {
  test('the photo/voice storage paths are loaded from video_presenter_media by ID, never taken from the request body', () => {
    assert.match(src, /from\('video_presenter_media'\)\.select\('storage_path'\)\.eq\('id', mediaId\)/)
    assert.doesNotMatch(src, /body\.(photoStoragePath|voiceStoragePath)/)
  })

  test('the presenter profile\'s provider state is read fresh from the database by presenterProfileId, not trusted from the request', () => {
    assert.match(src, /from\('video_presenter_profiles'\)/)
    assert.match(src, /\.eq\('id', presenterProfileId\)/)
  })
})

describe('item 5 — authorization is re-checked immediately before every provider request, and before every retry', () => {
  test('the retry loop calls recheckAuthorization on every iteration, before the try block that performs the provider call', () => {
    const loopMatch = src.match(/for \(let attempt = 1; attempt <= MAX_ATTEMPTS; attempt\+\+\) \{([\s\S]*?)\n    \}\n\n    console\.error/)
    assert.ok(loopMatch, 'could not locate the retry loop body')
    const recheckIndex = loopMatch[1].indexOf('recheckAuthorization()')
    const tryIndex = loopMatch[1].indexOf('try {')
    assert.ok(recheckIndex > -1 && tryIndex > -1, 'expected both the recheck call and the try block inside the loop')
    assert.ok(recheckIndex < tryIndex, 'authorization must be rechecked BEFORE the try block that calls the provider, on every loop iteration (every attempt, including retries)')
  })

  test('recheckAuthorization calls the authorize_video_generation RPC (never a cached/remembered result)', () => {
    const fn = src.match(/const recheckAuthorization = async[\s\S]*?\n    \}\n/)
    assert.ok(fn)
    assert.match(fn[0], /rpc\('authorize_video_generation'/)
  })
})

describe('retry policy — only a transient provider error is ever retried', () => {
  test('ProviderJobFailedError returns immediately (502) without looping again', () => {
    assert.match(src, /if \(err instanceof ProviderJobFailedError\) \{[\s\S]*?return sendError\(res, 502, 'PROVIDER_JOB_FAILED'/)
  })

  test('ProviderVerificationRequiredError returns immediately (409) without looping again', () => {
    assert.match(src, /if \(err instanceof ProviderVerificationRequiredError\) \{[\s\S]*?return sendError\(res, 409, 'PROVIDER_VERIFICATION_REQUIRED'/)
  })

  test('ProviderNotConfiguredError and ProviderCallsDisabledError both return immediately, never attempting a retry', () => {
    assert.match(src, /if \(err instanceof ProviderNotConfiguredError\) \{[\s\S]*?return sendError\(res, 501, 'PROVIDER_NOT_CONFIGURED'/)
    assert.match(src, /if \(err instanceof ProviderCallsDisabledError\) \{[\s\S]*?return sendError\(res, 501, 'PROVIDER_CALLS_DISABLED'/)
  })

  test('only ProviderRequestError triggers another loop iteration, and only while attempts remain, and never for create_avatar/generate_narration/generate_avatar_video', () => {
    assert.match(src, /const NEVER_AUTO_RETRY_ACTIONS: ReadonlySet<Action> = new Set\(\['create_avatar', 'generate_narration', 'generate_avatar_video'\]\)/)
    assert.match(src, /if \(err instanceof ProviderRequestError && attempt < MAX_ATTEMPTS && !NEVER_AUTO_RETRY_ACTIONS\.has\(action\)\) \{\s*\n[\s\S]*?continue\s*\n\s*\}/)
  })

  test('MAX_ATTEMPTS is small and bounded (a genuine retry policy, never an unbounded loop)', () => {
    const match = src.match(/const MAX_ATTEMPTS = (\d+)/)
    assert.ok(match)
    const n = Number(match[1])
    assert.ok(n >= 1 && n <= 5, `MAX_ATTEMPTS should be a small bounded number, got ${n}`)
  })
})

describe('HeyGen-only voice integration — HeyGen is the default, ElevenLabs stays intact as a fallback, selected only by the caller\'s own provider field', () => {
  test('clone_voice branches on provider: heygen calls createHeyGenVoiceClone + record_heygen_voice_provider, falling through to the untouched ElevenLabs path otherwise', () => {
    assert.match(src, /if \(action === 'clone_voice'\) \{[\s\S]*?if \(provider === 'heygen'\) \{[\s\S]*?createHeyGenVoiceClone\(/)
    assert.match(src, /if \(action === 'clone_voice'\) \{[\s\S]*?if \(provider === 'heygen'\) \{[\s\S]*?rpc\('record_heygen_voice_provider'/)
    assert.match(src, /if \(action === 'clone_voice'\) \{[\s\S]*?createElevenLabsVoiceClone\(/)
    assert.match(src, /if \(action === 'clone_voice'\) \{[\s\S]*?rpc\('record_elevenlabs_voice_provider'/)
  })

  test('generate_narration branches on provider the same way: heygen calls generateHeyGenNarration, otherwise the untouched generateElevenLabsNarration path runs', () => {
    assert.match(src, /if \(action === 'generate_narration'\) \{[\s\S]*?if \(provider === 'heygen'\) \{[\s\S]*?generateHeyGenNarration\(/)
    assert.match(src, /if \(action === 'generate_narration'\) \{[\s\S]*?generateElevenLabsNarration\(/)
  })

  test('the profile row now also selects heygen_voice_provider_id/status alongside the untouched heygen_avatar_* and elevenlabs_* columns', () => {
    assert.match(src, /heygen_voice_provider_id, heygen_voice_provider_status/)
    assert.match(src, /heygen_avatar_provider_id, heygen_provider_status/)
    assert.match(src, /elevenlabs_voice_provider_id, elevenlabs_provider_status/)
  })

  test('generate_avatar_video remains provider-agnostic — never branching on the caller\'s provider field (it always targets HeyGen)', () => {
    const fn = src.slice(src.indexOf('// generate_avatar_video'))
    assert.doesNotMatch(fn.slice(0, fn.indexOf('return res.status(200).json(result)')), /provider === 'heygen'/)
  })
})

describe('create_avatar — atomic server-side claim closes the concurrent-request race (not just a disabled UI button or a read-then-write guard)', () => {
  const branch = src.slice(src.indexOf("if (action === 'create_avatar') {"), src.indexOf("if (action === 'clone_voice') {"))

  test('the kill switch is checked explicitly before ever calling the claim RPC, so a disabled call writes nothing to the database', () => {
    const switchCheckIndex = branch.indexOf("process.env.VIDEO_PROVIDER_CALLS_ENABLED !== 'true'")
    const claimCallIndex = branch.indexOf("rpc('claim_heygen_avatar_creation'")
    assert.ok(switchCheckIndex > -1 && claimCallIndex > -1)
    assert.ok(switchCheckIndex < claimCallIndex, 'the kill-switch check must happen before the atomic claim is attempted')
    assert.match(branch, /throw new ProviderCallsDisabledError\(\)/)
  })

  test('claims via the atomic claim_heygen_avatar_creation RPC — a single compare-and-swap, not a read then a separate write', () => {
    assert.match(branch, /\.rpc\('claim_heygen_avatar_creation', \{ p_profile_id: presenterProfileId \}\)/)
    assert.doesNotMatch(branch, /from\('video_presenter_profiles'\)\.select/)
  })

  test('the claim RPC result is checked before createHeyGenAvatar is ever called', () => {
    const claimCallIndex = branch.indexOf("rpc('claim_heygen_avatar_creation'")
    const claimedCheckIndex = branch.indexOf('if (!claim.claimed)')
    const createCallIndex = branch.indexOf('createHeyGenAvatar(')
    assert.ok(claimCallIndex > -1 && claimedCheckIndex > -1 && createCallIndex > -1)
    assert.ok(claimCallIndex < claimedCheckIndex && claimedCheckIndex < createCallIndex)
  })

  test('an already-ready avatar (claim not granted, status ready) short-circuits with the real provider id, before any HeyGen call', () => {
    assert.match(branch, /claim\.current_status === 'ready'[\s\S]*?alreadyReady: true/)
  })

  test('a live "pending" status (claim not granted) is rejected with 409 — the concurrent-request guard — without calling HeyGen', () => {
    assert.match(branch, /claim\.current_status === 'pending'[\s\S]{0,400}sendError\(res, 409, 'AVATAR_CREATION_IN_PROGRESS'/)
  })

  test('a live "uncertain" status (claim not granted) is rejected with its own distinct 409 — never silently treated as claimable', () => {
    assert.match(branch, /claim\.current_status === 'uncertain'[\s\S]{0,600}sendError\(\s*\n\s*res,\s*\n\s*409,\s*\n\s*'AVATAR_CREATION_UNCERTAIN'/)
  })

  test('any other non-claimed status falls through to a generic, still-rejecting 409, never a silent fallthrough to createHeyGenAvatar', () => {
    assert.match(branch, /sendError\(res, 409, 'AVATAR_CREATION_NOT_CLAIMABLE'/)
  })

  test('a successful creation records "ready" with the real provider id returned by HeyGen', () => {
    assert.match(branch, /p_provider_avatar_id: result\.providerAvatarId, p_status: 'ready'/)
  })

  test('ProviderJobFailedError and ProviderNotConfiguredError are recorded as the DEFINITE "failed" status; every other error (including a poll timeout) is recorded as "uncertain", never immediately re-claimable', () => {
    const catchBlock = branch.slice(branch.indexOf('} catch (err) {'))
    assert.match(catchBlock, /err instanceof ProviderJobFailedError \|\| err instanceof ProviderNotConfiguredError \? 'failed' : 'uncertain'/)
    assert.match(catchBlock, /\n\s*throw err\s*\n/)
  })

  test('never leaves the row silently unrecorded on error — the failed/uncertain write happens even if it itself errors (via recordBestEffort, never a raw .catch() chained on the rpc() builder)', () => {
    const catchBlock = branch.slice(branch.indexOf('} catch (err) {'))
    assert.match(catchBlock, /recordBestEffort\(/)
    assert.doesNotMatch(catchBlock, /\.rpc\([^)]*\)\s*\.catch\(/)
  })
})

describe('generate_narration (HeyGen) — same atomic claim/duplicate-charge protection as create_avatar, scoped per scene', () => {
  const heygenBranchStart = src.indexOf("if (action === 'generate_narration') {")
  const heygenBranchEnd = src.indexOf("// ElevenLabs fallback path")
  const branch = src.slice(heygenBranchStart, heygenBranchEnd)

  test('sceneId is required, and parsed/validated once near the top of the handler (shared by generate_narration and generate_avatar_video)', () => {
    assert.match(src, /const rawSceneId = typeof body\.sceneId === 'string' \? body\.sceneId : undefined/)
    assert.match(src, /const sceneId = rawSceneId && \/\^\[a-z0-9-\]\+\$\/i\.test\(rawSceneId\) \? rawSceneId : undefined/)
    assert.match(branch, /if \(!sceneId\) return sendError\(res, 400, 'INVALID_REQUEST', 'sceneId is required for generate_narration\.'\)/)
  })

  test('the kill switch is checked explicitly before claiming, so a disabled call writes nothing to the database', () => {
    const switchCheckIndex = branch.indexOf("process.env.VIDEO_PROVIDER_CALLS_ENABLED !== 'true'")
    const claimCallIndex = branch.indexOf("rpc('claim_heygen_clip_narration'")
    assert.ok(switchCheckIndex > -1 && claimCallIndex > -1)
    assert.ok(switchCheckIndex < claimCallIndex)
  })

  test('claims via the atomic claim_heygen_clip_narration RPC, scoped by sceneId, before ever calling the provider', () => {
    assert.match(branch, /\.rpc\('claim_heygen_clip_narration', \{ p_profile_id: presenterProfileId, p_scene_id: sceneId \}\)/)
    const claimCallIndex = branch.indexOf("rpc('claim_heygen_clip_narration'")
    const providerCallIndex = branch.indexOf('generateHeyGenNarration(')
    assert.ok(claimCallIndex > -1 && providerCallIndex > -1 && claimCallIndex < providerCallIndex)
  })

  test('an already-ready narration short-circuits with the stored audio path, never calling the provider again', () => {
    assert.match(branch, /claim\.current_status === 'ready'[\s\S]{0,200}generatedStoragePath: claim\.current_audio_path, alreadyReady: true/)
  })

  test('"pending" and "uncertain" are each rejected with their own distinct 409, never silently falling through to the provider call', () => {
    assert.match(branch, /claim\.current_status === 'pending'[\s\S]{0,300}sendError\(res, 409, 'NARRATION_IN_PROGRESS'/)
    assert.match(branch, /claim\.current_status === 'uncertain'[\s\S]{0,400}sendError\(\s*\n\s*res,\s*\n\s*409,\s*\n\s*'NARRATION_UNCERTAIN'/)
  })

  test('a successful generation records "ready" with the real storage path HeyGen produced', () => {
    assert.match(branch, /p_audio_storage_path: result\.generatedStoragePath/)
  })

  test('a job failure/not-configured error is recorded as the DEFINITE "failed" status; every other error is "uncertain"', () => {
    const catchBlock = branch.slice(branch.indexOf('} catch (err) {'))
    assert.match(catchBlock, /err instanceof ProviderJobFailedError \|\| err instanceof ProviderNotConfiguredError \? 'failed' : 'uncertain'/)
    assert.match(catchBlock, /recordBestEffort\(/)
    assert.match(catchBlock, /\n\s*throw err\s*\n/)
  })

  test('the ElevenLabs fallback path is untouched — no claim/tracking logic added there, by explicit scope decision', () => {
    const elevenLabsBranch = src.slice(heygenBranchEnd, src.indexOf("// generate_avatar_video"))
    assert.doesNotMatch(elevenLabsBranch, /claim_heygen_clip_narration|video_presenter_clip_jobs/)
    assert.match(elevenLabsBranch, /generateElevenLabsNarration\(/)
  })
})

describe('generate_avatar_video — same protection, and the narration audio path comes from the DB claim, never the request body', () => {
  const branch = src.slice(src.indexOf('// generate_avatar_video'))

  test('sceneId is required, and the avatar must already be ready (unchanged precondition)', () => {
    assert.match(branch, /if \(!sceneId\) return sendError\(res, 400, 'INVALID_REQUEST', 'sceneId is required for generate_avatar_video\.'\)/)
    assert.match(branch, /if \(!profile\.heygen_avatar_provider_id \|\| profile\.heygen_provider_status !== 'ready'\)/)
  })

  test('the kill switch is checked explicitly before claiming', () => {
    const switchCheckIndex = branch.indexOf("process.env.VIDEO_PROVIDER_CALLS_ENABLED !== 'true'")
    const claimCallIndex = branch.indexOf("rpc('claim_heygen_clip_video'")
    assert.ok(switchCheckIndex > -1 && claimCallIndex > -1 && switchCheckIndex < claimCallIndex)
  })

  test('a not-yet-ready narration is reported as INVALID_STATE, never silently proceeding to call HeyGen', () => {
    assert.match(branch, /claim\.narration_status !== 'ready'[\s\S]{0,300}sendError\(\s*\n\s*res,\s*\n\s*400,\s*\n\s*'INVALID_STATE'/)
  })

  test('an already-ready video short-circuits with the stored result, and "pending"/"uncertain" each get their own distinct 409', () => {
    assert.match(branch, /claim\.video_status === 'ready'[\s\S]{0,200}alreadyReady: true/)
    assert.match(branch, /claim\.video_status === 'pending'[\s\S]{0,300}sendError\(\s*\n\s*res,\s*\n\s*409,\s*\n\s*'AVATAR_VIDEO_IN_PROGRESS'/)
    assert.match(branch, /claim\.video_status === 'uncertain'[\s\S]{0,400}sendError\(\s*\n\s*res,\s*\n\s*409,\s*\n\s*'AVATAR_VIDEO_UNCERTAIN'/)
  })

  test('the narration audio path passed to HeyGen comes from the claim result (the DB), never from a client-supplied narrationAudioStoragePath', () => {
    assert.match(branch, /narrationAudioStoragePath: claim\.narration_audio_path/)
    assert.doesNotMatch(branch, /body\.narrationAudioStoragePath/)
  })

  test('a successful generation records "ready" with the real provider video id and storage path', () => {
    assert.match(branch, /p_provider_video_id: result\.providerVideoId,\s*\n\s*p_generated_storage_path: result\.generatedStoragePath/)
  })

  test('error classification and swallowed-recording-failure match create_avatar\'s own discipline', () => {
    const catchBlockStart = branch.indexOf("rpc('record_heygen_clip_video'", branch.indexOf('} catch (err) {'))
    const catchBlock = branch.slice(branch.indexOf('} catch (err) {'), catchBlockStart + 400)
    assert.match(catchBlock, /err instanceof ProviderJobFailedError \|\| err instanceof ProviderNotConfiguredError \? 'failed' : 'uncertain'/)
    assert.match(catchBlock, /recordBestEffort\(/)
  })
})

describe('authentication/authorization gate itself', () => {
  test('every request is authenticated as an admin before anything else runs', () => {
    assert.match(src, /const auth = await authenticateAdmin\(/)
  })

  test('a denied authorization check returns 403 GENERATION_NOT_AUTHORIZED and never falls through to a provider call', () => {
    const recheckFn = src.match(/const recheckAuthorization = async[\s\S]*?\n    \}\n/)![0]
    assert.match(recheckFn, /return \{ ok: false,/)
    assert.match(src, /if \(!authCheck\.ok\) \{\s*\n\s*return sendError\(res, authCheck\.status, 'GENERATION_NOT_AUTHORIZED'/)
  })
})

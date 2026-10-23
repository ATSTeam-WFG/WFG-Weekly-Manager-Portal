// Run with: node --test src/lib/videoCreationPresenterSafeguardsWiring.test.ts
//
// VideoCreation.tsx/VideoCreationGenerate.tsx/VideoCreationPreview.tsx
// import supabaseClient.ts transitively (via videoConsentService.ts), so —
// like every other Supabase-touching component in this app — none can be
// imported and executed directly under plain `node --test`; verified via
// source inspection instead, the same established pattern used throughout
// this project (see videoCreationSourceStoryboardWiring.test.ts).
// hasReadyTalkingPresenter's own real behavior is covered by direct
// execution in videoStoryboard.test.ts.
//
// Covers the wizard-level safeguards against accidentally skipping or
// losing the talking-presenter clips: a persistent Ready/Not-Set
// indicator, a confirmation before generating without one, a warning
// before Source/Resume replace a storyboard that already has one, and
// read-only restoration of already-successful clips (never a new paid
// generation) when the wizard is reopened.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const dir = path.dirname(fileURLToPath(import.meta.url))
const vcSrc = readFileSync(path.join(dir, '..', 'components', 'VideoCreation.tsx'), 'utf8')
const vcGenerateSrc = readFileSync(path.join(dir, '..', 'components', 'VideoCreationGenerate.tsx'), 'utf8')
const vcTemplateSrc = readFileSync(path.join(dir, '..', 'components', 'VideoCreationTemplate.tsx'), 'utf8')
const vcPreviewSrc = readFileSync(path.join(dir, '..', 'components', 'VideoCreationPreview.tsx'), 'utf8')
const badgeSrc = readFileSync(path.join(dir, '..', 'components', 'TalkingPresenterStatus.tsx'), 'utf8')
const consentServiceSrc = readFileSync(path.join(dir, 'videoConsentService.ts'), 'utf8')

describe('TalkingPresenterStatus — one shared Ready/Not-Set indicator, reused rather than duplicated', () => {
  test('renders from hasReadyTalkingPresenter, never its own ad hoc check', () => {
    assert.match(badgeSrc, /const ready = hasReadyTalkingPresenter\(storyboard\)/)
  })

  test('reuses the existing vc-avatar-consent-badge visual language instead of introducing new CSS', () => {
    assert.match(badgeSrc, /vc-avatar-consent-badge/)
    assert.match(badgeSrc, /vc-avatar-consent-badge-ready/)
  })

  test('is wired into Preview, Generate, and Final Download — all three steps named in the requirement', () => {
    assert.match(vcTemplateSrc, /<TalkingPresenterStatus storyboard={storyboard} \/>/)
    assert.match(vcGenerateSrc, /<TalkingPresenterStatus storyboard={storyboard} \/>/)
    assert.match(vcPreviewSrc, /<TalkingPresenterStatus storyboard={storyboard} \/>/)
  })

  test('Final Download (VideoCreationPreview) now receives storyboard as a real prop, not just fileName', () => {
    assert.match(vcPreviewSrc, /interface VideoCreationPreviewProps \{[\s\S]*?storyboard: VideoStoryboard/)
    assert.match(vcSrc, /<VideoCreationPreview fileName={renderedFileName} storyboard={storyboard} onBackToTemplate={handleBackToGenerate} \/>/)
  })
})

describe('Generate — confirms rather than silently proceeding when the talking presenter is not ready', () => {
  test('the Generate button routes through a presenter-readiness check before ever calling the render function', () => {
    const clickHandlerIndex = vcGenerateSrc.indexOf('const handleGenerateClick')
    const renderCallIndex = vcGenerateSrc.indexOf('renderStoryboardLocally(storyboard, narrationVoice)')
    assert.ok(clickHandlerIndex > -1 && renderCallIndex > -1)
    assert.match(vcGenerateSrc, /if \(!presenterReady\) \{\s*\n\s*setConfirmingMissingPresenter\(true\)\s*\n\s*return\s*\n\s*\}/)
  })

  test('it is advisory only — a standard (no-presenter) video can still be generated via "Continue without presenter", never a hard block', () => {
    assert.match(vcGenerateSrc, /handleContinueWithoutPresenter[\s\S]{0,200}void handleGenerate\(\)/)
    assert.match(vcGenerateSrc, /Continue without presenter/)
  })

  test('offers a direct path back to Presenter & Voice from the confirmation, via a real prop wired at the wizard level', () => {
    assert.match(vcGenerateSrc, /onGoToPresenter: \(\) => void/)
    assert.match(vcGenerateSrc, /onClick={onGoToPresenter}/)
    assert.match(vcSrc, /<VideoCreationGenerate[\s\S]{0,300}onGoToPresenter={handleBackToPresenter}/)
  })

  test('the confirmation explains what will happen (standard logo-card opening/closing), not just a bare yes/no', () => {
    assert.match(vcGenerateSrc, /standard logo-card opening and closing/)
  })
})

describe('VideoCreation.tsx — warns before Source/Resume replace a storyboard that already has prepared presenter clips', () => {
  test('handleCreateVideo checks hasReadyTalkingPresenter on the OUTGOING storyboard before replacing it, and aborts on cancel', () => {
    const fn = vcSrc.slice(vcSrc.indexOf('const handleCreateVideo ='), vcSrc.indexOf('const handleResumeFromCheckpoint ='))
    assert.match(fn, /if \(storyboard && hasReadyTalkingPresenter\(storyboard\)\) \{/)
    assert.match(fn, /window\.confirm\(/)
    assert.match(fn, /if \(!confirmed\) return/)
  })

  test('handleResumeFromCheckpoint performs the identical check — the resume path cannot silently bypass it either', () => {
    const fn = vcSrc.slice(vcSrc.indexOf('const handleResumeFromCheckpoint ='), vcSrc.indexOf('const handleBackToSource ='))
    assert.match(fn, /if \(storyboard && hasReadyTalkingPresenter\(storyboard\)\) \{/)
    assert.match(fn, /window\.confirm\(/)
    assert.match(fn, /if \(!confirmed\) return/)
  })

  test('both handlers restore already-successful clips onto the INCOMING storyboard via restoreReadyPresenterClips, not just replace it blind', () => {
    const createFn = vcSrc.slice(vcSrc.indexOf('const handleCreateVideo ='), vcSrc.indexOf('const handleResumeFromCheckpoint ='))
    const resumeFn = vcSrc.slice(vcSrc.indexOf('const handleResumeFromCheckpoint ='), vcSrc.indexOf('const handleBackToSource ='))
    assert.match(createFn, /restoreReadyPresenterClips\(nextStoryboard, currentProfileId\)/)
    assert.match(resumeFn, /restoreReadyPresenterClips\(checkpoint\.storyboard, currentProfileId\)/)
  })
})

describe('restoreReadyPresenterClips — read-only restoration, never a new paid generation', () => {
  const fn = vcSrc.slice(vcSrc.indexOf('async function restoreReadyPresenterClips'), vcSrc.indexOf('export default function VideoCreation'))

  test('only reads from Supabase (listMyPresenterProfiles/listPresenterClipJobs) and downloads an already-generated local asset — never claims or records a provider job', () => {
    assert.match(fn, /listMyPresenterProfiles\(ownerId\)/)
    assert.match(fn, /listPresenterClipJobs\(profile\.id\)/)
    assert.match(fn, /prepareAvatarAssetLocally\(scene\.id, job\.generatedStoragePath\)/)
    assert.doesNotMatch(fn, /claim_heygen_clip|record_heygen_clip|createHeyGenAvatarVideo|generateHeyGenNarration/)
  })

  test('only restores onto opening/closing scenes, and only when the scene does not already have a clip attached', () => {
    assert.match(fn, /\(scene\.type !== 'opening' && scene\.type !== 'closing'\) \|\| scene\.avatarVideoAssetPath\) return scene/)
  })

  test('only restores a job that is genuinely video_status === \'ready\' with a real storage path — never pending/failed/uncertain', () => {
    assert.match(fn, /if \(!job \|\| job\.videoStatus !== 'ready' \|\| !job\.generatedStoragePath\) return scene/)
  })

  test('compatibility is matched by sceneId against the job\'s own sceneId — never attaches a job meant for a different scene', () => {
    assert.match(fn, /jobs\.find\(\(j\) => j\.sceneId === scene\.id\)/)
  })

  test('a local download failure or any other error leaves the storyboard unchanged rather than throwing or blocking navigation', () => {
    assert.match(fn, /catch \{[\s\S]{0,400}return scene\s*\n\s*\}/)
    assert.match(fn, /\/\/ Restoration is best-effort only[\s\S]{0,80}return \{ storyboard, warnings \}/)
  })

  test('verifies the scene\'s CURRENT narrationText against the fixed expected text before ever restoring — a mismatch is never silently attached', () => {
    assert.match(fn, /const expectedText = expectedFixedNarrationText\(scene\.type\)/)
    assert.match(fn, /if \(scene\.narrationText !== expectedText\) \{/)
    const mismatchBlockIndex = fn.indexOf('if (scene.narrationText !== expectedText) {')
    const downloadCallIndex = fn.indexOf('prepareAvatarAssetLocally(')
    assert.ok(mismatchBlockIndex > -1 && downloadCallIndex > -1 && mismatchBlockIndex < downloadCallIndex, 'the narration-text check must happen before any local download/attach')
  })

  test('a narration mismatch pushes a clear, specific warning and returns the scene UNCHANGED (no avatarVideoAssetPath attached)', () => {
    const mismatchBlock = fn.slice(fn.indexOf('if (scene.narrationText !== expectedText) {'), fn.indexOf('try {\n          const local = await prepareAvatarAssetLocally'))
    assert.match(mismatchBlock, /warnings\.push\(/)
    assert.match(mismatchBlock, /narration text has changed since then/)
    assert.match(mismatchBlock, /NOT automatically reused/)
    assert.match(mismatchBlock, /return scene\s*\n\s*\}/)
  })

  test('never resets, deletes, or regenerates the underlying clip job — the mismatch path only skips local attachment, it never calls a claim/record/resolve RPC', () => {
    assert.doesNotMatch(fn, /claim_heygen_clip|record_heygen_clip|resolve_uncertain_heygen_clip/)
  })
})

describe('Narration-compatibility warnings surface to the user rather than being swallowed', () => {
  test('handleCreateVideo and handleResumeFromCheckpoint both show any returned warnings before committing the restored storyboard', () => {
    const createFn = vcSrc.slice(vcSrc.indexOf('const handleCreateVideo ='), vcSrc.indexOf('const handleResumeFromCheckpoint ='))
    const resumeFn = vcSrc.slice(vcSrc.indexOf('const handleResumeFromCheckpoint ='), vcSrc.indexOf('const handleBackToSource ='))
    for (const fn of [createFn, resumeFn]) {
      assert.match(fn, /const \{ storyboard: restored, warnings \} = await restoreReadyPresenterClips\(/)
      assert.match(fn, /if \(warnings\.length > 0\) window\.alert\(warnings\.join\('\\n\\n'\)\)/)
      assert.match(fn, /setStoryboard\(restored\)/)
    }
  })
})

describe('listPresenterClipJobs — read-only, admin-RLS-gated, never a write path', () => {
  const fn = consentServiceSrc.slice(consentServiceSrc.indexOf('export async function listPresenterClipJobs'))

  test('selects only, never inserts/updates/deletes against video_presenter_clip_jobs', () => {
    assert.match(fn, /\.from\('video_presenter_clip_jobs'\)\s*\n\s*\.select\(/)
    assert.doesNotMatch(fn.slice(0, 400), /\.insert\(|\.update\(|\.delete\(/)
  })

  test('scopes the read by presenter_profile_id — never returns another profile\'s clip jobs', () => {
    assert.match(fn, /\.eq\('presenter_profile_id', presenterProfileId\)/)
  })
})

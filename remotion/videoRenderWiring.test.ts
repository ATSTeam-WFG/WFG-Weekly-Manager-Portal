// Run with: node --test remotion/videoRenderWiring.test.ts
//
// Covers cross-cutting rendering-pipeline guarantees that a single scene
// component's own file can't prove alone. The scene components themselves
// are .tsx — Node's built-in type-stripping erases TypeScript types but
// does not transform JSX, so (as with sceneRegistry.test.ts) they are
// verified here via direct source inspection rather than import + render.
// Where a guarantee is checkable by REAL execution against the actual
// filesystem/git state (item 10, gitignore) this file does that instead
// of inspecting text.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const remotionDir = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.dirname(remotionDir)

function read(...parts: string[]): string {
  return readFileSync(path.join(projectRoot, ...parts), 'utf8')
}

// Same line-comment-stripping pattern used throughout this codebase's
// wiring tests — a forbidden-pattern check must only ever match real code,
// never a comment that's simply EXPLAINING why the code doesn't do that
// thing (e.g. WfgExecutiveVideo.tsx's own comment mentioning "the plain
// <Series> this used before").
const stripComments = (source: string) =>
  source
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, ''))
    .join('\n')

const wfgExecutiveVideoSrc = read('remotion', 'WfgExecutiveVideo.tsx')
const riskSrc = read('remotion', 'scenes', 'RiskScene.tsx')
const forwardLookSrc = read('remotion', 'scenes', 'ForwardLookScene.tsx')
const multiMetricSrc = read('remotion', 'scenes', 'MultiMetricScene.tsx')
const bigMetricSrc = read('remotion', 'scenes', 'BigMetricScene.tsx')
const openingSrc = read('remotion', 'scenes', 'OpeningScene.tsx')
const closingSrc = read('remotion', 'scenes', 'ClosingScene.tsx')
const fallbackSrc = read('remotion', 'scenes', 'FallbackScene.tsx')
const renderScriptSrc = read('scripts', 'render-storyboard.mts')
const devPluginSrc = read('dev', 'local-video-render-plugin.ts')
const packageJsonSrc = read('package.json')
const narrationTimingSrc = read('remotion', 'narrationTiming.ts')
const durationSrc = read('remotion', 'duration.ts')
const narrationAudioSrc = read('scripts', 'lib', 'narrationAudio.mts')
const avatarVideoAssetsSrc = read('scripts', 'lib', 'avatarVideoAssets.mts')
const localAvatarAssetPluginSrc = read('dev', 'local-avatar-asset-plugin.ts')
const fluxAssetsSrc = read('scripts', 'lib', 'fluxAssets.mts')
const fluxPromptsSrc = read('remotion', 'fluxPrompts.ts')

describe('3. storyboard content is not mutated by the renderer', () => {
  test('WfgExecutiveVideo only ever reads storyboard.scenes (via .map) — no assignment into scene/storyboard fields, no push/splice/sort on scene arrays', () => {
    assert.match(wfgExecutiveVideoSrc, /storyboard\.scenes\.map\(/)
    assert.doesNotMatch(wfgExecutiveVideoSrc, /storyboard\.\w+\s*=/)
    assert.doesNotMatch(wfgExecutiveVideoSrc, /scene\.\w+\s*=[^=]/)
    assert.equal(/\.push\(|\.splice\(|\.sort\(/.test(wfgExecutiveVideoSrc), false)
  })

  test('render-storyboard.mts parses the posted JSON, augments it ONLY via the documented FLUX-asset, then avatar-video-measurement, then narration/retiming steps (chained, never independent branches), and hands the SAME resulting `storyboard` object to both selectComposition and renderMedia — never two different reshapings', () => {
    assert.match(renderScriptSrc, /const rawStoryboard = JSON\.parse\(readFileSync\(storyboardPath, 'utf8'\)\)/)
    assert.match(renderScriptSrc, /const storyboardWithFluxAssets = await generateFluxAssetsAndAttach\(rawStoryboard\)/)
    assert.match(renderScriptSrc, /const storyboardWithAvatarAssets = await prepareAvatarVideoAssets\(storyboardWithFluxAssets, PUBLIC_DIR\)/)
    assert.match(renderScriptSrc, /const storyboard = await generateNarrationAndRetime\(storyboardWithAvatarAssets, NARRATION_DIR, voice\)/)
    const selectCall = renderScriptSrc.match(/selectComposition\(\{[\s\S]*?\}\)/)?.[0] ?? ''
    const renderCall = renderScriptSrc.match(/renderMedia\(\{[\s\S]*?\}\)/)?.[0] ?? ''
    assert.match(selectCall, /inputProps: \{ storyboard \}/)
    assert.match(renderCall, /inputProps: \{ storyboard \}/)
  })

  test('the dev render bridge writes the posted storyboard to disk verbatim (JSON.stringify of the exact request body) — no field stripped or defaulted in transit', () => {
    assert.match(devPluginSrc, /writeFileSync\(STORYBOARD_INPUT_PATH, JSON\.stringify\(body\.storyboard\)\)/)
  })
})

describe('4. structured metric label/value/context are preserved through to the rendered frame', () => {
  test('MultiMetricScene renders metric.label, metric.value, and metric.context directly — no renaming, truncation, or fallback text substituted for real content', () => {
    assert.match(multiMetricSrc, /\{metric\.label\}/)
    assert.match(multiMetricSrc, /\{metric\.value\}/)
    assert.match(multiMetricSrc, /\{metric\.context\}/)
  })

  test('BigMetricScene renders metric.label/value/context the same way for the single-dominant-number layout', () => {
    assert.match(bigMetricSrc, /metric\.label/)
    assert.match(bigMetricSrc, /metric\.value/)
    assert.match(bigMetricSrc, /metric\.context/)
  })
})

describe('6. opening/closing render correctly', () => {
  test('OpeningScene renders scene.title and (when present) scene.body — the actual storyboard-provided title/week text, never a hardcoded placeholder string', () => {
    assert.match(openingSrc, /\{scene\.title\}/)
    assert.match(openingSrc, /scene\.body &&/)
    assert.match(openingSrc, /\{scene\.body\}/)
  })

  test('ClosingScene renders scene.body (the tagline) and includes the real WFG logo asset (via the shared BrandPlate component) — never invents its own closing copy', () => {
    // V3 cinematic pass: the literal staticFile('wfg-logo.png') call moved
    // into cinematicChrome.tsx's shared BrandPlate (reused by both
    // Opening/ClosingScene) — this still proves the real logo asset is
    // used, just one level of indirection later.
    assert.match(closingSrc, /<BrandPlate/)
    assert.match(closingSrc, /import \{ GlowField, BrandPlate \} from '\.\.\/cinematicChrome'/)
    const brandPlateSrc = read('remotion', 'cinematicChrome.tsx')
    assert.match(brandPlateSrc, /staticFile\('wfg-logo\.png'\)/)
    assert.match(closingSrc, /\{scene\.body\}/)
  })
})

describe('7. risk scene\'s Next/action content is preserved', () => {
  test('RiskScene renders scene.next verbatim inside its own dedicated "Next Step" callout, only when present — never fabricated when absent', () => {
    assert.match(riskSrc, /scene\.next &&/)
    assert.match(riskSrc, /\{scene\.next\}/)
    assert.match(riskSrc, /Next Step/)
  })
})

describe('8. forward-look content is preserved', () => {
  test('ForwardLookScene renders every bullet from scene.bullets (falling back to a single scene.next only if bullets is entirely absent) — no truncation to a fixed count before mapping', () => {
    assert.match(forwardLookSrc, /scene\.bullets \?\? \(scene\.next \? \[scene\.next\] : \[\]\)/)
    assert.match(forwardLookSrc, /bullets\.map\(/)
  })
})

describe('10. the generated video output directory is actually gitignored (real git check, not text inspection)', () => {
  test('git check-ignore reports output/video/<file>.mp4 as ignored', () => {
    mkdirSync(path.join(projectRoot, 'output', 'video'), { recursive: true })
    const probePath = path.join('output', 'video', `wiring-test-probe-${process.pid}.mp4`)
    writeFileSync(path.join(projectRoot, probePath), '')
    try {
      const result = execFileSync('git', ['check-ignore', probePath], { cwd: projectRoot, encoding: 'utf8' })
      assert.match(result.trim(), /^output\/video\/wiring-test-probe-\d+\.mp4$|output\/$|^output\/video\/$/)
    } finally {
      rmSync(path.join(projectRoot, probePath), { force: true })
    }
  })

  test('git status --porcelain does not list anything under output/ as untracked', () => {
    const status = execFileSync('git', ['status', '--porcelain', 'output'], { cwd: projectRoot, encoding: 'utf8' })
    assert.equal(status.trim(), '')
  })

  test('15. locally-synthesized narration audio (remotion/public/narration/) is also gitignored', () => {
    mkdirSync(path.join(projectRoot, 'remotion', 'public', 'narration'), { recursive: true })
    const probePath = path.join('remotion', 'public', 'narration', `wiring-test-probe-${process.pid}.wav`)
    writeFileSync(path.join(projectRoot, probePath), '')
    try {
      const result = execFileSync('git', ['check-ignore', probePath], { cwd: projectRoot, encoding: 'utf8' })
      assert.match(result.trim(), /narration/)
    } finally {
      rmSync(path.join(projectRoot, probePath), { force: true })
    }
  })

  test('locally-generated FLUX assets (remotion/public/flux-assets/) are also gitignored', () => {
    mkdirSync(path.join(projectRoot, 'remotion', 'public', 'flux-assets'), { recursive: true })
    const probePath = path.join('remotion', 'public', 'flux-assets', `wiring-test-probe-${process.pid}.png`)
    writeFileSync(path.join(projectRoot, probePath), '')
    try {
      const result = execFileSync('git', ['check-ignore', probePath], { cwd: projectRoot, encoding: 'utf8' })
      assert.match(result.trim(), /flux-assets/)
    } finally {
      rmSync(path.join(projectRoot, probePath), { force: true })
    }
  })
})

describe('9. narration audio is included in the final composition', () => {
  test('WfgExecutiveVideo renders a Remotion <Audio> for every scene that has narrationText and no avatar video, sourced from a predictable per-scene WAV path', () => {
    assert.match(wfgExecutiveVideoSrc, /import \{ [^}]*Audio[^}]*\} from 'remotion'/)
    assert.match(wfgExecutiveVideoSrc, /\{hasSeparateNarrationAudio\(scene\) && \(/)
    assert.match(wfgExecutiveVideoSrc, /<Audio src=\{narrationAudioPath\(scene\.id\)\} \/>/)
    assert.match(wfgExecutiveVideoSrc, /staticFile\(`narration\/\$\{sceneId\}\.wav`\)/)
    // hasSeparateNarrationAudio's own definition still requires
    // narrationText — the original guarantee this test protects.
    assert.match(wfgExecutiveVideoSrc, /return Boolean\(scene\.narrationText\) && !scene\.avatarVideoAssetPath/)
  })

  test('a scene with no narrationText — or with an avatar video, whose own embedded audio is the narration — never renders a separate <Audio> (never a request for a file that was never meant to exist, never a doubled voice)', () => {
    const conditionalMatch = wfgExecutiveVideoSrc.match(/\{hasSeparateNarrationAudio\(scene\) && \(([\s\S]*?)\)\}/)
    assert.ok(conditionalMatch, 'expected the Audio block to be gated on hasSeparateNarrationAudio(scene)')
  })
})

describe('14. audio duration influences scene duration, and narration is never cut off by scene timing', () => {
  test('generateNarrationAndRetime computes each narrated scene\'s durationSeconds from the REAL synthesized audio length, not the storyboard\'s own rough estimate', () => {
    assert.match(narrationAudioSrc, /const audioDurationSeconds = audio\.audio\.length \/ audio\.sampling_rate/)
    assert.match(narrationAudioSrc, /durationSeconds: sceneSecondsFromAudio\(audioDurationSeconds\)/)
  })

  test('the computed scene duration always includes the FULL audio length plus lead-in and tail padding — never a truncation of it', () => {
    assert.match(narrationAudioSrc, /Math\.max\(MIN_NARRATED_SCENE_SECONDS, NARRATION_LEAD_IN_SECONDS \+ audioDurationSeconds \+ NARRATION_TAIL_SECONDS\)/)
  })

  test('the render script calls generateNarrationAndRetime BEFORE bundling — the composition\'s durationInFrames (via calculateMetadata) is always computed from the audio-driven durationSeconds, never the original estimate', () => {
    const narrationCallIndex = renderScriptSrc.indexOf('generateNarrationAndRetime(')
    const bundleCallIndex = renderScriptSrc.indexOf('await bundle(')
    assert.ok(narrationCallIndex > -1 && bundleCallIndex > -1)
    assert.ok(narrationCallIndex < bundleCallIndex, 'expected narration generation to happen before bundle()')
  })

  test('the render script calls generateFluxAssetsAndAttach BEFORE bundling too, and before narration (so at most one heavy local model is ever active at once) — its cached PNGs must exist on disk before @remotion/bundler copies publicDir', () => {
    const fluxCallIndex = renderScriptSrc.indexOf('generateFluxAssetsAndAttach(')
    const narrationCallIndex = renderScriptSrc.indexOf('generateNarrationAndRetime(')
    const bundleCallIndex = renderScriptSrc.indexOf('await bundle(')
    assert.ok(fluxCallIndex > -1 && narrationCallIndex > -1 && bundleCallIndex > -1)
    assert.ok(fluxCallIndex < narrationCallIndex, 'expected FLUX asset generation to happen before narration')
    assert.ok(fluxCallIndex < bundleCallIndex, 'expected FLUX asset generation to happen before bundle()')
  })

  test('the narration <Audio> starts only after a lead-in offset, so a slow-starting visual reveal never truncates the START of the narration; the scene itself lasts long enough for the audio\'s own full length plus a tail, so playback is never cut off at the END either', () => {
    assert.match(wfgExecutiveVideoSrc, /const leadInFrames = Math\.round\(NARRATION_LEAD_IN_SECONDS \* fps\)/)
    assert.match(wfgExecutiveVideoSrc, /<Sequence from=\{leadInFrames\} layout="none">/)
  })
})

describe('17. Phase 2 — a hard ≤90s final-video duration limit is enforced against the REAL, narration-driven total, never the AI\'s rough pre-render estimate', () => {
  test('the render script computes the real total AFTER generateNarrationAndRetime and throws before bundling if it exceeds MAX_FINAL_VIDEO_SECONDS', () => {
    const narrationCallIndex = renderScriptSrc.indexOf('generateNarrationAndRetime(')
    const durationCheckIndex = renderScriptSrc.indexOf('isWithinFinalDurationLimit(')
    const bundleCallIndex = renderScriptSrc.indexOf('await bundle(')
    assert.ok(narrationCallIndex > -1 && durationCheckIndex > -1 && bundleCallIndex > -1)
    assert.ok(narrationCallIndex < durationCheckIndex && durationCheckIndex < bundleCallIndex)
    assert.match(renderScriptSrc, /if \(!isWithinFinalDurationLimit\(realTotalSeconds\)\) \{\s*\n\s*throw new Error\(/)
  })

  test('the limit constant/helper are imported from src/lib/videoStoryboard.ts — a single shared source of truth, never redefined ad hoc in the render script', () => {
    assert.match(renderScriptSrc, /import \{ MAX_FINAL_VIDEO_SECONDS, isWithinFinalDurationLimit \} from '\.\.\/src\/lib\/videoStoryboard\.ts'/)
  })
})

describe('Scene-to-scene transitions replace the old hard cut, avoiding the previously-observed dead/blank-frame gap', () => {
  test('WfgExecutiveVideo uses TransitionSeries (not the plain Series it used before narration/transitions existed), with a Transition placed between EVERY adjacent pair of scenes — never a silent gap for any pair', () => {
    assert.match(wfgExecutiveVideoSrc, /import \{ TransitionSeries, linearTiming \} from '@remotion\/transitions'/)
    assert.doesNotMatch(stripComments(wfgExecutiveVideoSrc), /<Series>/)
    assert.match(wfgExecutiveVideoSrc, /const isLast = index === storyboard\.scenes\.length - 1/)
    assert.match(wfgExecutiveVideoSrc, /\{!isLast && <TransitionSeries\.Transition/)
  })

  test('the transition uses a fixed, restrained crossfade duration shared by remotion/duration.ts\'s own total-duration accounting — the two can never disagree about how many frames a transition consumes', () => {
    assert.match(wfgExecutiveVideoSrc, /transitionDurationInFrames\(fps\)/)
    assert.match(durationSrc, /export function transitionDurationInFrames/)
    assert.match(durationSrc, /TRANSITION_DURATION_SECONDS/)
  })

  test('the transition duration constant is a single shared value (narrationTiming.ts), never redefined ad hoc in the component itself', () => {
    assert.match(narrationTimingSrc, /export const TRANSITION_DURATION_SECONDS = 0\.6/)
  })
})

describe('Cinematic Visual Director adjustment #2: the opening -> first-story-scene cut carries the approved 10% promotional energy; every OTHER cut stays the restrained cinematic fade', () => {
  test('transitionPresentation returns slide() only for index 0, fade() for every other index', () => {
    assert.match(wfgExecutiveVideoSrc, /function transitionPresentation\(index: number\)/)
    assert.match(wfgExecutiveVideoSrc, /index === 0 \? slide\(\{ direction: 'from-right' \}\) : fade\(\)/)
  })

  test('the opening transition is strictly SHORTER/tighter than the shared restrained duration, never longer (a snappier cut, not a slower one)', () => {
    assert.match(wfgExecutiveVideoSrc, /const OPENING_TRANSITION_FRAMES_FRACTION = 0\.8/)
    assert.match(wfgExecutiveVideoSrc, /index === 0 \? Math\.round\(transitionFrames \* OPENING_TRANSITION_FRAMES_FRACTION\) : transitionFrames/)
  })

  test('both helpers are actually wired into the rendered Transition — never computed but unused', () => {
    assert.match(wfgExecutiveVideoSrc, /presentation=\{transitionPresentation\(index\)\}/)
    assert.match(wfgExecutiveVideoSrc, /transitionFramesForIndex\(index, transitionFrames\)/)
  })

  test('slide is imported from @remotion/transitions/slide, alongside the existing fade import — no new transitions dependency added', () => {
    assert.match(wfgExecutiveVideoSrc, /import \{ slide \} from '@remotion\/transitions\/slide'/)
  })
})

describe('11. no source-report save path exists anywhere in the render pipeline', () => {
  test('render-storyboard.mts and the dev bridge never IMPORT or CALL Supabase (comments that merely explain "this never touches Supabase" are fine and expected — only actual usage is forbidden)', () => {
    const supabaseUsage = /from ['"]@supabase|createClient\(|\.storage\.from\(|supabaseUrl|supabaseKey/i
    for (const src of [renderScriptSrc, devPluginSrc, wfgExecutiveVideoSrc, fluxAssetsSrc, fluxPromptsSrc, avatarVideoAssetsSrc]) {
      assert.equal(supabaseUsage.test(src), false)
    }
    assert.match(devPluginSrc, /OUTPUT_DIR = path\.join\(PROJECT_ROOT, 'output', 'video'\)/)
    assert.match(devPluginSrc, /STORYBOARD_INPUT_PATH = path\.join\(OUTPUT_DIR, '\.storyboard-input\.json'\)/)
  })

  // Phase 2 Step 2A: local-avatar-asset-plugin.ts is the ONE deliberate
  // exception — it exists specifically to touch Supabase (downloading an
  // already-authorized generate_avatar_video/generate_narration result),
  // and is NEVER itself part of the render pipeline proper. render-storyboard.mts
  // is allowed to NAME it in an explanatory comment (documentation, not a
  // dependency); what must never exist is an actual IMPORT of it.
  test('local-avatar-asset-plugin.ts is never IMPORTED by, and never imports, the render pipeline proper (a comment naming it/the other file is fine — only an actual import statement is forbidden)', () => {
    assert.doesNotMatch(renderScriptSrc, /from ['"].*local-avatar-asset/)
    assert.doesNotMatch(localAvatarAssetPluginSrc, /from ['"].*render-storyboard/)
  })
})

describe('12. no Anthropic/AI call occurs anywhere during rendering', () => {
  test('render-storyboard.mts, the dev bridge, and every scene component never IMPORT or CALL the Anthropic SDK (comments explaining "this never calls Anthropic" are fine and expected — only actual usage is forbidden)', () => {
    const anthropicUsage = /from ['"]@anthropic-ai|new Anthropic\(|anthropic\.messages\.|ANTHROPIC_API_KEY/i
    const renderPipelineSources = [
      renderScriptSrc,
      devPluginSrc,
      wfgExecutiveVideoSrc,
      riskSrc,
      forwardLookSrc,
      multiMetricSrc,
      bigMetricSrc,
      openingSrc,
      closingSrc,
      fallbackSrc,
      fluxAssetsSrc,
      fluxPromptsSrc,
    ]
    for (const src of renderPipelineSources) {
      assert.equal(anthropicUsage.test(src), false)
    }
  })
})

describe('13. no avatar/voice-cloning/external-video-service dependency exists', () => {
  test('package.json\'s dependencies contain no avatar/voice/generative-video provider (HeyGen, Synthesia, Tavus, ElevenLabs, D-ID, etc.)', () => {
    const pkg = JSON.parse(packageJsonSrc) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> }
    const allDeps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })
    const forbidden = /heygen|synthesia|tavus|elevenlabs|d-id|didimo|voice-?clone|avatar/i
    const offending = allDeps.filter((name) => forbidden.test(name))
    assert.deepEqual(offending, [])
  })

  test('the render pipeline sources reference no such provider or a voice-cloning concept', () => {
    const renderPipelineSources = [renderScriptSrc, devPluginSrc, wfgExecutiveVideoSrc, fluxAssetsSrc, fluxPromptsSrc]
    const forbidden = /heygen|synthesia|tavus|elevenlabs|d-id\b|voice.?clon/i
    for (const src of renderPipelineSources) {
      assert.equal(forbidden.test(src), false)
    }
  })

  // Phase 2 Step 1 (local Remotion playback) deliberately introduced the
  // word "avatar" into WfgExecutiveVideo.tsx; Step 2A deliberately extends
  // that to render-storyboard.mts too, since it now genuinely calls
  // prepareAvatarVideoAssets to measure a real local clip's length before
  // bundle() — still never a provider call, never Supabase (see item 11
  // above). local-video-render-plugin.ts (the render-TRIGGER bridge, not
  // the avatar-asset bridge) and the FLUX generators have no reason to
  // know this concept exists at all, though — they stay held to the
  // original, stricter bar.
  test('"avatar" is a legitimate LOCAL PLAYBACK/measurement concept only in WfgExecutiveVideo.tsx and render-storyboard.mts — local-video-render-plugin.ts and the FLUX generators still never reference it', () => {
    const sourcesThatMustStayAvatarFree = [devPluginSrc, fluxAssetsSrc, fluxPromptsSrc]
    for (const src of sourcesThatMustStayAvatarFree) {
      assert.equal(/avatar/i.test(src), false)
    }
    assert.match(renderScriptSrc, /avatar/i)
    assert.match(wfgExecutiveVideoSrc, /avatarVideoAssetPath/)
  })

  test('no paid/cloud video- or image-generation provider (Veo, Runway, Luma, Kling) is referenced anywhere in the render pipeline — this phase is FREE/local-only by explicit decision', () => {
    const renderPipelineSources = [renderScriptSrc, devPluginSrc, wfgExecutiveVideoSrc, fluxAssetsSrc, fluxPromptsSrc]
    const forbidden = /\bveo\b|runway|\bluma\b|\bkling\b/i
    for (const src of renderPipelineSources) {
      assert.equal(forbidden.test(src), false)
    }
  })
})

describe('16. FLUX asset generation is local-only, sanitized, cached, and never mandatory (deterministic fallback always exists)', () => {
  test('the sanitization boundary (remotion/fluxPrompts.ts) is keyed only by the (storyEngine, visualPlan.subject) enum pair — never scene title/body/bullets/metrics/narrationText', () => {
    assert.match(fluxPromptsSrc, /export function getFluxAssetPrompt\(storyEngine: StoryEngine, subject: VisualSubject\)/)
  })

  test('StoryScene falls back to the existing programmatic hero illustration whenever no storyEngine/forward-look mechanic applies — the layered-mechanic branch is a pure addition, never a replacement of the existing fallback path', () => {
    const storySceneSrc = read('remotion', 'StoryScene.tsx')
    assert.match(storySceneSrc, /const effectiveEngine: StoryEngine \| undefined = scene\.storyEngine \?\? \(scene\.type === 'forward-look' \? 'pipeline-story' : undefined\)/)
    assert.match(storySceneSrc, /if \(effectiveEngine\) \{/)
    assert.match(storySceneSrc, /const Illustration = getHeroIllustration\(plan\?\.subject\)/)
  })
})

// Phase 2 — AI Presenter & Voice, Step 1: local Remotion playback only.
// No provider is called anywhere in this phase; these tests only prove the
// Remotion-side wiring (asset present -> plays; absent -> unchanged;
// never a duplicate audio track) is correct for whatever a future
// generation step eventually attaches.
describe('17. avatar video overlay — conditional, reusable, never duplicates narration audio', () => {
  const avatarVideoSrc = read('remotion', 'avatarVideo.tsx')

  test('AvatarVideoOverlay uses OffthreadVideo (never <Video>) for frame-accurate rendering — the same choice every other real video asset in this codebase already makes', () => {
    assert.match(avatarVideoSrc, /OffthreadVideo/)
    assert.doesNotMatch(stripComments(avatarVideoSrc), /<Video\b/)
  })

  test('the overlay is un-muted — the avatar clip\'s own embedded audio IS the narration, never silenced', () => {
    assert.match(avatarVideoSrc, /muted=\{false\}/)
  })

  test('playback is wrapped in <Loop> only when a real clip length is provided — never loops on a guess, never forces a loop when the caller omits it', () => {
    assert.match(avatarVideoSrc, /loopDurationInFrames \? <Loop durationInFrames=\{loopDurationInFrames\}>/)
  })

  test('the asset path is resolved via staticFile, exactly like every other *AssetPath field (fluxHeroAssetPath, cinematicAssets)', () => {
    assert.match(avatarVideoSrc, /staticFile\(assetPath\)/)
  })

  for (const [label, src] of [
    ['OpeningScene', openingSrc],
    ['ClosingScene', closingSrc],
  ] as const) {
    test(`${label} renders AvatarVideoOverlay only when scene.avatarVideoAssetPath is set, with its real measured loop length, and still renders BrandPlate unconditionally either way`, () => {
      assert.match(src, /import \{ AvatarVideoOverlay, avatarVideoLoopFrames \} from '\.\.\/avatarVideo'/)
      assert.match(src, /\{scene\.avatarVideoAssetPath && \(\s*\n\s*<AvatarVideoOverlay assetPath=\{scene\.avatarVideoAssetPath\} loopDurationInFrames=\{avatarVideoLoopFrames\(scene, fps\)\} \/>\s*\n\s*\)\}/)
      // BrandPlate must appear OUTSIDE any avatarVideoAssetPath conditional
      // — branding is never gated on whether an avatar is present.
      const brandPlateLine = src.split('\n').find((line) => line.includes('<BrandPlate'))
      assert.ok(brandPlateLine, 'expected to find a <BrandPlate usage')
      assert.doesNotMatch(brandPlateLine!, /avatarVideoAssetPath/)
    })
  }

  test('WfgExecutiveVideo skips the separate narration <Audio> whenever the scene has an avatar video — its own embedded audio track is the only narration source for that scene', () => {
    assert.match(wfgExecutiveVideoSrc, /function hasSeparateNarrationAudio\(scene: VideoStoryboardScene\): boolean \{\s*\n\s*return Boolean\(scene\.narrationText\) && !scene\.avatarVideoAssetPath\s*\n\s*\}/)
    assert.match(wfgExecutiveVideoSrc, /\{hasSeparateNarrationAudio\(scene\) && \(/)
    // The OLD inline condition must be gone — hasSeparateNarrationAudio is
    // the single source of truth now, never re-checked ad hoc alongside it.
    assert.doesNotMatch(wfgExecutiveVideoSrc, /\{scene\.narrationText && \(/)
  })

  test('avatarVideoAssetPath is read directly off scene (same convention as every other render-time asset field) — SceneRenderProps itself carries no separate avatar-specific prop', () => {
    const scenePropsSrc = read('remotion', 'sceneProps.ts')
    assert.doesNotMatch(scenePropsSrc, /avatarVideoUrl/)
  })

  test('the new field is documented as RENDER-TIME ONLY in videoStoryboard.ts, matching fluxHeroAssetPath/cinematicAssets\' own documented discipline — never produced by the AI schema, the deterministic transformer, or any automatic process', () => {
    const videoStoryboardSrc = read('src', 'lib', 'videoStoryboard.ts')
    assert.match(videoStoryboardSrc, /avatarVideoAssetPath\?: string/)
    const fieldBlock = videoStoryboardSrc.slice(videoStoryboardSrc.indexOf('// RENDER-TIME ONLY (Phase 2'), videoStoryboardSrc.indexOf('avatarVideoAssetPath?: string') + 40)
    assert.match(fieldBlock, /never produced by the AI schema, the deterministic transformer/)
  })
})

describe('18. Phase 2 Step 2A — avatar-video asset preparation is wired into the render script in the correct order', () => {
  test('render-storyboard.mts calls prepareAvatarVideoAssets AFTER FLUX generation but BEFORE narration synthesis', () => {
    const fluxIndex = renderScriptSrc.indexOf('generateFluxAssetsAndAttach(')
    const avatarIndex = renderScriptSrc.indexOf('prepareAvatarVideoAssets(')
    const narrationIndex = renderScriptSrc.indexOf('generateNarrationAndRetime(')
    assert.ok(fluxIndex > -1 && avatarIndex > -1 && narrationIndex > -1, 'expected all three pipeline steps to be called')
    assert.ok(fluxIndex < avatarIndex, 'avatar-video preparation must run after FLUX generation')
    assert.ok(avatarIndex < narrationIndex, 'avatar-video preparation must run before narration synthesis, so the narration step can see its final avatarVideoAssetPath state')
  })

  test('avatar-video preparation is passed the SAME publicDir bundle() itself uses — never a second, divergent path', () => {
    assert.match(renderScriptSrc, /const PUBLIC_DIR = path\.join\(projectRoot, 'remotion', 'public'\)/)
    assert.match(renderScriptSrc, /prepareAvatarVideoAssets\(storyboardWithFluxAssets, PUBLIC_DIR\)/)
    assert.match(renderScriptSrc, /publicDir: PUBLIC_DIR,/)
  })

  test('generateNarrationAndRetime never synthesizes a redundant Kokoro WAV for a scene that already has a real avatar video attached', () => {
    assert.match(narrationAudioSrc, /if \(!scene\.narrationText \|\| scene\.avatarVideoAssetPath\)/)
  })

  test('avatarVideoAssets.mts never guesses a duration — it only ever uses @remotion/renderer\'s own getVideoMetadata against a real local file, and degrades (never throws) when the file is missing or unmeasurable', () => {
    assert.match(avatarVideoAssetsSrc, /import \{ getVideoMetadata \} from '@remotion\/renderer'/)
    assert.match(avatarVideoAssetsSrc, /if \(!existsSync\(absolutePath\)\)/)
    assert.match(avatarVideoAssetsSrc, /if \(!metadata\.durationInSeconds \|\| metadata\.durationInSeconds <= 0\)/)
  })

  test('the derived scene durationSeconds reuses the SAME lead-in/tail constants Kokoro narration already uses — one shared timing contract, never a second ad hoc one', () => {
    assert.match(avatarVideoAssetsSrc, /import \{ NARRATION_LEAD_IN_SECONDS, NARRATION_TAIL_SECONDS, MIN_NARRATED_SCENE_SECONDS \} from '\.\.\/\.\.\/remotion\/narrationTiming\.ts'/)
    assert.match(avatarVideoAssetsSrc, /Math\.max\(MIN_NARRATED_SCENE_SECONDS, NARRATION_LEAD_IN_SECONDS \+ metadata\.durationInSeconds \+ NARRATION_TAIL_SECONDS\)/)
  })

  test('local-avatar-asset-plugin.ts is registered in vite.config.ts, alongside every other dev-only bridge', () => {
    const viteConfigSrc = read('vite.config.ts')
    assert.match(viteConfigSrc, /import \{ localAvatarAssetPlugin \} from '\.\/dev\/local-avatar-asset-plugin\.js'/)
    assert.match(viteConfigSrc, /localAvatarAssetPlugin\(\)/)
  })

  test('local-avatar-asset-plugin.ts validates both sceneId and storagePath before ever calling Supabase — never trusts an unvalidated request body', () => {
    const downloadCallIndex = localAvatarAssetPluginSrc.indexOf('downloadPresenterMediaBytes(storagePath)')
    const sceneIdCheckIndex = localAvatarAssetPluginSrc.indexOf('isSafeSceneId(sceneId)')
    const storagePathCheckIndex = localAvatarAssetPluginSrc.indexOf('isSafeGeneratedStoragePath(storagePath)')
    assert.ok(downloadCallIndex > -1 && sceneIdCheckIndex > -1 && storagePathCheckIndex > -1)
    assert.ok(sceneIdCheckIndex < downloadCallIndex && storagePathCheckIndex < downloadCallIndex)
  })

  test('local-avatar-asset-plugin.ts loads the real service client via Vite\'s own ssrLoadModule (the proven-working pattern), never a plain dynamic import of the .ts file', () => {
    assert.match(localAvatarAssetPluginSrc, /server\.ssrLoadModule\('\/api\/_lib\/supabaseServiceClient\.ts'\)/)
  })

  test('VideoCreationAvatarConsent.tsx\'s "Prepare clips" action calls generate_narration then generate_avatar_video, then downloads the real result via prepareAvatarAssetLocally before ever writing avatarVideoAssetPath onto the storyboard', () => {
    const src = read('src', 'components', 'VideoCreationAvatarConsent.tsx')
    const narrationIndex = src.indexOf("'generate_narration'")
    const avatarVideoIndex = src.indexOf("'generate_avatar_video'")
    const prepareLocalIndex = src.indexOf('prepareAvatarAssetLocally(')
    const attachIndex = src.indexOf('avatarVideoAssetPath: local.assetPath')
    assert.ok(narrationIndex > -1 && avatarVideoIndex > -1 && prepareLocalIndex > -1 && attachIndex > -1)
    assert.ok(narrationIndex < avatarVideoIndex && avatarVideoIndex < prepareLocalIndex && prepareLocalIndex < attachIndex)
    // Never fabricates a result client-side — every value it writes comes
    // from a real server response field.
    assert.match(src, /narration\.generatedStoragePath/)
    assert.match(src, /avatarVideo\.generatedStoragePath/)
  })
})

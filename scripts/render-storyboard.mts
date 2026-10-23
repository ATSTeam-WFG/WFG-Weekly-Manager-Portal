import { bundle } from '@remotion/bundler'
import { renderMedia, selectComposition } from '@remotion/renderer'
import { readFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { generateNarrationAndRetime } from './lib/narrationAudio.mts'
import { generateFluxAssetsAndAttach } from './lib/fluxAssets.mts'
import { prepareAvatarVideoAssets } from './lib/avatarVideoAssets.mts'
import { MAX_FINAL_VIDEO_SECONDS, isWithinFinalDurationLimit } from '../src/lib/videoStoryboard.ts'
import { NARRATION_VOICE_OPTIONS, type NarrationVoiceOption } from '../src/lib/narrationVoices.ts'

function isNarrationVoiceOption(value: string | undefined): value is NarrationVoiceOption {
  return !!value && value in NARRATION_VOICE_OPTIONS
}

// Local-only render CLI — invoked either directly (`npm run render:storyboard
// -- <storyboard.json> [outputPath.mp4]`) or spawned as a child process by
// dev/local-video-render-plugin.ts (the browser -> local-render bridge).
// Never reads/writes Supabase, never calls Anthropic, never logs report
// content — only file paths and progress percentages (narration synthesis
// logs only a scene id, never the narration text itself).

const projectRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const COMPOSITION_ID = 'WfgExecutiveVideo'
// Narration audio is written directly into remotion/public/narration/ (not
// output/video/) because @remotion/bundler's bundle() copies publicDir's
// contents into the bundle at BUNDLE time — the audio files must exist
// before bundle() runs, and Remotion's own staticFile() only ever resolves
// against this one configured publicDir (see WfgExecutiveVideo.tsx's own
// narrationAudioPath). Gitignored (see .gitignore's own comment) and wiped
// clean at the start of every render by generateNarrationAndRetime itself.
const NARRATION_DIR = path.join(projectRoot, 'remotion', 'public', 'narration')
// Same directory bundle() below copies from — an avatar-video asset
// referenced by a scene must already be sitting here (placed earlier by
// dev/local-avatar-asset-plugin.ts's own dev-only bridge) for the same
// publicDir-copy-timing reason as narration audio and FLUX assets above.
const PUBLIC_DIR = path.join(projectRoot, 'remotion', 'public')

async function main() {
  const storyboardPath = process.argv[2]
  const outputPath = process.argv[3] ?? path.join(projectRoot, 'output', 'video', `wfg-executive-video-${Date.now()}.mp4`)
  // Optional 4th CLI arg — one of NARRATION_VOICE_OPTIONS's own keys (see
  // the Presenter & Voice step). An unrecognized/omitted value falls back
  // to generateNarrationAndRetime's own default, exactly as before this
  // parameter existed.
  const requestedVoice = process.argv[4]
  const voice = isNarrationVoiceOption(requestedVoice) ? requestedVoice : undefined

  if (!storyboardPath) {
    console.error('Usage: node --experimental-strip-types scripts/render-storyboard.mts <storyboard.json> [outputPath.mp4] [voiceOption]')
    process.exitCode = 1
    return
  }

  // Parsed only to fail fast on malformed input — the actual shape is
  // whatever the browser's already-validated VideoStoryboard produced;
  // this script does not re-validate its structure (that happened
  // server-side in api/video/generate-storyboard.ts, or is the
  // deterministic fallback's own guaranteed-valid shape).
  const rawStoryboard = JSON.parse(readFileSync(storyboardPath, 'utf8'))

  console.log('[render] generating local FLUX.1-schnell visual assets (sequential, cached)...')
  // Returns a NEW storyboard (never mutates rawStoryboard) whose qualifying
  // scenes now carry a fluxAssetPath — see generateFluxAssetsAndAttach's own
  // header for why this must happen BEFORE bundle() (identical
  // publicDir-copy-timing reason as narration audio, below). Runs BEFORE
  // narration so at most one heavy local model (mflux's subprocess, then
  // Kokoro in-process) is ever active at a time, per the phase's 16GB
  // memory constraint.
  const storyboardWithFluxAssets = await generateFluxAssetsAndAttach(rawStoryboard)

  console.log('[render] measuring any attached avatar-video clip durations...')
  // Runs BEFORE narration synthesis so a scene with a real avatar video
  // already has its final, clip-driven durationSeconds set before
  // generateNarrationAndRetime decides whether to synthesize a (redundant,
  // for this scene) Kokoro WAV — see avatarVideoAssets.mts's own header.
  const storyboardWithAvatarAssets = await prepareAvatarVideoAssets(storyboardWithFluxAssets, PUBLIC_DIR)

  console.log('[render] synthesizing narration audio locally (Kokoro TTS)...')
  // Returns a NEW storyboard (never mutates storyboardWithAvatarAssets) whose
  // scene durationSeconds now reflect real synthesized audio length +
  // padding — see generateNarrationAndRetime's own header for why this must
  // happen BEFORE bundle().
  const storyboard = await generateNarrationAndRetime(storyboardWithAvatarAssets, NARRATION_DIR, voice)

  // HARD ≤90s ENFORCEMENT (Phase 2) — checked against the REAL,
  // narration-driven durations computed just above, never the AI's rough
  // pre-render estimate. An over-90-second composition must never
  // silently render; this throws and the local render bridge
  // (dev/local-video-render-plugin.ts) surfaces it as a clear error to
  // the admin UI instead of producing an MP4.
  const realTotalSeconds = storyboard.scenes.reduce((sum, scene) => sum + (scene.durationSeconds ?? 0), 0)
  if (!isWithinFinalDurationLimit(realTotalSeconds)) {
    throw new Error(
      `Final video duration (${Math.round(realTotalSeconds)}s) exceeds the ${MAX_FINAL_VIDEO_SECONDS}s hard limit. Shorten narration or remove a scene before generating.`,
    )
  }

  console.log('[render] bundling composition...')
  const bundleLocation = await bundle({
    entryPoint: path.join(projectRoot, 'remotion', 'index.ts'),
    publicDir: PUBLIC_DIR,
  })

  console.log('[render] selecting composition...')
  const composition = await selectComposition({
    serveUrl: bundleLocation,
    id: COMPOSITION_ID,
    inputProps: { storyboard },
  })

  mkdirSync(path.dirname(outputPath), { recursive: true })

  console.log('[render] rendering MP4 (this can take a minute)...')
  await renderMedia({
    composition,
    serveUrl: bundleLocation,
    codec: 'h264',
    outputLocation: outputPath,
    inputProps: { storyboard },
    onProgress: ({ progress }) => {
      process.stdout.write(`\r[render] progress: ${Math.round(progress * 100)}%   `)
    },
  })

  console.log(`\n[render] done: ${outputPath}`)
}

main().catch((err) => {
  console.error('[render] failed:', err instanceof Error ? err.message : String(err))
  process.exitCode = 1
})

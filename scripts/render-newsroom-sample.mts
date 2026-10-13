import { bundle } from '@remotion/bundler'
import { renderMedia, selectComposition } from '@remotion/renderer'
import { KokoroTTS } from 'kokoro-js'
import { mkdirSync, readdirSync, rmSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DEFAULT_NARRATION_VOICE, NARRATION_VOICE_OPTIONS } from '../src/lib/narrationVoices.ts'
import { NARRATION_LEAD_IN_SECONDS, NARRATION_TAIL_SECONDS, MIN_NARRATED_SCENE_SECONDS } from '../remotion/narrationTiming.ts'

// Standalone render CLI for the approved 15s WFG Leadership Newsroom
// (WITHOUT AVATAR) prototype ONLY — entirely separate from
// scripts/render-storyboard.mts, scripts/render-design-proof.mts, and
// scripts/render-cinematic-sample.mts (own composition, own narration
// dir). No paid API calls: no presenter clip, no FLUX image, no Luma —
// the studio set is built entirely from Remotion shapes/gradients, and
// the metric narration is synthesized locally via Kokoro.

const projectRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const COMPOSITION_ID = 'WfgNewsroomNoAvatarV1'
const FPS = 30
const PUBLIC_DIR = path.join(projectRoot, 'remotion', 'public')
const NARRATION_DIR = path.join(PUBLIC_DIR, 'narration-newsroom')

const ESTABLISH_SECONDS = 4
const PUSH_SECONDS = 4

// Kept short deliberately (approved: "shorten narration if necessary") —
// the exact figures are already large and readable on the data wall
// itself, so narration summarizes direction rather than re-reading every
// digit, keeping the metric beat close to its ~7s budget.
const METRIC_NARRATION_TEXT = "Florida's agency performance is strong across the board this year, with remittance, orders, and OTL files all trending positive."

// Kept short enough to comfortably fit inside the fixed 8s
// establish+push window without needing to resize those beats.
const OPENING_NARRATION_TEXT = 'This is your WFG weekly leadership update, live from the newsroom.'

function sceneSecondsFromAudio(audioDurationSeconds: number): number {
  return Math.max(MIN_NARRATED_SCENE_SECONDS, NARRATION_LEAD_IN_SECONDS + audioDurationSeconds + NARRATION_TAIL_SECONDS)
}

async function main() {
  const outputPath = process.argv[2] ?? path.join(projectRoot, 'output', 'video', `wfg-newsroom-no-avatar-v1-${Date.now()}.mp4`)

  mkdirSync(NARRATION_DIR, { recursive: true })
  for (const file of readdirSync(NARRATION_DIR)) {
    if (file.endsWith('.wav')) rmSync(path.join(NARRATION_DIR, file))
  }

  console.log('[newsroom-sample] synthesizing narration locally (Kokoro TTS)...')
  const voiceId = NARRATION_VOICE_OPTIONS[DEFAULT_NARRATION_VOICE]
  const tts = await KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', { dtype: 'q8', device: 'cpu' })

  const openingAudio = await tts.generate(OPENING_NARRATION_TEXT, { voice: voiceId })
  const openingDurationSeconds = openingAudio.audio.length / openingAudio.sampling_rate
  await openingAudio.save(path.join(NARRATION_DIR, 'opening.wav'))
  console.log(`  -> opening narration: audio ${openingDurationSeconds.toFixed(2)}s (fixed 8s establish+push window)`)
  if (openingDurationSeconds > ESTABLISH_SECONDS + PUSH_SECONDS - NARRATION_LEAD_IN_SECONDS) {
    console.warn(`  -> WARNING: opening narration (${openingDurationSeconds.toFixed(2)}s) may run past the 8s establish+push window — consider shortening it.`)
  }

  const audio = await tts.generate(METRIC_NARRATION_TEXT, { voice: voiceId })
  const audioDurationSeconds = audio.audio.length / audio.sampling_rate
  await audio.save(path.join(NARRATION_DIR, 'metric.wav'))
  const metricDurationInFrames = Math.round(sceneSecondsFromAudio(audioDurationSeconds) * FPS)
  console.log(`  -> metric narration: audio ${audioDurationSeconds.toFixed(2)}s, scene ${(metricDurationInFrames / FPS).toFixed(2)}s`)

  const inputProps = {
    establishDurationInFrames: Math.round(ESTABLISH_SECONDS * FPS),
    pushDurationInFrames: Math.round(PUSH_SECONDS * FPS),
    metricDurationInFrames,
  }

  console.log('[newsroom-sample] bundling composition...')
  const bundleLocation = await bundle({
    entryPoint: path.join(projectRoot, 'remotion', 'index.ts'),
    publicDir: PUBLIC_DIR,
  })

  console.log('[newsroom-sample] selecting composition...')
  const composition = await selectComposition({
    serveUrl: bundleLocation,
    id: COMPOSITION_ID,
    inputProps,
  })

  mkdirSync(path.dirname(outputPath), { recursive: true })

  console.log('[newsroom-sample] rendering MP4...')
  await renderMedia({
    composition,
    serveUrl: bundleLocation,
    codec: 'h264',
    outputLocation: outputPath,
    inputProps,
    onProgress: ({ progress }) => {
      process.stdout.write(`\r[newsroom-sample] progress: ${Math.round(progress * 100)}%   `)
    },
  })

  console.log(`\n[newsroom-sample] done: ${outputPath}`)
  console.log(`[newsroom-sample] rendered duration: ${(composition.durationInFrames / FPS).toFixed(2)}s`)
}

main().catch((err) => {
  console.error('[newsroom-sample] failed:', err instanceof Error ? err.message : String(err))
  process.exitCode = 1
})

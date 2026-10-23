import { bundle } from '@remotion/bundler'
import { renderMedia, selectComposition, getVideoMetadata } from '@remotion/renderer'
import { KokoroTTS } from 'kokoro-js'
import { mkdirSync, readdirSync, rmSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DEFAULT_NARRATION_VOICE, NARRATION_VOICE_OPTIONS } from '../src/lib/narrationVoices.ts'
import { NARRATION_LEAD_IN_SECONDS, NARRATION_TAIL_SECONDS, MIN_NARRATED_SCENE_SECONDS } from '../remotion/narrationTiming.ts'

// Standalone render CLI for the approved 15s hybrid Broadcast-Anchor /
// Cinematic-Documentary sample ONLY — entirely separate from
// scripts/render-storyboard.mts (never touches the real storyboard
// pipeline, the checkpoint, or any existing rendered MP4) and from
// scripts/render-design-proof.mts (its own composition, own narration
// dir). No paid API calls of any kind: the presenter clip is the already-
// generated, already-verified opening HeyGen clip (reused, never
// regenerated), the transition image is an already-cached FLUX asset, and
// the metric narration is synthesized locally via Kokoro.

const projectRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const COMPOSITION_ID = 'CinematicSampleV1'
const FPS = 30
const PUBLIC_DIR = path.join(projectRoot, 'remotion', 'public')
const NARRATION_DIR = path.join(PUBLIC_DIR, 'narration-sample')
const PRESENTER_CLIP = path.join(PUBLIC_DIR, 'avatar-video', 'opening.mp4')

const METRIC_NARRATION_TEXT =
  "Florida agency year to date trends remain positive. Remittance is up sixteen point four percent, orders are up eight point eight percent, and OTL files are up twenty one point eight percent."

function sceneSecondsFromAudio(audioDurationSeconds: number): number {
  return Math.max(MIN_NARRATED_SCENE_SECONDS, NARRATION_LEAD_IN_SECONDS + audioDurationSeconds + NARRATION_TAIL_SECONDS)
}

async function main() {
  const outputPath = process.argv[2] ?? path.join(projectRoot, 'output', 'video', `wfg-cinematic-sample-v1-${Date.now()}.mp4`)

  mkdirSync(NARRATION_DIR, { recursive: true })
  for (const file of readdirSync(NARRATION_DIR)) {
    if (file.endsWith('.wav')) rmSync(path.join(NARRATION_DIR, file))
  }

  console.log('[cinematic-sample] measuring the real presenter clip duration...')
  const presenterMetadata = await getVideoMetadata(PRESENTER_CLIP)
  if (!presenterMetadata.durationInSeconds || presenterMetadata.durationInSeconds <= 0) {
    throw new Error('Could not measure the opening presenter clip — has it been restored to remotion/public/avatar-video/opening.mp4?')
  }
  // A short tail beyond the clip's own length so the cut to the
  // transition never feels abrupt right on the clip's last frame.
  const presenterDurationInFrames = Math.round((presenterMetadata.durationInSeconds + 0.6) * FPS)
  console.log(`  -> opening.mp4: ${presenterMetadata.durationInSeconds.toFixed(2)}s real clip, ${(presenterDurationInFrames / FPS).toFixed(2)}s segment`)

  console.log('[cinematic-sample] synthesizing metric narration locally (Kokoro TTS)...')
  const voiceId = NARRATION_VOICE_OPTIONS[DEFAULT_NARRATION_VOICE]
  const tts = await KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', { dtype: 'q8', device: 'cpu' })
  const audio = await tts.generate(METRIC_NARRATION_TEXT, { voice: voiceId })
  const audioDurationSeconds = audio.audio.length / audio.sampling_rate
  await audio.save(path.join(NARRATION_DIR, 'metric.wav'))
  const metricDurationInFrames = Math.round(sceneSecondsFromAudio(audioDurationSeconds) * FPS)
  console.log(`  -> metric narration: audio ${audioDurationSeconds.toFixed(2)}s, scene ${(metricDurationInFrames / FPS).toFixed(2)}s`)

  const inputProps = { presenterDurationInFrames, metricDurationInFrames }

  console.log('[cinematic-sample] bundling composition...')
  const bundleLocation = await bundle({
    entryPoint: path.join(projectRoot, 'remotion', 'index.ts'),
    publicDir: PUBLIC_DIR,
  })

  console.log('[cinematic-sample] selecting composition...')
  const composition = await selectComposition({
    serveUrl: bundleLocation,
    id: COMPOSITION_ID,
    inputProps,
  })

  mkdirSync(path.dirname(outputPath), { recursive: true })

  console.log('[cinematic-sample] rendering MP4...')
  await renderMedia({
    composition,
    serveUrl: bundleLocation,
    codec: 'h264',
    outputLocation: outputPath,
    inputProps,
    onProgress: ({ progress }) => {
      process.stdout.write(`\r[cinematic-sample] progress: ${Math.round(progress * 100)}%   `)
    },
  })

  console.log(`\n[cinematic-sample] done: ${outputPath}`)
  console.log(`[cinematic-sample] rendered duration: ${(composition.durationInFrames / FPS).toFixed(2)}s`)
}

main().catch((err) => {
  console.error('[cinematic-sample] failed:', err instanceof Error ? err.message : String(err))
  process.exitCode = 1
})

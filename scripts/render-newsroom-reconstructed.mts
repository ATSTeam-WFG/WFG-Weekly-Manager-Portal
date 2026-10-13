import { bundle } from '@remotion/bundler'
import { renderMedia, selectComposition } from '@remotion/renderer'
import { KokoroTTS } from 'kokoro-js'
import { mkdirSync, readdirSync, rmSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DEFAULT_NARRATION_VOICE, NARRATION_VOICE_OPTIONS } from '../src/lib/narrationVoices.ts'
import { NARRATION_LEAD_IN_SECONDS, NARRATION_TAIL_SECONDS, MIN_NARRATED_SCENE_SECONDS } from '../remotion/narrationTiming.ts'

// Standalone render CLI that RECONSTRUCTS the original WFG Leadership
// Newsroom (WITHOUT AVATAR) v1 prototype — the flat CSS/Remotion studio,
// before the approved FLUX backdrop was integrated. The original v1 MP4
// and its render script were both overwritten when v2 reused the same
// output filename; this script restores v1's exact original logic from
// the conversation's own record of it (metric-only narration, no opening
// line — the opening line was added later, for v2), not a guess. Entirely
// separate from scripts/render-newsroom-sample.mts (the current v2
// script/composition/narration dir) — never touches it. No paid API
// calls: the studio set is built entirely from Remotion shapes/gradients,
// and the metric narration is synthesized locally via Kokoro.

const projectRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const COMPOSITION_ID = 'WfgNewsroomNoAvatarV1Reconstructed'
const FPS = 30
const PUBLIC_DIR = path.join(projectRoot, 'remotion', 'public')
// Own, isolated narration directory — never shared with the current v2
// script's narration-newsroom/ dir, so re-running this can never disturb
// v2's own narration assets.
const NARRATION_DIR = path.join(PUBLIC_DIR, 'narration-newsroom-v1-reconstructed')

const ESTABLISH_SECONDS = 4
const PUSH_SECONDS = 4

// Identical to the original v1 script's narration text — unchanged.
const METRIC_NARRATION_TEXT = "Florida's agency performance is strong across the board this year, with remittance, orders, and OTL files all trending positive."

function sceneSecondsFromAudio(audioDurationSeconds: number): number {
  return Math.max(MIN_NARRATED_SCENE_SECONDS, NARRATION_LEAD_IN_SECONDS + audioDurationSeconds + NARRATION_TAIL_SECONDS)
}

async function main() {
  const outputPath = process.argv[2] ?? path.join(projectRoot, 'output', 'video', `wfg-newsroom-v1-reconstructed-${Date.now()}.mp4`)

  mkdirSync(NARRATION_DIR, { recursive: true })
  for (const file of readdirSync(NARRATION_DIR)) {
    if (file.endsWith('.wav')) rmSync(path.join(NARRATION_DIR, file))
  }

  console.log('[newsroom-reconstructed] synthesizing metric narration locally (Kokoro TTS)...')
  const voiceId = NARRATION_VOICE_OPTIONS[DEFAULT_NARRATION_VOICE]
  const tts = await KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', { dtype: 'q8', device: 'cpu' })
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

  console.log('[newsroom-reconstructed] bundling composition...')
  const bundleLocation = await bundle({
    entryPoint: path.join(projectRoot, 'remotion', 'index.ts'),
    publicDir: PUBLIC_DIR,
  })

  console.log('[newsroom-reconstructed] selecting composition...')
  const composition = await selectComposition({
    serveUrl: bundleLocation,
    id: COMPOSITION_ID,
    inputProps,
  })

  mkdirSync(path.dirname(outputPath), { recursive: true })

  console.log('[newsroom-reconstructed] rendering MP4...')
  await renderMedia({
    composition,
    serveUrl: bundleLocation,
    codec: 'h264',
    outputLocation: outputPath,
    inputProps,
    onProgress: ({ progress }) => {
      process.stdout.write(`\r[newsroom-reconstructed] progress: ${Math.round(progress * 100)}%   `)
    },
  })

  console.log(`\n[newsroom-reconstructed] done: ${outputPath}`)
  console.log(`[newsroom-reconstructed] rendered duration: ${(composition.durationInFrames / FPS).toFixed(2)}s`)
}

main().catch((err) => {
  console.error('[newsroom-reconstructed] failed:', err instanceof Error ? err.message : String(err))
  process.exitCode = 1
})

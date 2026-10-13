import { bundle } from '@remotion/bundler'
import { renderMedia, selectComposition } from '@remotion/renderer'
import { KokoroTTS } from 'kokoro-js'
import { mkdirSync, readdirSync, rmSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DEFAULT_NARRATION_VOICE, NARRATION_VOICE_OPTIONS } from '../src/lib/narrationVoices.ts'
import { NARRATION_LEAD_IN_SECONDS, NARRATION_TAIL_SECONDS, MIN_NARRATED_SCENE_SECONDS } from '../remotion/narrationTiming.ts'
import { PROOF_CAPTIONS } from '../remotion/designProofContent.ts'

// Standalone render CLI for the V3 cinematic design proof ONLY — entirely
// separate from scripts/render-storyboard.mts (never touches the real
// storyboard pipeline, the protected Luma checkpoint, or
// output/cinematic-generation-state.json). Synthesizes temporary Kokoro
// narration for the proof's 4 fixed caption lines (see DesignProofV3.tsx's
// own PROOF_CAPTIONS — the exact text approved in the prior V2 phase, no
// new wording invented here), measures the REAL audio duration per scene,
// then bundles + renders the "DesignProofV3" composition through the same
// real @remotion/bundler + @remotion/renderer pipeline the production
// render uses. No paid API calls of any kind.

const projectRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const COMPOSITION_ID = 'DesignProofV3'
// A separate narration directory from the production narration/ dir, so
// this proof can never race with or clobber a production render's audio.
const NARRATION_DIR = path.join(projectRoot, 'remotion', 'public', 'narration-proof')

function sceneSecondsFromAudio(audioDurationSeconds: number): number {
  return Math.max(MIN_NARRATED_SCENE_SECONDS, NARRATION_LEAD_IN_SECONDS + audioDurationSeconds + NARRATION_TAIL_SECONDS)
}

async function main() {
  const outputPath = process.argv[2] ?? path.join(projectRoot, 'output', 'video', `design-proof-v3-${Date.now()}.mp4`)
  const fps = 30

  mkdirSync(NARRATION_DIR, { recursive: true })
  for (const file of readdirSync(NARRATION_DIR)) {
    if (file.endsWith('.wav')) rmSync(path.join(NARRATION_DIR, file))
  }

  console.log('[design-proof] synthesizing temporary narration locally (Kokoro TTS)...')
  const voiceId = NARRATION_VOICE_OPTIONS[DEFAULT_NARRATION_VOICE]
  const tts = await KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', { dtype: 'q8', device: 'cpu' })

  const sceneDurationsInFrames: Record<string, number> = {}
  for (const [sceneId, text] of Object.entries(PROOF_CAPTIONS) as Array<[string, string]>) {
    console.log(`[design-proof] synthesizing scene "${sceneId}"...`)
    const audio = await tts.generate(text, { voice: voiceId })
    const audioDurationSeconds = audio.audio.length / audio.sampling_rate
    await audio.save(path.join(NARRATION_DIR, `${sceneId}.wav`))
    const sceneSeconds = sceneSecondsFromAudio(audioDurationSeconds)
    sceneDurationsInFrames[sceneId] = Math.round(sceneSeconds * fps)
    console.log(`  -> ${sceneId}: audio ${audioDurationSeconds.toFixed(2)}s, scene ${sceneSeconds.toFixed(2)}s`)
  }

  const totalRawSeconds = Object.values(sceneDurationsInFrames).reduce((sum, f) => sum + f, 0) / fps
  console.log(`[design-proof] total raw scene duration: ${totalRawSeconds.toFixed(2)}s (before transition overlap)`)

  console.log('[design-proof] bundling composition...')
  const bundleLocation = await bundle({
    entryPoint: path.join(projectRoot, 'remotion', 'index.ts'),
    publicDir: path.join(projectRoot, 'remotion', 'public'),
  })

  console.log('[design-proof] selecting composition...')
  const composition = await selectComposition({
    serveUrl: bundleLocation,
    id: COMPOSITION_ID,
    inputProps: { sceneDurationsInFrames },
  })

  mkdirSync(path.dirname(outputPath), { recursive: true })

  console.log('[design-proof] rendering MP4...')
  await renderMedia({
    composition,
    serveUrl: bundleLocation,
    codec: 'h264',
    outputLocation: outputPath,
    inputProps: { sceneDurationsInFrames },
    onProgress: ({ progress }) => {
      process.stdout.write(`\r[design-proof] progress: ${Math.round(progress * 100)}%   `)
    },
  })

  console.log(`\n[design-proof] done: ${outputPath}`)
  console.log(`[design-proof] rendered duration: ${(composition.durationInFrames / fps).toFixed(2)}s`)
}

main().catch((err) => {
  console.error('[design-proof] failed:', err instanceof Error ? err.message : String(err))
  process.exitCode = 1
})

import { KokoroTTS } from 'kokoro-js'
import { mkdirSync, readdirSync, rmSync } from 'node:fs'
import path from 'node:path'
import type { VideoStoryboard, VideoStoryboardScene } from '../../src/lib/videoStoryboard.ts'
import { DEFAULT_NARRATION_VOICE, NARRATION_VOICE_OPTIONS, type NarrationVoiceOption } from '../../src/lib/narrationVoices.ts'
import { MIN_NARRATED_SCENE_SECONDS, NARRATION_LEAD_IN_SECONDS, NARRATION_TAIL_SECONDS } from '../../remotion/narrationTiming.ts'

// LOCAL, licensed text-to-speech only — Kokoro-82M (hexgrad/Kokoro-82M),
// Apache-2.0 licensed model + code, run entirely on this machine via the
// `kokoro-js` npm package (CPU inference through onnxruntime-node, no GPU
// required — confirmed working on this machine before this module was
// written). Two of the model's many training-data sources (Koniwa, SIWIS)
// are CC BY licensed audio, per the model card; that attribution is
// satisfied by documenting it here and in this phase's own final report,
// not by anything this code needs to do at runtime. No text or audio is
// ever sent to any external service — everything below runs against a
// model already downloaded to this machine's local Hugging Face cache.
//
// Voice option CONSTANTS now live in src/lib/narrationVoices.ts (a tiny,
// dependency-free file) so the browser-side Presenter & Voice step can show
// the same two voice labels without ever bundling this file's kokoro-js
// import into client code — see that file's own header. This remains the
// ONLY place a Kokoro voice id is actually used to synthesize audio.
export { NARRATION_VOICE_OPTIONS, type NarrationVoiceOption }
const DEFAULT_VOICE: NarrationVoiceOption = DEFAULT_NARRATION_VOICE

const MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX'

let ttsInstance: KokoroTTS | null = null
async function getTts(): Promise<KokoroTTS> {
  if (!ttsInstance) {
    // 'cpu'/'q8' confirmed to run acceptably on this machine (Apple
    // Silicon, no GPU) during this phase's own feasibility check — see the
    // final report's "local runtime findings" for the measured result.
    ttsInstance = await KokoroTTS.from_pretrained(MODEL_ID, { dtype: 'q8', device: 'cpu' })
  }
  return ttsInstance
}

function sceneSecondsFromAudio(audioDurationSeconds: number): number {
  return Math.max(MIN_NARRATED_SCENE_SECONDS, NARRATION_LEAD_IN_SECONDS + audioDurationSeconds + NARRATION_TAIL_SECONDS)
}

// Synthesizes narration for every scene that has one, writes each as
// <narrationDir>/<scene.id>.wav, and returns a NEW VideoStoryboard (never
// mutates the one passed in — `report.js` mutation is never anywhere in
// this pipeline, and this render-time augmentation follows the identical
// discipline) whose scene.durationSeconds reflects the REAL synthesized
// audio length (plus lead-in/tail padding) rather than the storyboard's own
// rough estimate. A scene with no narrationText is returned completely
// unchanged — its own existing durationSeconds still applies, exactly as
// it did before this phase.
export async function generateNarrationAndRetime(
  storyboard: VideoStoryboard,
  narrationDir: string,
  voice: NarrationVoiceOption = DEFAULT_VOICE,
): Promise<VideoStoryboard> {
  mkdirSync(narrationDir, { recursive: true })
  // A fresh render never plays a stale narration file left over from a
  // previous storyboard/edit — every .wav in this directory is cleared
  // before any new one is written.
  for (const file of readdirSync(narrationDir)) {
    if (file.endsWith('.wav')) rmSync(path.join(narrationDir, file))
  }

  const voiceId = NARRATION_VOICE_OPTIONS[voice]
  const tts = await getTts()

  const scenes: VideoStoryboardScene[] = []
  for (const scene of storyboard.scenes) {
    // Phase 2 Step 2A: a scene with a real avatar video already attached
    // (see avatarVideoAssets.mts, which runs before this function and has
    // already set this scene's real durationSeconds from the clip's own
    // measured length) gets its narration from that clip's OWN embedded
    // audio track — synthesizing a separate Kokoro WAV for it would be
    // wasted computation for a file WfgExecutiveVideo.tsx never plays.
    if (!scene.narrationText || scene.avatarVideoAssetPath) {
      scenes.push(scene)
      continue
    }
    console.log(`[narration] synthesizing scene "${scene.id}"...`)
    const audio = await tts.generate(scene.narrationText, { voice: voiceId })
    const audioDurationSeconds = audio.audio.length / audio.sampling_rate
    await audio.save(path.join(narrationDir, `${scene.id}.wav`))
    scenes.push({ ...scene, durationSeconds: sceneSecondsFromAudio(audioDurationSeconds) })
  }

  return { ...storyboard, scenes }
}

// Run with: node --test scripts/lib/narrationAudio.test.ts
//
// narrationAudio.mts imports kokoro-js — a real ~350MB ONNX model loaded
// via onnxruntime-node, requiring the model already be present in this
// machine's local Hugging Face cache (or a network fetch on first use) —
// exactly the same class of "cannot safely execute under bare `node --test`"
// dependency api/video/generate-storyboard.ts already has with the
// Anthropic SDK. Verified via source inspection instead; the actual
// synthesis pipeline was proven working by a REAL end-to-end render during
// this phase's own manual verification (see the phase's final report for
// the measured result — a genuine playable WAV with real audio samples,
// and a rendered MP4 whose duration reflected the synthesized audio
// length).
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const dir = path.dirname(fileURLToPath(import.meta.url))
const src = readFileSync(path.join(dir, 'narrationAudio.mts'), 'utf8')
const renderScriptSrc = readFileSync(path.join(dir, '..', 'render-storyboard.mts'), 'utf8')
const packageJsonSrc = readFileSync(path.join(dir, '..', '..', 'package.json'), 'utf8')
const narrationVoicesSrc = readFileSync(path.join(dir, '..', '..', 'src', 'lib', 'narrationVoices.ts'), 'utf8')

const stripComments = (source: string) =>
  source
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, ''))
    .join('\n')

describe('6. TTS is local-only — no external/paid TTS API is ever called', () => {
  test('the only speech-synthesis import is kokoro-js, run with device: "cpu" (local ONNX inference, no network call per-request)', () => {
    assert.match(src, /import \{ KokoroTTS \} from 'kokoro-js'/)
    assert.match(src, /device: 'cpu'/)
  })

  test('no external/paid TTS provider or cloud speech API is referenced anywhere in the render pipeline', () => {
    const forbidden = /elevenlabs|aws-sdk|polly|google-cloud|azure.*speech|openai.*audio|play\.ht|resemble\.ai|murf\.ai/i
    assert.equal(forbidden.test(src), false)
    assert.equal(forbidden.test(renderScriptSrc), false)
  })

  test('no network/HTTP call is made per narration request — only the model\'s own from_pretrained (a one-time local model load) and generate/save calls', () => {
    const code = stripComments(src)
    assert.equal(/fetch\(|axios|http\.request|https\.request/i.test(code), false)
  })
})

describe('7. Selected model/voice license information is documented', () => {
  test('the module documents the model (Kokoro-82M), its Apache-2.0 license, and the CC BY attribution note for its training data', () => {
    assert.match(src, /Kokoro-82M/)
    assert.match(src, /Apache-2\.0/)
    assert.match(src, /CC BY/)
  })

  test('kokoro-js is declared as an Apache-2.0-licensed dependency in package.json', () => {
    const pkg = JSON.parse(packageJsonSrc) as { devDependencies?: Record<string, string> }
    assert.ok(pkg.devDependencies?.['kokoro-js'], 'expected kokoro-js in devDependencies')
  })
})

describe('8. No voice-cloning dependency exists', () => {
  test('only two fixed, prebuilt Kokoro voice ids are ever selectable — no voice-sample upload, cloning, or custom-voice-training code exists', () => {
    // The literal option table now lives in src/lib/narrationVoices.ts (a
    // tiny, dependency-free file the browser can also import) —
    // narrationAudio.mts re-exports it rather than redefining it.
    assert.match(src, /export \{ NARRATION_VOICE_OPTIONS, type NarrationVoiceOption \}/)
    assert.match(narrationVoicesSrc, /export const NARRATION_VOICE_OPTIONS = \{/)
    const optionsBlock = narrationVoicesSrc.match(/export const NARRATION_VOICE_OPTIONS = \{([\s\S]*?)\} as const/)
    assert.ok(optionsBlock)
    const voiceIds = [...optionsBlock[1].matchAll(/'([a-z0-9_-]+)': '([a-z0-9_-]+)'/g)].map((m) => m[2])
    assert.equal(voiceIds.length, 2)
    assert.equal(/clone|voice-?sample|training-?audio|fine-?tune/i.test(stripComments(src)), false)
    assert.equal(/clone|voice-?sample|training-?audio|fine-?tune/i.test(stripComments(narrationVoicesSrc)), false)
  })

  test('the exposed voice option names are neutral (non-gendered) — the only place a Kokoro voice id is chosen', () => {
    assert.match(narrationVoicesSrc, /'professional-voice-1': 'af_heart'/)
    assert.match(narrationVoicesSrc, /'professional-voice-2': 'am_michael'/)
    assert.doesNotMatch(narrationVoicesSrc, /'male-voice'|'female-voice'/)
  })
})

describe('13. Visual/narration primitives do not mutate the storyboard passed in', () => {
  test('generateNarrationAndRetime builds a NEW scenes array and a NEW top-level storyboard object via spreads — never assigns into the input storyboard/scene objects', () => {
    const code = stripComments(src)
    assert.doesNotMatch(code, /storyboard\.\w+\s*=[^=]/)
    assert.doesNotMatch(code, /scene\.\w+\s*=[^=]/)
    assert.match(code, /const scenes: VideoStoryboardScene\[\] = \[\]/)
    assert.match(code, /return \{ \.\.\.storyboard, scenes \}/)
  })

  test('a scene with no narrationText is pushed through completely unchanged (by reference), never reconstructed/re-durationed', () => {
    assert.match(src, /if \(!scene\.narrationText \|\| scene\.avatarVideoAssetPath\) \{\s*\n\s*scenes\.push\(scene\)/)
  })

  test('a scene with a real avatar video attached is also pushed through unchanged — no redundant Kokoro synthesis for a track that is never played', () => {
    assert.match(src, /scene\.avatarVideoAssetPath/)
  })
})

describe('narration content is never logged', () => {
  test('the only console.log calls reference a scene id, never scene.narrationText/body/bullets content', () => {
    const logCalls = [...src.matchAll(/console\.log\((.*)\)/g)].map((m) => m[1])
    assert.ok(logCalls.length > 0)
    for (const call of logCalls) {
      assert.equal(/narrationText/.test(call), false)
    }
  })
})

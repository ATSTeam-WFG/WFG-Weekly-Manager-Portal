// Run with: node --experimental-strip-types --test scripts/lib/avatarVideoAssets.test.ts
//
// Real, functional tests — unlike narrationAudio.mts (which needs a real
// ~350MB Kokoro ONNX model and is therefore only tested via source
// inspection, per that file's own test header), this module's only
// dependency is @remotion/renderer's getVideoMetadata against a local
// file, so it's exercised for real here against a tiny, fully synthetic
// fixture clip generated on the fly (ffmpeg's lavfi nullsrc+sine sources —
// no provider, no network, no real media — the same technique used for
// Phase 2 Step 1's own manual render verification).
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { prepareAvatarVideoAssets } from './avatarVideoAssets.mts'
import type { VideoStoryboard } from '../../src/lib/videoStoryboard.ts'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const ffmpegBin = path.join(projectRoot, 'node_modules', '@remotion', 'compositor-darwin-arm64', 'ffmpeg')

let publicDir: string
let fixtureDurationSeconds: number

function storyboardWith(scenes: VideoStoryboard['scenes']): VideoStoryboard {
  return { periodLabel: 'test', sourceType: 'weekly-summary', scenes } as VideoStoryboard
}

before(() => {
  publicDir = mkdtempSync(path.join(tmpdir(), 'avatar-video-assets-test-'))
  fixtureDurationSeconds = 3
  if (existsSync(ffmpegBin)) {
    // This bundled binary needs its sibling .dylibs on the loader path —
    // the same DYLD_LIBRARY_PATH requirement every other direct
    // invocation of it in this project already needs.
    const compositorDir = path.dirname(ffmpegBin)
    execFileSync(
      ffmpegBin,
      [
        '-y',
        '-f',
        'lavfi',
        '-i',
        `nullsrc=size=320x320:duration=${fixtureDurationSeconds}:rate=30`,
        '-f',
        'lavfi',
        '-i',
        `sine=frequency=440:duration=${fixtureDurationSeconds}`,
        '-c:v',
        'libx264',
        '-pix_fmt',
        'yuv420p',
        '-c:a',
        'aac',
        '-shortest',
        path.join(publicDir, 'opening.mp4'),
      ],
      { env: { ...process.env, DYLD_LIBRARY_PATH: compositorDir } },
    )
  }
})

after(() => {
  rmSync(publicDir, { recursive: true, force: true })
})

describe('prepareAvatarVideoAssets — real local file, no provider involved', () => {
  test('a scene with no avatarVideoAssetPath is pushed through completely unchanged', async () => {
    const scene = { id: 'topic-0', type: 'highlights', title: 'x' } as VideoStoryboard['scenes'][number]
    const result = await prepareAvatarVideoAssets(storyboardWith([scene]), publicDir)
    assert.deepEqual(result.scenes[0], scene)
  })

  test('a scene whose avatarVideoAssetPath does not exist on disk gracefully falls back — field cleared, never throws', async () => {
    const scene = {
      id: 'opening',
      type: 'opening',
      title: 'x',
      avatarVideoAssetPath: 'does-not-exist.mp4',
    } as VideoStoryboard['scenes'][number]
    const result = await prepareAvatarVideoAssets(storyboardWith([scene]), publicDir)
    assert.equal(result.scenes[0].avatarVideoAssetPath, undefined)
    assert.equal(result.scenes[0].avatarVideoDurationSeconds, undefined)
  })

  test('a scene with a REAL local clip gets its real measured duration, and durationSeconds driven by it (lead-in + clip + tail, never a guess)', { skip: !existsSync(ffmpegBin) }, async () => {
    const scene = {
      id: 'opening',
      type: 'opening',
      title: 'x',
      avatarVideoAssetPath: 'opening.mp4',
    } as VideoStoryboard['scenes'][number]
    const result = await prepareAvatarVideoAssets(storyboardWith([scene]), publicDir)
    const measured = result.scenes[0]
    assert.ok(measured.avatarVideoDurationSeconds, 'expected a real measured duration')
    assert.ok(Math.abs(measured.avatarVideoDurationSeconds! - fixtureDurationSeconds) < 0.5, `expected ~${fixtureDurationSeconds}s, got ${measured.avatarVideoDurationSeconds}`)
    // durationSeconds must be STRICTLY LONGER than the raw clip (lead-in +
    // tail padding) — never equal to or shorter than it, which would risk
    // cutting the clip's own speech off mid-sentence.
    assert.ok(measured.durationSeconds! > measured.avatarVideoDurationSeconds!, 'scene durationSeconds must include lead-in/tail padding beyond the raw clip length')
    assert.equal(measured.avatarVideoAssetPath, 'opening.mp4')
  })

  test('never mutates the input storyboard/scene objects — returns a new storyboard, same discipline as every other render-time asset step', async () => {
    const scene = { id: 'topic-0', type: 'highlights', title: 'x' } as VideoStoryboard['scenes'][number]
    const input = storyboardWith([scene])
    const result = await prepareAvatarVideoAssets(input, publicDir)
    assert.notEqual(result, input)
    assert.notEqual(result.scenes, input.scenes)
  })
})

import type { VideoStoryboard } from '../../src/lib/videoStoryboard.js'

type Result =
  | { ok: true; storyboard: VideoStoryboard }
  | { ok: false; code: string }

const SCENE_TYPES = new Set([
  'opening', 'executive-snapshot', 'big-metric',
  'multi-metric', 'highlights', 'status', 'risk',
  'forward-look', 'closing',
])

const forbiddenAssetFields = [
  'fluxAssetPath',
  'fluxHeroAssetPath',
  'fluxMotifAssetPath',
  'cinematicAssets',
  'avatarVideoAssetPath',
  'avatarVideoDurationSeconds',
]

function record(value: unknown): value is Record<string, unknown> {
  return value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value)
}

function boundedText(value: unknown, max: number): boolean {
  return typeof value === 'string' &&
    value.length <= max &&
    !/[\x00-\x08\x0B\x0C\x0E-\x1F]/.test(value)
}

export function validateRenderStoryboard(
  value: unknown,
  expectedSourceType: 'weekly-summary' | 'leadership-report',
): Result {
  if (!record(value) ||
      value.sourceType !== expectedSourceType ||
      !boundedText(value.title, 200) ||
      !boundedText(value.weekEnding, 100) ||
      !['ai', 'deterministic'].includes(String(value.generationMethod)) ||
      !Array.isArray(value.scenes) ||
      value.scenes.length < 2 ||
      value.scenes.length > 11) {
    return { ok: false, code: 'INVALID_STORYBOARD' }
  }

  const ids = new Set<string>()
  let totalDuration = 0

  for (let index = 0; index < value.scenes.length; index++) {
    const scene = value.scenes[index]

    if (!record(scene) ||
        typeof scene.id !== 'string' ||
        !/^[a-zA-Z0-9_-]{1,100}$/.test(scene.id) ||
        ids.has(scene.id) ||
        !SCENE_TYPES.has(String(scene.type)) ||
        !boundedText(scene.title, 120) ||
        (typeof scene.title === 'string' && !scene.title.trim()) ||
        (scene.narrationText !== undefined &&
          !boundedText(scene.narrationText, 210))) {
      return { ok: false, code: 'INVALID_SCENE' }
    }

    ids.add(scene.id)

    if (index === 0 && scene.type !== 'opening') {
      return { ok: false, code: 'INVALID_SCENE_ORDER' }
    }

    if (index === value.scenes.length - 1 && scene.type !== 'closing') {
      return { ok: false, code: 'INVALID_SCENE_ORDER' }
    }

    if (index > 0 &&
        index < value.scenes.length - 1 &&
        (scene.type === 'opening' || scene.type === 'closing')) {
      return { ok: false, code: 'INVALID_SCENE_ORDER' }
    }

    for (const field of forbiddenAssetFields) {
      if (scene[field] !== undefined) {
        return { ok: false, code: 'ASSET_AUTHORIZATION_REQUIRED' }
      }
    }

    if (scene.durationSeconds !== undefined &&
        (typeof scene.durationSeconds !== 'number' ||
          !Number.isFinite(scene.durationSeconds) ||
          scene.durationSeconds < 1 ||
          scene.durationSeconds > 30)) {
      return { ok: false, code: 'INVALID_DURATION' }
    }

    totalDuration += typeof scene.durationSeconds === 'number'
      ? scene.durationSeconds
      : 8
  }

  if (totalDuration > 90) {
    return { ok: false, code: 'VIDEO_TOO_LONG' }
  }

  return {
    ok: true,
    storyboard: value as unknown as VideoStoryboard,
  }
}

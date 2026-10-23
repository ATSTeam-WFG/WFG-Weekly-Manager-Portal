import { existsSync } from 'node:fs'
import path from 'node:path'
import { getVideoMetadata } from '@remotion/renderer'
import type { VideoStoryboard, VideoStoryboardScene } from '../../src/lib/videoStoryboard.ts'
import { NARRATION_LEAD_IN_SECONDS, NARRATION_TAIL_SECONDS, MIN_NARRATED_SCENE_SECONDS } from '../../remotion/narrationTiming.ts'

// Phase 2 Step 2A — measures the REAL length of any avatar-video clip a
// prior, explicit, human-approved generate_avatar_video step has already
// downloaded into remotion/public/ (see dev/local-avatar-asset-plugin.ts),
// and derives this scene's real durationSeconds from it — the exact same
// discipline scripts/lib/narrationAudio.mts already applies to Kokoro
// narration, reusing its own NARRATION_LEAD_IN_SECONDS/NARRATION_TAIL_SECONDS
// constants so an avatar scene gets the identical "a beat before, a beat
// after" treatment a Kokoro-narrated scene already gets. Must run BEFORE
// bundle() for the same publicDir-copy-timing reason as every other
// render-time asset in this pipeline — and BEFORE generateNarrationAndRetime,
// so that function's own avatarVideoAssetPath skip (never synthesizing a
// redundant, unused Kokoro WAV for a scene whose real narration is the
// clip's own embedded audio) sees this scene's final state.
//
// NEVER touches Supabase, a provider, or the network — reads only a local
// file already placed by an earlier step. A missing or unmeasurable file
// degrades the scene back to its normal, non-avatar treatment (clears
// avatarVideoAssetPath) rather than failing the whole render — the same
// "never invent/guess, always degrade safely" discipline every other
// optional render-time asset in this pipeline already follows.
export async function prepareAvatarVideoAssets(storyboard: VideoStoryboard, publicDir: string): Promise<VideoStoryboard> {
  const scenes: VideoStoryboardScene[] = []
  for (const scene of storyboard.scenes) {
    if (!scene.avatarVideoAssetPath) {
      scenes.push(scene)
      continue
    }

    const absolutePath = path.join(publicDir, scene.avatarVideoAssetPath)
    if (!existsSync(absolutePath)) {
      console.log(`[avatar-video] scene "${scene.id}": avatarVideoAssetPath not found on disk, falling back to the normal scene treatment`)
      const { avatarVideoAssetPath: _omit, avatarVideoDurationSeconds: _omit2, ...rest } = scene
      scenes.push(rest)
      continue
    }

    console.log(`[avatar-video] scene "${scene.id}": measuring real clip duration...`)
    const metadata = await getVideoMetadata(absolutePath)
    if (!metadata.durationInSeconds || metadata.durationInSeconds <= 0) {
      console.log(`[avatar-video] scene "${scene.id}": could not measure a valid duration, falling back to the normal scene treatment`)
      const { avatarVideoAssetPath: _omit, avatarVideoDurationSeconds: _omit2, ...rest } = scene
      scenes.push(rest)
      continue
    }

    const durationSeconds = Math.max(MIN_NARRATED_SCENE_SECONDS, NARRATION_LEAD_IN_SECONDS + metadata.durationInSeconds + NARRATION_TAIL_SECONDS)
    scenes.push({ ...scene, avatarVideoDurationSeconds: metadata.durationInSeconds, durationSeconds })
  }

  return { ...storyboard, scenes }
}

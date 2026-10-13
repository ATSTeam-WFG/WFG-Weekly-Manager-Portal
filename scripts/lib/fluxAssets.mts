import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { VideoStoryboard, VideoStoryboardScene } from '../../src/lib/videoStoryboard.ts'
import {
  FLUX_ASSET_HEIGHT,
  FLUX_ASSET_WIDTH,
  FLUX_HERO_HEIGHT,
  FLUX_HERO_WIDTH,
  fluxAssetCacheKey,
  fluxAssetSeed,
  getFluxAssetPrompt,
  getFluxHeroPrompt,
  getFluxMotifPrompt,
} from '../../remotion/fluxPrompts.ts'

// LOCAL, licensed image generation only — FLUX.1-schnell (Apache-2.0,
// black-forest-labs/FLUX.1-schnell), run entirely on this machine via the
// `mflux` CLI (MIT license) installed into the stable, in-repo `.flux-env/`
// Python venv (see .gitignore's own comment on why this venv is stable/
// in-repo rather than an ephemeral scratch directory). Every prompt this
// module sends to mflux comes ONLY from remotion/fluxPrompts.ts's hardcoded
// lookup — see that file's own header for the sanitization guarantee this
// depends on. No network call is ever made per-generation beyond mflux's
// own one-time model download into this machine's Hugging Face cache
// (already warm from this phase's earlier feasibility prototypes); nothing
// here calls any external/paid image API.
//
// Never run more than one mflux-generate process at a time (the phase
// brief's explicit 16GB-unified-memory constraint) — generateFluxAssetsAndAttach
// below awaits each generation in a plain sequential for-loop, never
// Promise.all/concurrent spawns.
//
// Generated PNGs are cached forever, keyed ONLY by (storyEngine,
// visualPlan.subject) — see fluxAssetCacheKey's own header — so the exact
// same file is reused across every future weekly report; a render never
// regenerates an asset that already exists on disk. Written into
// remotion/public/flux-assets/ (gitignored, never committed) for the exact
// same @remotion/bundler timing reason narrationAudio.mts documents for its
// own narration directory: bundle() copies publicDir's contents at BUNDLE
// time, so an asset must exist before bundle() runs.

const PROJECT_ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))))
const ASSET_DIR = path.join(PROJECT_ROOT, 'remotion', 'public', 'flux-assets')
const MFLUX_BIN = path.join(PROJECT_ROOT, '.flux-env', 'bin', 'mflux-generate')

function assetFileName(cacheKey: string): string {
  return `${cacheKey}.png`
}

// Spawns the local mflux CLI once, sequentially — resolves `true` only when
// the process exited 0 AND the output file actually exists; resolves
// `false` (never rejects/throws) on ANY failure (missing local FLUX
// environment, mflux error, non-zero exit) so the caller can fall back to
// the existing programmatic SVG illustration, per the phase brief's
// "if asset generation fails, the video must have a deterministic
// programmatic fallback."
function generateOneAsset(cacheKey: string, prompt: string, width: number = FLUX_ASSET_WIDTH, height: number = FLUX_ASSET_HEIGHT): Promise<boolean> {
  const outputPath = path.join(ASSET_DIR, assetFileName(cacheKey))
  const promptFilePath = path.join(ASSET_DIR, `.${cacheKey}.prompt.txt`)
  writeFileSync(promptFilePath, prompt)

  return new Promise((resolve) => {
    if (!existsSync(MFLUX_BIN)) {
      console.warn(`[flux-assets] local FLUX environment not found at ${MFLUX_BIN} — skipping generation, falling back.`)
      rmSync(promptFilePath, { force: true })
      resolve(false)
      return
    }

    const child = spawn(
      MFLUX_BIN,
      [
        '--model',
        'schnell',
        '--quantize',
        '4',
        '--low-ram',
        '--steps',
        '4',
        '--seed',
        String(fluxAssetSeed(cacheKey)),
        '--height',
        String(height),
        '--width',
        String(width),
        '--prompt-file',
        promptFilePath,
        '--output',
        outputPath,
      ],
      { stdio: 'inherit' },
    )
    child.on('exit', (code) => {
      rmSync(promptFilePath, { force: true })
      resolve(code === 0 && existsSync(outputPath))
    })
    child.on('error', (err) => {
      console.warn(`[flux-assets] mflux-generate failed to start: ${err.message}`)
      rmSync(promptFilePath, { force: true })
      resolve(false)
    })
  })
}

// Pure — resolves the (cacheKey, prompt) pair a scene would use, WITHOUT
// touching the filesystem or spawning anything. Exported separately so it
// can be exercised directly with real execution (unlike the actual
// subprocess-spawning generation below, which cannot safely run under bare
// `node --test` any more than narrationAudio.mts's real Kokoro model load
// can — see fluxAssets.test.mts).
export function resolveFluxAsset(scene: VideoStoryboardScene): { cacheKey: string; prompt: string } | undefined {
  // forward-look scenes never carry a real storyEngine (see
  // inferStoryEngine's own comment — they keep their existing simpler
  // editorial treatment as a CONTENT-classification matter), but the
  // RENDERER always gives forward-look the same pipeline-shaped
  // progression treatment as a fixed rendering convention (see
  // StoryScene.tsx's own comment) — so it independently qualifies for the
  // matching pipeline-story environment asset here too. This never writes
  // storyEngine into the scene data; it only affects which cached asset
  // this render-time lookup resolves.
  const engine = scene.storyEngine ?? (scene.type === 'forward-look' ? 'pipeline-story' : undefined)
  if (!engine || !scene.visualPlan?.subject) return undefined
  const prompt = getFluxAssetPrompt(engine, scene.visualPlan.subject)
  if (!prompt) return undefined
  return { cacheKey: fluxAssetCacheKey(engine, scene.visualPlan.subject), prompt }
}

// Pure — same shape as resolveFluxAsset above, but for the PRIMARY hero
// illustration + its optional motif overlay (visual-direction v3). Only
// ever resolves when the subject has a mapped hero prompt — everything
// else (an unfamiliar future topic, or a subject that intentionally has
// no hero treatment) returns undefined, and the scene keeps its existing
// LayeredStoryScene/StoryScene fallback untouched.
export function resolveFluxHeroAsset(scene: VideoStoryboardScene): { heroCacheKey: string; heroPrompt: string; motifCacheKey?: string; motifPrompt?: string } | undefined {
  const engine = scene.storyEngine ?? (scene.type === 'forward-look' ? 'pipeline-story' : undefined)
  if (!engine || !scene.visualPlan?.subject) return undefined
  const subject = scene.visualPlan.subject
  const heroPrompt = getFluxHeroPrompt(subject)
  if (!heroPrompt) return undefined
  const baseCacheKey = fluxAssetCacheKey(engine, subject)
  const motifPrompt = getFluxMotifPrompt(subject)
  return {
    heroCacheKey: `${baseCacheKey}__hero`,
    heroPrompt,
    motifCacheKey: motifPrompt ? `${baseCacheKey}__motif` : undefined,
    motifPrompt,
  }
}

// Generates (or reuses a cached) FLUX asset for every scene that has one,
// and returns a NEW VideoStoryboard (never mutates the one passed in —
// same discipline as generateNarrationAndRetime) whose qualifying scenes
// carry a fluxAssetPath. A scene with no resolvable (storyEngine, subject)
// pair, or whose generation failed, is returned completely unchanged.
export async function generateFluxAssetsAndAttach(storyboard: VideoStoryboard): Promise<VideoStoryboard> {
  mkdirSync(ASSET_DIR, { recursive: true })

  const scenes: VideoStoryboardScene[] = []
  for (const scene of storyboard.scenes) {
    let nextScene = scene

    const resolved = resolveFluxAsset(scene)
    if (resolved) {
      const { cacheKey, prompt } = resolved
      const outputPath = path.join(ASSET_DIR, assetFileName(cacheKey))
      if (existsSync(outputPath)) {
        console.log(`[flux-assets] reusing cached asset "${cacheKey}"`)
        nextScene = { ...nextScene, fluxAssetPath: `flux-assets/${assetFileName(cacheKey)}` }
      } else {
        console.log(`[flux-assets] generating local FLUX.1-schnell asset "${cacheKey}" (sequential)...`)
        const ok = await generateOneAsset(cacheKey, prompt)
        if (ok) {
          nextScene = { ...nextScene, fluxAssetPath: `flux-assets/${assetFileName(cacheKey)}` }
        } else {
          console.warn(`[flux-assets] generation of "${cacheKey}" did not succeed — falling back to the programmatic illustration.`)
        }
      }
    }

    const resolvedHero = resolveFluxHeroAsset(scene)
    if (resolvedHero) {
      const { heroCacheKey, heroPrompt, motifCacheKey, motifPrompt } = resolvedHero
      const heroOutputPath = path.join(ASSET_DIR, assetFileName(heroCacheKey))
      if (existsSync(heroOutputPath)) {
        console.log(`[flux-assets] reusing cached hero asset "${heroCacheKey}"`)
        nextScene = { ...nextScene, fluxHeroAssetPath: `flux-assets/${assetFileName(heroCacheKey)}` }
      } else {
        console.log(`[flux-assets] generating local FLUX.1-schnell HERO illustration "${heroCacheKey}" (sequential)...`)
        const ok = await generateOneAsset(heroCacheKey, heroPrompt, FLUX_HERO_WIDTH, FLUX_HERO_HEIGHT)
        if (ok) {
          nextScene = { ...nextScene, fluxHeroAssetPath: `flux-assets/${assetFileName(heroCacheKey)}` }
        } else {
          console.warn(`[flux-assets] hero generation of "${heroCacheKey}" did not succeed — falling back to the existing rendering.`)
        }
      }

      if (motifCacheKey && motifPrompt) {
        const motifOutputPath = path.join(ASSET_DIR, assetFileName(motifCacheKey))
        if (existsSync(motifOutputPath)) {
          console.log(`[flux-assets] reusing cached motif asset "${motifCacheKey}"`)
          nextScene = { ...nextScene, fluxMotifAssetPath: `flux-assets/${assetFileName(motifCacheKey)}` }
        } else {
          console.log(`[flux-assets] generating local FLUX.1-schnell motif "${motifCacheKey}" (sequential)...`)
          const ok = await generateOneAsset(motifCacheKey, motifPrompt, 640, 640)
          if (ok) {
            nextScene = { ...nextScene, fluxMotifAssetPath: `flux-assets/${assetFileName(motifCacheKey)}` }
          } else {
            console.warn(`[flux-assets] motif generation of "${motifCacheKey}" did not succeed — scene keeps its hero illustration without an overlay motif.`)
          }
        }
      }
    }

    scenes.push(nextScene)
  }

  return { ...storyboard, scenes }
}

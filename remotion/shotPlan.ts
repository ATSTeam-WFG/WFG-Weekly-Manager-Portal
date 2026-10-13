import type { CinematicAsset, VideoStoryboardScene } from '../src/lib/videoStoryboard'
import { cinematicTreatmentForScene } from './visualStorySpec.ts'

// THE SHOT-LEVEL COMPOSITION MODEL (generalized, v4) — decomposes ONE
// scene's existing audio-driven duration into an ordered sequence of
// SHOTS: zero or more CINEMATIC shots (real footage, each bounded by its
// own trimmed real length — never held past its last frame, never looped)
// plus AT MOST ONE short (~1.5-3s) ACCENT shot — a brief editorial motion-
// graphic beat, never a long filler screen. This is a PRESENTATION-layer
// transform only, same discipline as cinematicTreatmentForScene: it reads
// only fields the content/grounding layer already decided
// (scene.cinematicAssets, metrics/bullets/next) and invents no new
// business fact, content, or narration.
//
// GENERALIZED: this works for ANY scene with cinematicAssets attached,
// for any week's content — nothing here is specific to any one topic.
// A scene with NO cinematicAssets never reaches this function's shot
// output at all (returns []); IllustratedStoryScene.tsx keeps its
// existing single-backdrop-plus-overlay FLUX treatment for every such
// scene, completely unchanged.

export type Shot =
  | { kind: 'cinematic'; asset: CinematicAsset; durationInFrames: number; label?: string }
  | { kind: 'accent'; durationInFrames: number }

// An accent beat is a short, deliberately-designed static/motion-graphic
// moment — holding it is fine (it's designed to be looked at), unlike
// holding a video's last frame. Capped short so cinematic footage remains
// the primary visual language, per the approved direction: motion graphics
// are brief editorial accents, not long filler screens.
const ACCENT_MIN_SECONDS = 1.5
const ACCENT_MAX_SECONDS = 3

// Treatments with a genuine grounded fact worth isolating get one accent
// beat; CINEMATIC_ENVIRONMENT (no specific metric/map/bullet to show) does
// not, UNLESS the available footage falls short of the scene's full
// duration — see the overflow handling below, which can still add a
// (generic, branded) accent purely to avoid ever holding a video's last
// frame.
const ACCENT_ELIGIBLE_TREATMENTS = new Set(['REGIONAL_MAP', 'DATA_STORY', 'HERO_METRIC', 'TECHNOLOGY', 'CHALLENGE'])

function assetUsableFrames(asset: CinematicAsset, fps: number): number {
  const start = asset.trimStartSeconds ?? 0
  const end = asset.trimEndSeconds ?? asset.durationSeconds
  return Math.max(0, Math.floor((end - start) * fps))
}

export function shotPlanForScene(scene: VideoStoryboardScene, fps: number, sceneDurationInFrames: number): Shot[] {
  const assets = scene.cinematicAssets
  if (!assets || assets.length === 0) {
    return []
  }

  const treatment = cinematicTreatmentForScene(scene)
  const wantsAccent = ACCENT_ELIGIBLE_TREATMENTS.has(treatment)
  const baseAccentFrames = wantsAccent ? Math.round(Math.min(ACCENT_MAX_SECONDS, Math.max(ACCENT_MIN_SECONDS, sceneDurationInFrames / fps / 6)) * fps) : 0

  const cinematicBudgetFrames = Math.max(0, sceneDurationInFrames - baseAccentFrames)

  // Distribute the cinematic budget across the available assets,
  // proportionally, but never past any single asset's own real (trimmed)
  // length — this is what guarantees a cinematic shot is never held past
  // its last frame.
  const shots: Shot[] = []
  let remaining = cinematicBudgetFrames
  assets.forEach((asset, index) => {
    const ownMax = assetUsableFrames(asset, fps)
    const assetsLeft = assets.length - index
    const share = Math.min(ownMax, Math.max(0, Math.ceil(remaining / assetsLeft)))
    shots.push({ kind: 'cinematic', asset, durationInFrames: share, label: index === 0 ? scene.eyebrow : undefined })
    remaining -= share
  })

  // Whatever the cinematic shots couldn't cover (footage shorter than the
  // scene, e.g. because only one generation exists) goes to the accent —
  // creating one even for a treatment that wouldn't normally get one,
  // rather than ever leaving a cinematic shot to freeze/loop to fill time.
  const accentFrames = baseAccentFrames + Math.max(0, remaining)
  if (accentFrames > 0) {
    shots.push({ kind: 'accent', durationInFrames: accentFrames })
  }

  return shots
}

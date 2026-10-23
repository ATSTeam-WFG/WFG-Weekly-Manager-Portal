// Run with: node --test remotion/cinematicPlan.test.ts
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { planShotsForScene, planShotsForStoryboard, summarizeGenerationNeeds } from './cinematicPlan.ts'
import { estimateGenerationCostUsd, COST_PER_GENERATED_SECOND_USD } from './cinematicGenerationPricing.ts'
import type { VideoStoryboardScene } from '../src/lib/videoStoryboard.ts'

function scene(overrides: Partial<VideoStoryboardScene> & Pick<VideoStoryboardScene, 'id' | 'title' | 'type'>): VideoStoryboardScene {
  return overrides
}

// A realistic mixed storyboard shape (branded opening/closing + bare +
// rich + regional scenes) — shared across the authoritative-counting and
// prompt-variety test groups below.
function mixedStoryboard(): VideoStoryboardScene[] {
  return [
    scene({ id: 'open', title: 'Open', type: 'opening' }),
    scene({ id: 's0', title: 'bare', type: 'highlights' }),
    scene({
      id: 's1',
      title: 'rich',
      type: 'multi-metric',
      metrics: [{ label: 'a', value: '$1' }, { label: 'b', value: '$2' }],
      bullets: ['c'],
    }),
    scene({ id: 's2', title: 'regional', type: 'status', bullets: ['A new deal closed in Tennessee this week'] }),
    scene({ id: 'close', title: 'Close', type: 'closing' }),
  ]
}

describe('opening/closing/forward-look produce no unnecessary generation', () => {
  test('opening gets exactly one branded shot, requiresGeneration false', () => {
    const plan = planShotsForScene(scene({ id: 's0', title: 'x', type: 'opening' }))
    assert.equal(plan.shots.length, 1)
    assert.equal(plan.shots[0].type, 'branded')
    assert.equal(plan.shots[0].requiresGeneration, false)
  })

  test('closing gets exactly one branded shot, requiresGeneration false', () => {
    const plan = planShotsForScene(scene({ id: 's0', title: 'x', type: 'closing' }))
    assert.equal(plan.shots.length, 1)
    assert.equal(plan.shots[0].requiresGeneration, false)
  })

  test('forward-look gets exactly one branded shot even with bullets/next present (forward-look always wins the treatment classification)', () => {
    const plan = planShotsForScene(scene({ id: 's0', title: 'x', type: 'forward-look', bullets: ['a', 'b'], next: 'c' }))
    assert.equal(plan.shots.length, 1)
    assert.equal(plan.shots[0].requiresGeneration, false)
  })
})

describe('scene planning is content-driven, not title/id-based — two structurally-identical-content scenes with different titles/ids produce the same shape', () => {
  test('two scenes with identical metrics/bullets/leadershipImportance but different ids/titles produce an identical shot shape (same counts/types), differing only in id/title/sceneId fields', () => {
    const planA = planShotsForScene(
      scene({ id: 'scene-alpha', title: 'Totally Different Title A', type: 'highlights', metrics: [{ label: 'a', value: '$1' }, { label: 'b', value: '$2' }] }),
    )
    const planB = planShotsForScene(
      scene({ id: 'scene-beta', title: 'Completely Unrelated Title B', type: 'highlights', metrics: [{ label: 'a', value: '$1' }, { label: 'b', value: '$2' }] }),
    )
    assert.equal(planA.shots.length, planB.shots.length)
    assert.deepEqual(planA.shots.map((s) => s.type), planB.shots.map((s) => s.type))
    assert.deepEqual(planA.shots.map((s) => s.purpose), planB.shots.map((s) => s.purpose))
  })

  test('a scene mentioning a real US region gets a regional_map accent, derived purely from detectGroundedRegion, not from any hardcoded scene id', () => {
    const plan = planShotsForScene(scene({ id: 's0', title: 'x', type: 'highlights', bullets: ['A new deal closed in Tennessee this week'] }))
    const accent = plan.shots.find((s) => s.type === 'motion_graphic')
    assert.ok(accent)
    assert.equal(accent.accentType, 'regional_map')
  })
})

describe('number of visual beats is NOT universally fixed at 2 — it scales with content richness', () => {
  test('a scene with zero metrics/bullets/region gets exactly 2 cinematic shots and no accent (minimum, no unnecessary generation)', () => {
    const plan = planShotsForScene(scene({ id: 's0', title: 'x', type: 'highlights' }))
    assert.equal(plan.shots.length, 2)
    assert.ok(plan.shots.every((s) => s.type === 'cinematic'))
  })

  test('a scene with a single metric gets 2 cinematic + 1 accent = 3 beats', () => {
    const plan = planShotsForScene(scene({ id: 's0', title: 'x', type: 'big-metric', metrics: [{ label: 'a', value: '$1' }] }))
    assert.equal(plan.shots.length, 3)
  })

  test('a genuinely rich scene (2 metrics + 1 bullet = richness 3) gets 3 cinematic + 1 accent = 4 beats', () => {
    const plan = planShotsForScene(
      scene({ id: 's0', title: 'x', type: 'multi-metric', metrics: [{ label: 'a', value: '$1' }, { label: 'b', value: '$2' }], bullets: ['c'] }),
    )
    assert.equal(plan.shots.length, 4)
    assert.equal(plan.shots.filter((s) => s.type === 'cinematic').length, 3)
    assert.equal(plan.shots.filter((s) => s.type === 'motion_graphic').length, 1)
  })

  test('the 2/3/4-beat outcomes all actually occur across a realistic mixed storyboard — beat count is not hardcoded to one value', () => {
    const plans = planShotsForStoryboard([
      scene({ id: 's0', title: 'bare', type: 'highlights' }),
      scene({ id: 's1', title: 'one metric', type: 'big-metric', metrics: [{ label: 'a', value: '$1' }] }),
      scene({ id: 's2', title: 'rich', type: 'multi-metric', metrics: [{ label: 'a', value: '$1' }, { label: 'b', value: '$2' }], bullets: ['c'] }),
    ])
    const counts = new Set(plans.map((p) => p.shots.length))
    assert.ok(counts.size >= 3, `expected at least 3 distinct beat counts across varied content, got ${[...counts]}`)
  })
})

describe('motion-graphic accents remain short', () => {
  test('every motion_graphic shot has a screenDurationSeconds of 3 seconds or less', () => {
    const plans = planShotsForStoryboard([
      scene({ id: 's0', title: 'x', type: 'big-metric', metrics: [{ label: 'a', value: '$1' }] }),
      scene({ id: 's1', title: 'y', type: 'risk', bullets: ['something broken'] }),
    ])
    const accents = plans.flatMap((p) => p.shots).filter((s) => s.type === 'motion_graphic')
    assert.ok(accents.length > 0)
    for (const accent of accents) {
      assert.ok(accent.screenDurationSeconds <= 3, `expected a short accent, got ${accent.screenDurationSeconds}s`)
    }
  })
})

describe('no invented report facts ever enter a visualPrompt', () => {
  test('two scenes that land on the SAME treatment but have completely different grounded content never leak either scene\'s title/fact text into either prompt, even though prompts may now carry scene-distinct cosmetic variation', () => {
    // Both scenes are bare (no metrics/bullets/region) so both classify as
    // CINEMATIC_ENVIRONMENT — the one thing that differs is the title/id.
    const planA = planShotsForScene(scene({ id: 's0', title: 'Scene About a $50M closed deal', type: 'highlights' }))
    const planB = planShotsForScene(scene({ id: 's1', title: 'Scene About Something Else Entirely', type: 'highlights' }))
    assert.equal(planA.treatment, planB.treatment, 'test fixture error: both scenes must share a treatment for this to be a valid check')
    const promptsA = planA.shots.filter((s) => s.type === 'cinematic').map((s) => s.visualPrompt)
    const promptsB = planB.shots.filter((s) => s.type === 'cinematic').map((s) => s.visualPrompt)
    for (const prompt of [...promptsA, ...promptsB]) {
      assert.ok(prompt)
      assert.equal(prompt!.includes('50M'), false)
      assert.equal(prompt!.includes('closed deal'), false)
      assert.equal(prompt!.includes('Something Else'), false)
    }
  })

  test('the same scene plans twice in a row produce byte-identical visualPrompts — variation is seeded deterministically (generationAssetId), never by Math.random/Date.now', () => {
    const planA1 = planShotsForScene(scene({ id: 's0', title: 'x', type: 'highlights' }))
    const planA2 = planShotsForScene(scene({ id: 's0', title: 'x', type: 'highlights' }))
    assert.deepEqual(
      planA1.shots.map((s) => s.visualPrompt),
      planA2.shots.map((s) => s.visualPrompt),
    )
  })

  test('two scenes sharing the same (treatment, purpose) pair but different scene ids no longer collapse to byte-identical prompt bodies', () => {
    const planA = planShotsForScene(scene({ id: 'topic-1', title: 'a', type: 'highlights' }))
    const planB = planShotsForScene(scene({ id: 'topic-2', title: 'b', type: 'highlights' }))
    assert.equal(planA.treatment, planB.treatment, 'test fixture error: both scenes must share a treatment for this to be a valid check')
    const promptA = planA.shots.find((s) => s.type === 'cinematic' && s.requiresGeneration)!.visualPrompt
    const promptB = planB.shots.find((s) => s.type === 'cinematic' && s.requiresGeneration)!.visualPrompt
    assert.notEqual(promptA, promptB)
  })

  test('a storyboard with two scenes that genuinely share a (treatment, purpose) pair produces more distinct prompt bodies than distinct pairs alone would — proving variation differentiates same-pair assets across scenes', () => {
    // Both scenes are bare (no metrics/bullets/region) so both land on the
    // same CINEMATIC_ENVIRONMENT treatment and the same purpose sequence —
    // exactly the real Oct. 2 "topic-1 / topic-2" same-treatment case.
    const scenes = [
      scene({ id: 'topic-1', title: 'Process Delays', type: 'highlights' }),
      scene({ id: 'topic-2', title: 'Lender Acceptance', type: 'status' }),
    ]
    const plans = planShotsForStoryboard(scenes)
    const generatingShots = plans.flatMap((plan) => plan.shots.filter((s) => s.requiresGeneration).map((s) => ({ ...s, treatment: plan.treatment })))
    const uniquePrompts = new Set(generatingShots.map((s) => s.visualPrompt))
    const uniquePairs = new Set(generatingShots.map((s) => `${s.treatment}:${s.purpose}`))
    assert.ok(
      uniquePrompts.size > uniquePairs.size,
      `expected more distinct prompt bodies (${uniquePrompts.size}) than distinct (treatment,purpose) pairs (${uniquePairs.size})`,
    )
  })

  test('no cinematic visualPrompt contains the grounded metric\'s own value/label text, a dollar figure, or any digit beyond the fixed "16:9" aspect-ratio spec — and it explicitly forbids numbers/logos/UI from being generated', () => {
    const plan = planShotsForScene(scene({ id: 's0', title: 'x', type: 'multi-metric', metrics: [{ label: 'Revenue', value: '$42M' }] }))
    for (const shot of plan.shots.filter((s) => s.type === 'cinematic')) {
      assert.ok(shot.visualPrompt)
      const withoutAspectRatio = shot.visualPrompt!.replace('16:9', '')
      assert.equal(/\$|\d/.test(withoutAspectRatio), false, 'a visual prompt must never contain a digit or dollar sign (outside the fixed aspect-ratio spec)')
      assert.equal(shot.visualPrompt!.includes('42'), false)
      assert.equal(shot.visualPrompt!.includes('Revenue'), false)
      assert.match(shot.visualPrompt!, /no readable text, no numbers, no logos, no screens with visible UI/)
    }
  })

  test('a motion_graphic shot carries no visualPrompt at all (it is rendered by Remotion directly from grounded fields, never sent to a video-generation model)', () => {
    const plan = planShotsForScene(scene({ id: 's0', title: 'x', type: 'big-metric', metrics: [{ label: 'a', value: '$1' }] }))
    const accent = plan.shots.find((s) => s.type === 'motion_graphic')
    assert.ok(accent)
    assert.equal(accent.visualPrompt, undefined)
  })
})

describe('TECHNOLOGY and CHALLENGE now expose genuinely distinct shot vocabularies (the reported gap)', () => {
  test('a TECHNOLOGY-classified scene and a CHALLENGE-classified scene with the same richness produce completely non-overlapping purpose labels', () => {
    const techPlan = planShotsForScene(scene({ id: 's0', title: 'x', type: 'risk', leadershipImportance: 'technology-friction', metrics: [{ label: 'a', value: '$1' }] }))
    const challengePlan = planShotsForScene(scene({ id: 's1', title: 'y', type: 'risk', leadershipImportance: 'risk', metrics: [{ label: 'a', value: '$1' }] }))
    assert.equal(techPlan.treatment, 'TECHNOLOGY')
    assert.equal(challengePlan.treatment, 'CHALLENGE')
    const techPurposes = new Set(techPlan.shots.filter((s) => s.type === 'cinematic').map((s) => s.purpose))
    const challengePurposes = new Set(challengePlan.shots.filter((s) => s.type === 'cinematic').map((s) => s.purpose))
    for (const purpose of techPurposes) assert.equal(challengePurposes.has(purpose), false, `expected no overlap, but both used "${purpose}"`)
  })

  test('every treatment family (TECHNOLOGY/CHALLENGE/financial/REGIONAL_MAP/CINEMATIC_ENVIRONMENT) has its own non-overlapping purpose vocabulary', () => {
    const treatments: Array<[string, VideoStoryboardScene]> = [
      ['TECHNOLOGY', scene({ id: 't', title: 'x', type: 'risk', leadershipImportance: 'technology-friction' })],
      ['CHALLENGE', scene({ id: 'c', title: 'x', type: 'risk' })],
      ['HERO_METRIC', scene({ id: 'h', title: 'x', type: 'big-metric', metrics: [{ label: 'a', value: '$1' }] })],
      ['REGIONAL_MAP', scene({ id: 'r', title: 'x', type: 'highlights', bullets: ['A deal in Tennessee'] })],
      ['CINEMATIC_ENVIRONMENT', scene({ id: 'e', title: 'x', type: 'highlights' })],
    ]
    const purposeSets = treatments.map(([, s]) => new Set(planShotsForScene(s).shots.filter((sh) => sh.type === 'cinematic').map((sh) => sh.purpose)))
    for (let i = 0; i < purposeSets.length; i++) {
      for (let j = i + 1; j < purposeSets.length; j++) {
        const overlap = [...purposeSets[i]].filter((p) => purposeSets[j].has(p))
        assert.deepEqual(overlap, [], `expected ${treatments[i][0]} and ${treatments[j][0]} to share no purpose labels, got overlap: ${overlap}`)
      }
    }
  })
})

describe('generation asset vs. editorial shot/usage — reuse reduces paid generations without reducing visual beats', () => {
  test('a 2-cinematic-shot scene: shot 2 reuses shot 1\'s generationAssetId, requiresGeneration=false, and carries a reuseNote', () => {
    const plan = planShotsForScene(scene({ id: 's0', title: 'x', type: 'highlights' }))
    const [shot1, shot2] = plan.shots.filter((s) => s.type === 'cinematic')
    assert.equal(shot1.requiresGeneration, true)
    assert.equal(shot2.requiresGeneration, false)
    assert.equal(shot1.generationAssetId, shot2.generationAssetId)
    assert.ok(shot2.reuseNote)
  })

  test('a 3-cinematic-shot (rich) scene: shot 3 gets its OWN new generationAssetId and requiresGeneration=true — reuse never extends to a genuinely different action', () => {
    const plan = planShotsForScene(
      scene({ id: 's0', title: 'x', type: 'multi-metric', metrics: [{ label: 'a', value: '$1' }, { label: 'b', value: '$2' }], bullets: ['c'] }),
    )
    const cinematic = plan.shots.filter((s) => s.type === 'cinematic')
    assert.equal(cinematic.length, 3)
    assert.equal(cinematic[2].requiresGeneration, true)
    assert.notEqual(cinematic[2].generationAssetId, cinematic[0].generationAssetId)
  })

  test('reuse genuinely reduces the paid clip count below the total cinematic shot count', () => {
    const plans = planShotsForStoryboard([
      scene({ id: 's0', title: 'bare', type: 'highlights' }),
      scene({ id: 's1', title: 'bare2', type: 'status' }),
    ])
    const totalCinematicShots = plans.flatMap((p) => p.shots).filter((s) => s.type === 'cinematic').length
    const estimate = summarizeGenerationNeeds(plans)
    assert.equal(totalCinematicShots, 4) // 2 scenes x 2 cinematic shots each
    assert.equal(estimate.newClipsRequired, 2) // only 1 new asset per scene, reused for the 2nd shot
    assert.ok(estimate.newClipsRequired < totalCinematicShots)
  })
})

describe('cost calculation is deterministic', () => {
  test('estimateGenerationCostUsd is a pure function of seconds — same input always produces the same output', () => {
    assert.equal(estimateGenerationCostUsd(25), estimateGenerationCostUsd(25))
    assert.equal(estimateGenerationCostUsd(25), 25 * COST_PER_GENERATED_SECOND_USD)
  })

  test('summarizeGenerationNeeds only counts shots with requiresGeneration true, and sums their generationDurationSeconds', () => {
    const plans = planShotsForStoryboard([
      scene({ id: 's0', title: 'open', type: 'opening' }),
      scene({ id: 's1', title: 'rich', type: 'multi-metric', metrics: [{ label: 'a', value: '$1' }, { label: 'b', value: '$2' }], bullets: ['c'] }),
    ])
    const estimate = summarizeGenerationNeeds(plans)
    const expectedClips = plans.flatMap((p) => p.shots).filter((s) => s.requiresGeneration).length
    assert.equal(estimate.newClipsRequired, expectedClips)
    assert.equal(estimate.estimatedCostUsd, estimateGenerationCostUsd(estimate.totalGeneratedSeconds))
  })

  test('running the same plan twice produces byte-identical estimates (no randomness/seed anywhere in the planner)', () => {
    const scenes = [scene({ id: 's0', title: 'x', type: 'multi-metric', metrics: [{ label: 'a', value: '$1' }, { label: 'b', value: '$2' }] })]
    const first = summarizeGenerationNeeds(planShotsForStoryboard(scenes))
    const second = summarizeGenerationNeeds(planShotsForStoryboard(scenes))
    assert.deepEqual(first, second)
  })
})

describe('authoritative counting — every summary number is derived from the actual planned-shot collection, never hand-computed', () => {
  test('totalVisualBeats always equals cinematicUsages + motionBeats + brandedBeats', () => {
    const estimate = summarizeGenerationNeeds(planShotsForStoryboard(mixedStoryboard()))
    assert.equal(estimate.totalVisualBeats, estimate.cinematicUsages + estimate.motionBeats + estimate.brandedBeats)
    // Sanity check against a totally independent recount from the raw shots, not just internal self-consistency.
    const plans = planShotsForStoryboard(mixedStoryboard())
    const allShots = plans.flatMap((p) => p.shots)
    assert.equal(estimate.totalVisualBeats, allShots.length)
    assert.equal(estimate.cinematicUsages, allShots.filter((s) => s.type === 'cinematic').length)
    assert.equal(estimate.motionBeats, allShots.filter((s) => s.type === 'motion_graphic').length)
    assert.equal(estimate.brandedBeats, allShots.filter((s) => s.type === 'branded').length)
  })

  test('uniqueGenerationAssets is counted independently from cinematicUsages/newClipsRequired, is always <= cinematicUsages, and matches newClipsRequired as a cross-check', () => {
    const plans = planShotsForStoryboard(mixedStoryboard())
    const estimate = summarizeGenerationNeeds(plans)
    const allShots = plans.flatMap((p) => p.shots)

    // Independent recount: a Set over every shot's generationAssetId, computed here rather than trusting the function's own return value.
    const recountedAssetIds = new Set(allShots.map((s) => s.generationAssetId).filter((id): id is string => Boolean(id)))
    assert.equal(estimate.uniqueGenerationAssets, recountedAssetIds.size)

    // Reuse (s1/s2 each have a 2-shot cinematic pair sharing one asset) means strictly fewer unique assets than cinematic usages.
    assert.ok(estimate.uniqueGenerationAssets < estimate.cinematicUsages)
    assert.ok(estimate.uniqueGenerationAssets <= estimate.cinematicUsages)

    // newClipsRequired (requiresGeneration-true count) and uniqueGenerationAssets (Set-of-ids count) are two
    // independently-derived numbers that must agree, since exactly one shot per asset is the generating one.
    assert.equal(estimate.uniqueGenerationAssets, estimate.newClipsRequired)
  })

  test('branded-only storyboard (opening/closing) produces zero cinematic/motion beats and zero generation assets', () => {
    const estimate = summarizeGenerationNeeds(planShotsForStoryboard([scene({ id: 'open', title: 'Open', type: 'opening' }), scene({ id: 'close', title: 'Close', type: 'closing' })]))
    assert.equal(estimate.cinematicUsages, 0)
    assert.equal(estimate.motionBeats, 0)
    assert.equal(estimate.brandedBeats, 2)
    assert.equal(estimate.uniqueGenerationAssets, 0)
    assert.equal(estimate.totalVisualBeats, 2)
  })
})

describe('existing storyboards remain backward-compatible', () => {
  test('a scene with no metrics/bullets/visualPlan/leadershipImportance at all (a minimal pre-existing storyboard shape) still plans without throwing', () => {
    assert.doesNotThrow(() => planShotsForScene(scene({ id: 's0', title: 'A plain scene', type: 'status' })))
  })

  test('a scene that already carries cinematicAssets is still planned the same way (planning is independent of whether assets already exist)', () => {
    const withAssets = planShotsForScene(
      scene({ id: 's0', title: 'x', type: 'highlights', cinematicAssets: [{ assetPath: 'a.mp4', durationSeconds: 5 }] }),
    )
    const withoutAssets = planShotsForScene(scene({ id: 's1', title: 'x', type: 'highlights' }))
    assert.deepEqual(
      withAssets.shots.map((s) => s.type),
      withoutAssets.shots.map((s) => s.type),
    )
  })
})

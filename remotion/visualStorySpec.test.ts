// Run with: node --test remotion/visualStorySpec.test.ts
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { accentForSubject, cinematicTreatmentForScene, recipeForSubject, storyHeroAssets, storyMotifs, treatmentSeed } from './visualStorySpec.ts'
import type { VideoStoryboard, VideoStoryboardScene } from '../src/lib/videoStoryboard.ts'

function scene(overrides: Partial<VideoStoryboardScene> & Pick<VideoStoryboardScene, 'id' | 'title'>): VideoStoryboardScene {
  return { type: 'highlights', ...overrides }
}

function storyboard(scenes: VideoStoryboardScene[]): VideoStoryboard {
  return { title: 'WFG Weekly Leadership Update', weekEnding: 'Week Ending Jan 1, 2026', sourceType: 'weekly-summary', generationMethod: 'ai', scenes }
}

describe('accentForSubject — one restrained, contextual accent per subject, never an arbitrary/rainbow mapping', () => {
  test('value/comparison subjects map to gold', () => {
    assert.equal(accentForSubject('value-accumulation'), 'gold')
    assert.equal(accentForSubject('comparison-bars'), 'gold')
  })

  test('systems/connection subjects map to blue', () => {
    assert.equal(accentForSubject('systems-connection'), 'blue')
    assert.equal(accentForSubject('blocked-connection'), 'blue')
  })

  test('opportunity/trajectory/milestone/forward subjects map to sage', () => {
    for (const subject of ['opportunity-nodes', 'trajectory-path', 'milestone-landscape', 'forward-destinations'] as const) {
      assert.equal(accentForSubject(subject), 'sage')
    }
  })

  test('document-workflow, brand-mark, and an unrecognized/undefined subject all fall back to terracotta — the one accent already used elsewhere for friction/emphasis, never an ungrounded new color', () => {
    assert.equal(accentForSubject('document-workflow'), 'terracotta')
    assert.equal(accentForSubject('brand-mark'), 'terracotta')
    assert.equal(accentForSubject(undefined), 'terracotta')
  })
})

describe('recipeForSubject — picks one of four DISTINCT illustrated Remotion recipes, never a fifth generic one', () => {
  test('value/comparison subjects map to the "value" recipe', () => {
    assert.equal(recipeForSubject('value-accumulation'), 'value')
    assert.equal(recipeForSubject('comparison-bars'), 'value')
  })

  test('document-workflow maps to the "workflow" recipe', () => {
    assert.equal(recipeForSubject('document-workflow'), 'workflow')
  })

  test('systems/blocked-connection subjects map to the "systems" recipe', () => {
    assert.equal(recipeForSubject('systems-connection'), 'systems')
    assert.equal(recipeForSubject('blocked-connection'), 'systems')
  })

  test('opportunity/trajectory subjects map to the "growth" recipe', () => {
    assert.equal(recipeForSubject('opportunity-nodes'), 'growth')
    assert.equal(recipeForSubject('trajectory-path'), 'growth')
  })

  test('milestone-landscape, forward-destinations, brand-mark, and an undefined subject all have NO recipe — they keep the existing fallback rendering rather than being forced into one of the four', () => {
    assert.equal(recipeForSubject('milestone-landscape'), undefined)
    assert.equal(recipeForSubject('forward-destinations'), undefined)
    assert.equal(recipeForSubject('brand-mark'), undefined)
    assert.equal(recipeForSubject(undefined), undefined)
  })
})

describe('storyMotifs — a render-time-only scan of the ALREADY-APPROVED storyboard, never a new content decision', () => {
  test('returns one motif per distinct visualPlan.subject, in the storyboard\'s own scene order, brand-mark excluded', () => {
    const board = storyboard([
      scene({ id: 'opening', type: 'opening', title: 'WFG Weekly Leadership Update', visualPlan: { subject: 'brand-mark', emphasis: 'brand', composition: 'minimal-brand', motion: 'static-hold' } }),
      scene({ id: 'ai-scene-0', title: 'Quarter-End Push' }),
      scene({
        id: 'ai-scene-1',
        title: 'Quarter-End Remittance Performance',
        visualPlan: { subject: 'value-accumulation', emphasis: 'dominant-number', composition: 'illustration-with-metric', motion: 'accumulate' },
      }),
      scene({
        id: 'ai-scene-2',
        title: 'Application & Rate Calculator Systems Friction',
        visualPlan: { subject: 'blocked-connection', emphasis: 'process-flow', composition: 'illustration-with-metric', motion: 'flow-blocked' },
      }),
    ])
    assert.deepEqual(storyMotifs(board), [
      { subject: 'value-accumulation', accent: 'gold' },
      { subject: 'blocked-connection', accent: 'blue' },
    ])
  })

  test('a repeated subject across two scenes is only listed once', () => {
    const board = storyboard([
      scene({ id: 's0', title: 'A', visualPlan: { subject: 'document-workflow', emphasis: 'process-flow', composition: 'illustration-with-metric', motion: 'flow-blocked' } }),
      scene({ id: 's1', title: 'B', visualPlan: { subject: 'document-workflow', emphasis: 'process-flow', composition: 'illustration-with-metric', motion: 'flow-blocked' } }),
    ])
    assert.deepEqual(storyMotifs(board), [{ subject: 'document-workflow', accent: 'terracotta' }])
  })

  test('respects maxMotifs even when more distinct subjects exist — never an unbounded/overcrowded motif list', () => {
    const board = storyboard(
      (['value-accumulation', 'document-workflow', 'blocked-connection', 'opportunity-nodes', 'milestone-landscape'] as const).map((subject, i) =>
        scene({ id: `s${i}`, title: `Topic ${i}`, visualPlan: { subject, emphasis: 'process-flow', composition: 'illustration-with-metric', motion: 'flow-blocked' } }),
      ),
    )
    assert.equal(storyMotifs(board, 3).length, 3)
  })

  test('a storyboard with no scenes carrying a visualPlan (e.g. an entirely deterministic/neutral week) returns an empty motif list — never a fabricated placeholder motif', () => {
    const board = storyboard([scene({ id: 's0', title: 'A plain notable development' })])
    assert.deepEqual(storyMotifs(board), [])
  })
})

describe('storyHeroAssets — the visual-direction v3 callback list: only scenes that actually got a hero illustration generated, reused (never regenerated) by Opening/Executive Snapshot/Forward Look', () => {
  test('only scenes with fluxHeroAssetPath set are included, one per distinct subject, carrying that scene\'s own grounded title', () => {
    const board = storyboard([
      scene({
        id: 'ai-scene-0',
        title: 'Quarter-End Remittance Performance',
        visualPlan: { subject: 'value-accumulation', emphasis: 'dominant-number', composition: 'illustration-with-metric', motion: 'accumulate' },
        fluxHeroAssetPath: 'flux-assets/metric-story__value-accumulation__hero.png',
      }),
      scene({
        id: 'ai-scene-1',
        title: 'No Hero Yet',
        visualPlan: { subject: 'document-workflow', emphasis: 'process-flow', composition: 'illustration-with-metric', motion: 'flow-blocked' },
      }),
    ])
    const assets = storyHeroAssets(board)
    assert.equal(assets.length, 1)
    assert.equal(assets[0].subject, 'value-accumulation')
    assert.equal(assets[0].title, 'Quarter-End Remittance Performance')
    assert.equal(assets[0].heroAssetPath, 'flux-assets/metric-story__value-accumulation__hero.png')
    assert.equal(assets[0].accent, 'gold')
  })

  test('a week with no hero illustrations generated at all returns an empty list', () => {
    const board = storyboard([scene({ id: 's0', title: 'A plain notable development' })])
    assert.deepEqual(storyHeroAssets(board), [])
  })
})

describe('cinematicTreatmentForScene — the approved priority order: story meaning determines the scene, data enhances it', () => {
  test('scene.type opening/closing/forward-look always win, regardless of any other field', () => {
    assert.equal(cinematicTreatmentForScene(scene({ id: 's0', type: 'opening', title: 'x', metrics: [{ label: 'a', value: '$1' }] })), 'BRANDED_OPENING')
    assert.equal(cinematicTreatmentForScene(scene({ id: 's0', type: 'closing', title: 'x' })), 'BRANDED_CLOSING')
    assert.equal(cinematicTreatmentForScene(scene({ id: 's0', type: 'forward-look', title: 'x', leadershipImportance: 'risk' })), 'FORWARD_LOOKING')
  })

  test('a risk/operational-friction/blocker scene becomes CHALLENGE — but NOT when the reason is technology-friction (that is TECHNOLOGY\'s)', () => {
    assert.equal(cinematicTreatmentForScene(scene({ id: 's0', title: 'Title Production Risk', leadershipImportance: 'risk' })), 'CHALLENGE')
    assert.equal(cinematicTreatmentForScene(scene({ id: 's0', type: 'risk', title: 'x' })), 'CHALLENGE')
    assert.equal(cinematicTreatmentForScene(scene({ id: 's0', title: 'Systems Friction', leadershipImportance: 'technology-friction' })), 'TECHNOLOGY')
  })

  test('technology-friction or a systems/blocked-connection subject becomes TECHNOLOGY even with metrics present', () => {
    assert.equal(
      cinematicTreatmentForScene(
        scene({ id: 's0', title: 'x', leadershipImportance: 'technology-friction', metrics: [{ label: 'a', value: '$1' }, { label: 'b', value: '$2' }] }),
      ),
      'TECHNOLOGY',
    )
    assert.equal(
      cinematicTreatmentForScene(
        scene({ id: 's0', title: 'x', visualPlan: { subject: 'blocked-connection', emphasis: 'process-flow', composition: 'illustration-with-metric', motion: 'flow-blocked' } }),
      ),
      'TECHNOLOGY',
    )
  })

  test('a genuine grounded region mention becomes REGIONAL_MAP even with 2 metrics present ("a Florida growth scene containing two metrics should still be capable of becoming REGIONAL_MAP")', () => {
    const result = cinematicTreatmentForScene(
      scene({
        id: 's0',
        title: 'New Agent & Commercial Growth Pipeline',
        bullets: ['$18M TN deal secured'],
        metrics: [
          { label: 'a', value: '$1' },
          { label: 'b', value: '$2' },
        ],
      }),
    )
    assert.equal(result, 'REGIONAL_MAP')
  })

  test('2+ metrics with no stronger narrative treatment becomes DATA_STORY; exactly 1 becomes HERO_METRIC; 0 falls to CINEMATIC_ENVIRONMENT', () => {
    assert.equal(
      cinematicTreatmentForScene(scene({ id: 's0', title: 'x', metrics: [{ label: 'a', value: '$1' }, { label: 'b', value: '$2' }] })),
      'DATA_STORY',
    )
    assert.equal(cinematicTreatmentForScene(scene({ id: 's0', title: 'x', metrics: [{ label: 'a', value: '$1' }] })), 'HERO_METRIC')
    assert.equal(cinematicTreatmentForScene(scene({ id: 's0', title: 'x' })), 'CINEMATIC_ENVIRONMENT')
  })

  test('a challenge scene containing a metric still remains CHALLENGE ("a challenge scene containing a metric should remain CHALLENGE")', () => {
    assert.equal(
      cinematicTreatmentForScene(scene({ id: 's0', title: 'x', leadershipImportance: 'risk', metrics: [{ label: 'a', value: '$1' }, { label: 'b', value: '$2' }] })),
      'CHALLENGE',
    )
  })
})

describe('treatmentSeed — a stable, deterministic tie-breaker for visual variation within one treatment, never affecting content', () => {
  test('the same scene id always produces the same seed', () => {
    assert.equal(treatmentSeed('ai-scene-2'), treatmentSeed('ai-scene-2'))
  })

  test('different scene ids produce different seeds (in practice, for these real-world-shaped ids)', () => {
    const seeds = new Set(['ai-scene-0', 'ai-scene-1', 'ai-scene-2', 'ai-scene-3'].map(treatmentSeed))
    assert.equal(seeds.size, 4)
  })

  test('is always a non-negative integer', () => {
    assert.equal(Number.isInteger(treatmentSeed('anything')), true)
    assert.ok(treatmentSeed('anything') >= 0)
  })
})

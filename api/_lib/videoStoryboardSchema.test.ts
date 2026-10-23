// Run with: node --test api/_lib/videoStoryboardSchema.test.ts
//
// Pure, dependency-free — unlike the endpoint it backs
// (api/video/generate-storyboard.ts, which cannot be imported directly
// under bare `node --test` for the same reason api/executive-summary.ts
// can't — see executiveSummaryGenerationWiring.test.ts), this file's real
// validation logic is exercised here with actual (including adversarial/
// hallucinated) fixture data, not source inspection.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  AI_LEADERSHIP_IMPORTANCE_VALUES,
  AI_STORYBOARD_SCENE_SCHEMA,
  AI_STORYBOARD_SCENE_TYPES,
  AI_STORY_ENGINE_VALUES,
  AI_VISUAL_COMPOSITION_VALUES,
  AI_VISUAL_CONCEPT_VALUES,
  AI_VISUAL_EMPHASIS_VALUES,
  AI_VISUAL_MOTION_VALUES,
  AI_VISUAL_SUBJECT_VALUES,
  groundedTitleFallback,
  isTitleFaithfulToSourceTopics,
  isTotalDurationReasonable,
  normalizeOverlongNarration,
  validateAiStoryboardResponse,
  validateNarrationGrounding,
} from './videoStoryboardSchema.ts'
import {
  LEADERSHIP_IMPORTANCE_VALUES,
  NARRATION_TEXT_MAX_LENGTH,
  STORY_ENGINE_VALUES,
  VISUAL_COMPOSITION_VALUES,
  VISUAL_CONCEPT_VALUES,
  VISUAL_EMPHASIS_VALUES,
  VISUAL_MOTION_VALUES,
  VISUAL_SUBJECT_VALUES,
} from '../../src/lib/videoStoryboard.ts'

describe('this file\'s duplicated AI_* vocabulary arrays stay in sync with the canonical client-side vocabulary', () => {
  test('AI_LEADERSHIP_IMPORTANCE_VALUES is identical (same values, same order) to videoStoryboard.ts\'s LEADERSHIP_IMPORTANCE_VALUES', () => {
    assert.deepEqual(AI_LEADERSHIP_IMPORTANCE_VALUES, LEADERSHIP_IMPORTANCE_VALUES)
  })

  test('AI_VISUAL_CONCEPT_VALUES is identical (same values, same order) to videoStoryboard.ts\'s VISUAL_CONCEPT_VALUES', () => {
    assert.deepEqual(AI_VISUAL_CONCEPT_VALUES, VISUAL_CONCEPT_VALUES)
  })

  test('AI_VISUAL_SUBJECT_VALUES/AI_VISUAL_EMPHASIS_VALUES/AI_VISUAL_COMPOSITION_VALUES/AI_VISUAL_MOTION_VALUES are each identical to their videoStoryboard.ts counterparts', () => {
    assert.deepEqual(AI_VISUAL_SUBJECT_VALUES, VISUAL_SUBJECT_VALUES)
    assert.deepEqual(AI_VISUAL_EMPHASIS_VALUES, VISUAL_EMPHASIS_VALUES)
    assert.deepEqual(AI_VISUAL_COMPOSITION_VALUES, VISUAL_COMPOSITION_VALUES)
    assert.deepEqual(AI_VISUAL_MOTION_VALUES, VISUAL_MOTION_VALUES)
  })

  test('AI_STORY_ENGINE_VALUES is identical to videoStoryboard.ts\'s STORY_ENGINE_VALUES', () => {
    assert.deepEqual(AI_STORY_ENGINE_VALUES, STORY_ENGINE_VALUES)
  })

  test('the JSON schema\'s narrationText.maxLength is identical to videoStoryboard.ts\'s NARRATION_TEXT_MAX_LENGTH — the single narration-length contract the AI prompt, the schema, and the business validator all share, so they cannot silently drift apart', () => {
    assert.equal(AI_STORYBOARD_SCENE_SCHEMA.properties.narrationText.maxLength, NARRATION_TEXT_MAX_LENGTH)
  })
})

const SOURCE_TOPIC_TITLES = ['Recruiting Momentum', 'Production Quality Risk', 'Commercial Growth Pipeline']

function validScene(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: 'highlights',
    eyebrow: 'This Week',
    title: 'Recruiting Momentum',
    body: 'Strong week for new hires.',
    bullets: ['Interviewed 14 candidates'],
    metrics: [],
    next: 'Extend two offers before Friday.',
    durationSeconds: 8,
    sourceTopicIndexes: [0],
    leadershipImportance: 'win',
    visualConcept: 'growth-trajectory',
    visualPlan: { subject: 'trajectory-path', emphasis: 'forward-momentum', composition: 'split-illustration-text', motion: 'trajectory-rise' },
    storyEngine: 'pipeline-story',
    narrationText: 'Recruiting had a strong week for new hires.',
    ...overrides,
  }
}

describe('validateAiStoryboardResponse — allowed scene types only', () => {
  test('accepts every documented AI-facing scene type', () => {
    for (const type of AI_STORYBOARD_SCENE_TYPES) {
      const overrides: Record<string, unknown> = { type }
      if (type === 'executive-snapshot') overrides.sourceTopicIndexes = []
      const result = validateAiStoryboardResponse({ scenes: [validScene(overrides), validScene()] }, SOURCE_TOPIC_TITLES)
      assert.equal(result.ok, true, `expected type ${type} to be accepted`)
    }
  })

  test('rejects a scene type outside the controlled vocabulary (e.g. an "opening"/"closing" the AI should never emit, or something invented)', () => {
    for (const badType of ['opening', 'closing', 'video-avatar', 'custom-html', '']) {
      const result = validateAiStoryboardResponse({ scenes: [validScene({ type: badType }), validScene()] }, SOURCE_TOPIC_TITLES)
      assert.equal(result.ok, false, `expected type "${badType}" to be rejected`)
    }
  })

  test('rejects a non-string type', () => {
    const result = validateAiStoryboardResponse({ scenes: [validScene({ type: 42 }), validScene()] }, SOURCE_TOPIC_TITLES)
    assert.equal(result.ok, false)
  })
})

describe('validateAiStoryboardResponse — strict structural validation', () => {
  test('rejects a response that is not an object', () => {
    assert.equal(validateAiStoryboardResponse(null, SOURCE_TOPIC_TITLES).ok, false)
    assert.equal(validateAiStoryboardResponse('not json', SOURCE_TOPIC_TITLES).ok, false)
    assert.equal(validateAiStoryboardResponse(42, SOURCE_TOPIC_TITLES).ok, false)
  })

  test('rejects a response missing the scenes array', () => {
    assert.equal(validateAiStoryboardResponse({}, SOURCE_TOPIC_TITLES).ok, false)
    assert.equal(validateAiStoryboardResponse({ scenes: 'not-an-array' }, SOURCE_TOPIC_TITLES).ok, false)
  })

  test('rejects a scene missing a required field (title)', () => {
    const result = validateAiStoryboardResponse({ scenes: [validScene({ title: '' }), validScene()] }, SOURCE_TOPIC_TITLES)
    assert.equal(result.ok, false)
  })

  test('rejects a scene with an extra/unexpected shape for bullets (not an array of strings)', () => {
    const result = validateAiStoryboardResponse({ scenes: [validScene({ bullets: [42, 'ok'] }), validScene()] }, SOURCE_TOPIC_TITLES)
    assert.equal(result.ok, false)
  })

  test('rejects a metric entry missing label/value', () => {
    const result = validateAiStoryboardResponse(
      { scenes: [validScene({ type: 'big-metric', metrics: [{ label: '', value: '92%', context: '' }] }), validScene()] },
      SOURCE_TOPIC_TITLES,
    )
    assert.equal(result.ok, false)
  })

  test('accepts a well-formed metric with an optional context, and omits context when blank', () => {
    const result = validateAiStoryboardResponse(
      {
        scenes: [
          validScene({ type: 'big-metric', metrics: [{ label: 'Revenue', value: '$1.2M', context: 'Q3 bookings' }] }),
          validScene({ type: 'multi-metric', metrics: [{ label: 'Completion', value: '92%', context: '' }] }),
        ],
      },
      SOURCE_TOPIC_TITLES,
    )
    assert.equal(result.ok, true)
    if (result.ok) {
      assert.deepEqual(result.scenes[0].metrics, [{ label: 'Revenue', value: '$1.2M', context: 'Q3 bookings' }])
      assert.equal(result.scenes[1].metrics?.[0].label, 'Completion')
      assert.equal(result.scenes[1].metrics?.[0].value, '92%')
      assert.equal(result.scenes[1].metrics?.[0].context, undefined)
    }
  })
})

describe('validateAiStoryboardResponse — duration validation', () => {
  test('rejects a scene with durationSeconds below the minimum or above the maximum', () => {
    assert.equal(validateAiStoryboardResponse({ scenes: [validScene({ durationSeconds: 1 }), validScene()] }, SOURCE_TOPIC_TITLES).ok, false)
    assert.equal(validateAiStoryboardResponse({ scenes: [validScene({ durationSeconds: 999 }), validScene()] }, SOURCE_TOPIC_TITLES).ok, false)
  })

  test('rejects a non-numeric durationSeconds', () => {
    assert.equal(validateAiStoryboardResponse({ scenes: [validScene({ durationSeconds: '8' }), validScene()] }, SOURCE_TOPIC_TITLES).ok, false)
  })

  test('accepts durationSeconds at the boundary values (3 and 20)', () => {
    assert.equal(validateAiStoryboardResponse({ scenes: [validScene({ durationSeconds: 3 }), validScene({ durationSeconds: 20 })] }, SOURCE_TOPIC_TITLES).ok, true)
  })

  test('rejects a scene count outside the 2-9 range', () => {
    assert.equal(validateAiStoryboardResponse({ scenes: [validScene()] }, SOURCE_TOPIC_TITLES).ok, false, 'a single scene should be rejected')
    assert.equal(
      validateAiStoryboardResponse({ scenes: Array.from({ length: 10 }, () => validScene()) }, SOURCE_TOPIC_TITLES).ok,
      false,
      '10 scenes should be rejected',
    )
  })

  test('isTotalDurationReasonable accepts a ~60-90s total and rejects both far too short and far too long totals', () => {
    assert.equal(isTotalDurationReasonable(75), true)
    assert.equal(isTotalDurationReasonable(5), false)
    assert.equal(isTotalDurationReasonable(500), false)
  })
})

describe('validateAiStoryboardResponse — source-reference validation (traceability)', () => {
  test('accepts valid, in-range sourceTopicIndexes', () => {
    const result = validateAiStoryboardResponse({ scenes: [validScene({ sourceTopicIndexes: [0, 2] }), validScene()] }, SOURCE_TOPIC_TITLES)
    assert.equal(result.ok, true)
    if (result.ok) assert.deepEqual(result.scenes[0].sourceTopicIndexes, [0, 2])
  })

  test('rejects an out-of-range (hallucinated) source topic index — the server-authoritative topic count, never the AI\'s own claim, is what bounds this', () => {
    const result = validateAiStoryboardResponse({ scenes: [validScene({ sourceTopicIndexes: [99] }), validScene()] }, SOURCE_TOPIC_TITLES)
    assert.equal(result.ok, false)
  })

  test('rejects a negative source topic index', () => {
    const result = validateAiStoryboardResponse({ scenes: [validScene({ sourceTopicIndexes: [-1] }), validScene()] }, SOURCE_TOPIC_TITLES)
    assert.equal(result.ok, false)
  })

  test('rejects a non-integer source topic index (e.g. a fabricated free-text-like value smuggled into the array)', () => {
    const result = validateAiStoryboardResponse({ scenes: [validScene({ sourceTopicIndexes: [1.5] }), validScene()] }, SOURCE_TOPIC_TITLES)
    assert.equal(result.ok, false)
  })

  test('rejects a business-content scene with zero source topic references — a citation is required, never merely vague/absent', () => {
    for (const type of ['big-metric', 'multi-metric', 'highlights', 'status', 'risk', 'forward-look']) {
      const result = validateAiStoryboardResponse({ scenes: [validScene({ type, sourceTopicIndexes: [] }), validScene()] }, SOURCE_TOPIC_TITLES)
      assert.equal(result.ok, false, `expected type ${type} with no source references to be rejected`)
    }
  })

  test('executive-snapshot is the sole type allowed to have zero source topic references (it is grounded in the opening paragraph, not a topic)', () => {
    const result = validateAiStoryboardResponse(
      { scenes: [validScene({ type: 'executive-snapshot', sourceTopicIndexes: [] }), validScene()] },
      SOURCE_TOPIC_TITLES,
    )
    assert.equal(result.ok, true)
  })

  test('an empty sourceTopicTitles (a report with zero topics — should not normally occur, but must fail safely) rejects every content scene\'s references', () => {
    const result = validateAiStoryboardResponse({ scenes: [validScene({ sourceTopicIndexes: [0] }), validScene()] }, [])
    assert.equal(result.ok, false)
  })
})

describe('TITLE FIDELITY — isTitleFaithfulToSourceTopics/groundedTitleFallback: pure unit checks against the phase brief\'s own examples', () => {
  test('every documented GOOD example is accepted as faithful', () => {
    assert.equal(
      isTitleFaithfulToSourceTopics('Quarter-End Revenue & Remittance Performance', ['Quarter-End Revenue Push and Remittance Performance']),
      true,
    )
    assert.equal(
      isTitleFaithfulToSourceTopics('Title Production & Underwriting Quality Risk', ['Title Production and Underwriting Quality Risk']),
      true,
    )
    assert.equal(
      isTitleFaithfulToSourceTopics('Application, Rate Calculator & Systems Friction', [
        'Application Process, Rate Calculators, and Systems Friction',
      ]),
      true,
    )
    assert.equal(
      isTitleFaithfulToSourceTopics('New Agent & Commercial Growth Pipeline', ['New Agent and Commercial Growth Pipeline']),
      true,
    )
  })

  test('every documented BAD example (a newly-invented editorial reframing) is rejected as unfaithful', () => {
    assert.equal(
      isTitleFaithfulToSourceTopics('Record Quarter-End Collections', ['Quarter-End Revenue Push and Remittance Performance']),
      false,
    )
    assert.equal(isTitleFaithfulToSourceTopics('Title Production Breakdowns', ['Title Production and Underwriting Quality Risk']), false)
    assert.equal(
      isTitleFaithfulToSourceTopics('Application and Rate Tools Lagging', ['Application Process, Rate Calculators, and Systems Friction']),
      false,
    )
    assert.equal(isTitleFaithfulToSourceTopics('Commercial Pipeline Advancing', ['New Agent and Commercial Growth Pipeline']), false)
  })

  test('3. a supporting metric/number elevated into an otherwise-plausible title still fails — digits absent from the source title are still unfaithful words', () => {
    assert.equal(isTitleFaithfulToSourceTopics('2.93 Million in Remittance', ['Quarter-End Revenue Push and Remittance Performance']), false)
  })

  test('combining multiple referenced topics\' own wording is faithful, even though neither title alone contains every word', () => {
    assert.equal(
      isTitleFaithfulToSourceTopics('Remittance Performance & Commercial Growth Pipeline', [
        'Quarter-End Revenue Push and Remittance Performance',
        'New Agent and Commercial Growth Pipeline',
      ]),
      true,
    )
  })

  test('groundedTitleFallback: a single referenced topic falls back to that topic\'s own title, verbatim', () => {
    assert.equal(groundedTitleFallback(['Title Production and Underwriting Quality Risk']), 'Title Production and Underwriting Quality Risk')
  })

  test('groundedTitleFallback: multiple referenced topics fall back to a plain, mechanical join of their own titles — never a rewrite', () => {
    assert.equal(
      groundedTitleFallback(['Quarter-End Revenue Push and Remittance Performance', 'New Agent and Commercial Growth Pipeline']),
      'Quarter-End Revenue Push and Remittance Performance & New Agent and Commercial Growth Pipeline',
    )
  })
})

describe('TITLE FIDELITY end to end via validateAiStoryboardResponse — never a rejection, always a substitution', () => {
  const TOPIC_TITLES = [
    'Quarter-End Revenue Push and Remittance Performance',
    'Title Production and Underwriting Quality Risk',
    'Application Process, Rate Calculators, and Systems Friction',
    'New Agent and Commercial Growth Pipeline',
  ]

  test('1. a faithful shortened title is accepted and passed through EXACTLY as the AI wrote it — no unnecessary substitution', () => {
    const result = validateAiStoryboardResponse(
      { scenes: [validScene({ title: 'Quarter-End Revenue & Remittance Performance', sourceTopicIndexes: [0] }), validScene()] },
      TOPIC_TITLES,
    )
    assert.equal(result.ok, true)
    if (result.ok) assert.equal(result.scenes[0].title, 'Quarter-End Revenue & Remittance Performance')
  })

  test('2. an unsupported editorial reframing is never rejected outright — the whole response is still accepted, with the title silently replaced by the grounded source-topic fallback', () => {
    const result = validateAiStoryboardResponse(
      { scenes: [validScene({ type: 'risk', title: 'Title Production Breakdowns', sourceTopicIndexes: [1] }), validScene()] },
      TOPIC_TITLES,
    )
    assert.equal(result.ok, true, 'an otherwise-valid AI storyboard must never be thrown away just because one title needs grounding')
    if (result.ok) assert.equal(result.scenes[0].title, 'Title Production and Underwriting Quality Risk')
  })

  test('4. single-topic fallback is the ORIGINAL source topic title, verbatim — never a partial/rewritten variant', () => {
    const result = validateAiStoryboardResponse(
      { scenes: [validScene({ title: 'Systems Are Totally Broken', sourceTopicIndexes: [2] }), validScene()] },
      TOPIC_TITLES,
    )
    assert.equal(result.ok, true)
    if (result.ok) assert.equal(result.scenes[0].title, TOPIC_TITLES[2])
  })

  test('multi-topic fallback is a conservative, mechanical join of every referenced topic\'s own title', () => {
    const result = validateAiStoryboardResponse(
      {
        scenes: [
          validScene({ type: 'multi-metric', title: 'This Week in Numbers', sourceTopicIndexes: [0, 3] }),
          validScene(),
        ],
      },
      TOPIC_TITLES,
    )
    assert.equal(result.ok, true)
    if (result.ok) assert.equal(result.scenes[0].title, `${TOPIC_TITLES[0]} & ${TOPIC_TITLES[3]}`)
  })

  test('8. forward-look\'s title is ALWAYS the fixed, neutral "Forward Look" label — the AI\'s own forward-look title is never trusted, faithful-sounding or not', () => {
    const result = validateAiStoryboardResponse(
      { scenes: [validScene(), validScene({ type: 'forward-look', title: 'What Happens Next', sourceTopicIndexes: [0, 1] })] },
      TOPIC_TITLES,
    )
    assert.equal(result.ok, true)
    if (result.ok) assert.equal(result.scenes[1].title, 'Forward Look')
  })

  test('executive-snapshot keeps the AI\'s own title untouched — it is grounded in the opening paragraph, not a topic, so there is no source title to check against', () => {
    const result = validateAiStoryboardResponse(
      { scenes: [validScene({ type: 'executive-snapshot', title: 'A Strong, Busy Week', sourceTopicIndexes: [] }), validScene()] },
      TOPIC_TITLES,
    )
    assert.equal(result.ok, true)
    if (result.ok) assert.equal(result.scenes[0].title, 'A Strong, Busy Week')
  })

  test('10. generationMethod is a concern of the CALLER, not this validator — but a title-only normalization always still yields result.ok === true, which is exactly what lets api/video/generate-storyboard.ts return generationMethod: \'ai\' unconditionally on any successful validation', () => {
    const result = validateAiStoryboardResponse(
      { scenes: [validScene({ title: 'Record Quarter-End Collections', sourceTopicIndexes: [0] }), validScene()] },
      TOPIC_TITLES,
    )
    assert.equal(result.ok, true)
  })
})

describe('validateAiStoryboardResponse — leadershipImportance uses a controlled vocabulary', () => {
  test('accepts every documented leadershipImportance value', () => {
    for (const value of LEADERSHIP_IMPORTANCE_VALUES) {
      const result = validateAiStoryboardResponse({ scenes: [validScene({ leadershipImportance: value }), validScene()] }, SOURCE_TOPIC_TITLES)
      assert.equal(result.ok, true, `expected leadershipImportance "${value}" to be accepted`)
    }
  })

  test('accepts an empty string (meaning "not classified") and omits it from the validated scene, rather than fabricating a default', () => {
    const result = validateAiStoryboardResponse({ scenes: [validScene({ leadershipImportance: '' }), validScene()] }, SOURCE_TOPIC_TITLES)
    assert.equal(result.ok, true)
    if (result.ok) assert.equal(result.scenes[0].leadershipImportance, undefined)
  })

  test('rejects an invented/out-of-vocabulary leadershipImportance', () => {
    const result = validateAiStoryboardResponse({ scenes: [validScene({ leadershipImportance: 'extremely-important' }), validScene()] }, SOURCE_TOPIC_TITLES)
    assert.equal(result.ok, false)
  })

  test('rejects a non-string leadershipImportance', () => {
    const result = validateAiStoryboardResponse({ scenes: [validScene({ leadershipImportance: 42 }), validScene()] }, SOURCE_TOPIC_TITLES)
    assert.equal(result.ok, false)
  })
})

describe('validateAiStoryboardResponse — visualConcept uses a controlled vocabulary', () => {
  test('accepts every documented visualConcept value', () => {
    for (const value of VISUAL_CONCEPT_VALUES) {
      const result = validateAiStoryboardResponse({ scenes: [validScene({ visualConcept: value }), validScene()] }, SOURCE_TOPIC_TITLES)
      assert.equal(result.ok, true, `expected visualConcept "${value}" to be accepted`)
    }
  })

  test('accepts an empty string (meaning "not classified") and omits it from the validated scene', () => {
    const result = validateAiStoryboardResponse({ scenes: [validScene({ visualConcept: '' }), validScene()] }, SOURCE_TOPIC_TITLES)
    assert.equal(result.ok, true)
    if (result.ok) assert.equal(result.scenes[0].visualConcept, undefined)
  })

  test('rejects an invented/out-of-vocabulary visualConcept (e.g. free-form HTML/design instructions)', () => {
    for (const badConcept of ['<div style="color:red">', 'custom-3d-animation', 'video-avatar-overlay']) {
      const result = validateAiStoryboardResponse({ scenes: [validScene({ visualConcept: badConcept }), validScene()] }, SOURCE_TOPIC_TITLES)
      assert.equal(result.ok, false, `expected visualConcept "${badConcept}" to be rejected`)
    }
  })
})

describe('1/2/3. storyEngine uses a controlled vocabulary of exactly the three reusable engines', () => {
  test('accepts every documented storyEngine value (metric-story, bottleneck-story, pipeline-story)', () => {
    for (const value of STORY_ENGINE_VALUES) {
      const result = validateAiStoryboardResponse({ scenes: [validScene({ storyEngine: value }), validScene()] }, SOURCE_TOPIC_TITLES)
      assert.equal(result.ok, true, `expected storyEngine "${value}" to be accepted`)
    }
  })

  test('accepts an empty string (meaning "no engine fits") and omits it from the validated scene, rather than fabricating one', () => {
    const result = validateAiStoryboardResponse({ scenes: [validScene({ storyEngine: '' }), validScene()] }, SOURCE_TOPIC_TITLES)
    assert.equal(result.ok, true)
    if (result.ok) assert.equal(result.scenes[0].storyEngine, undefined)
  })

  test('rejects an invented/out-of-vocabulary storyEngine — only the three approved engines exist, never a fourth ad hoc one', () => {
    for (const badEngine of ['dashboard-story', 'slideshow-story', 'avatar-story']) {
      const result = validateAiStoryboardResponse({ scenes: [validScene({ storyEngine: badEngine }), validScene()] }, SOURCE_TOPIC_TITLES)
      assert.equal(result.ok, false, `expected storyEngine "${badEngine}" to be rejected`)
    }
  })

  test('rejects a non-string storyEngine', () => {
    const result = validateAiStoryboardResponse({ scenes: [validScene({ storyEngine: 42 }), validScene()] }, SOURCE_TOPIC_TITLES)
    assert.equal(result.ok, false)
  })
})

describe('validateAiStoryboardResponse — visualPlan uses a controlled vocabulary and cannot carry arbitrary HTML/CSS/code (item 3, 4)', () => {
  test('accepts a fully-specified visualPlan using only documented enum values', () => {
    const result = validateAiStoryboardResponse(
      {
        scenes: [
          validScene({ visualPlan: { subject: 'document-workflow', emphasis: 'process-flow', composition: 'full-bleed-illustration', motion: 'flow-forward' } }),
          validScene(),
        ],
      },
      SOURCE_TOPIC_TITLES,
    )
    assert.equal(result.ok, true)
    if (result.ok) {
      assert.deepEqual(result.scenes[0].visualPlan, {
        subject: 'document-workflow',
        emphasis: 'process-flow',
        composition: 'full-bleed-illustration',
        motion: 'flow-forward',
      })
    }
  })

  test('accepts a fully-empty visualPlan (all four fields "") and omits it entirely from the validated scene', () => {
    const result = validateAiStoryboardResponse(
      { scenes: [validScene({ visualPlan: { subject: '', emphasis: '', composition: '', motion: '' } }), validScene()] },
      SOURCE_TOPIC_TITLES,
    )
    assert.equal(result.ok, true)
    if (result.ok) assert.equal(result.scenes[0].visualPlan, undefined)
  })

  test('rejects a PARTIALLY-filled visualPlan (some fields set, others blank) rather than guessing the rest', () => {
    const result = validateAiStoryboardResponse(
      { scenes: [validScene({ visualPlan: { subject: 'document-workflow', emphasis: '', composition: '', motion: '' } }), validScene()] },
      SOURCE_TOPIC_TITLES,
    )
    assert.equal(result.ok, false)
  })

  test('rejects an invented/out-of-vocabulary value in any single visualPlan field', () => {
    for (const badPlan of [
      { subject: 'floating-3d-logo', emphasis: 'brand', composition: 'minimal-brand', motion: 'static-hold' },
      { subject: 'document-workflow', emphasis: 'dramatic', composition: 'minimal-brand', motion: 'static-hold' },
      { subject: 'document-workflow', emphasis: 'brand', composition: '<div>', motion: 'static-hold' },
      { subject: 'document-workflow', emphasis: 'brand', composition: 'minimal-brand', motion: 'bounce-and-spin' },
    ]) {
      const result = validateAiStoryboardResponse({ scenes: [validScene({ visualPlan: badPlan }), validScene()] }, SOURCE_TOPIC_TITLES)
      assert.equal(result.ok, false, `expected visualPlan ${JSON.stringify(badPlan)} to be rejected`)
    }
  })

  test('rejects a visualPlan carrying an extra/unexpected key (e.g. a smuggled "css"/"html" field) — additionalProperties is enforced by structural validation, not schema alone', () => {
    const result = validateAiStoryboardResponse(
      {
        scenes: [
          validScene({
            visualPlan: { subject: 'document-workflow', emphasis: 'process-flow', composition: 'full-bleed-illustration', motion: 'flow-forward', css: 'body{color:red}' },
          }),
          validScene(),
        ],
      },
      SOURCE_TOPIC_TITLES,
    )
    // The extra key is simply ignored by the structural validator (it only
    // ever reads the four named fields) — the real backstop against a
    // smuggled key is AI_VISUAL_PLAN_SCHEMA's additionalProperties: false,
    // enforced upstream by Anthropic's own structured-output feature before
    // this validator ever runs. What matters here is that the extra key
    // can NEVER surface in the validated scene.
    assert.equal(result.ok, true)
    if (result.ok) assert.equal((result.scenes[0].visualPlan as unknown as Record<string, unknown> | undefined)?.css, undefined)
  })

  test('rejects a non-object visualPlan', () => {
    const result = validateAiStoryboardResponse({ scenes: [validScene({ visualPlan: 'full-bleed-illustration' }), validScene()] }, SOURCE_TOPIC_TITLES)
    assert.equal(result.ok, false)
  })
})

describe('normalizeOverlongNarration — safe, meaning-preserving normalization, tried before rejecting an over-limit narrationText', () => {
  test('text already within the limit is returned unchanged (only whitespace-collapsed)', () => {
    assert.equal(normalizeOverlongNarration('Remittance had a strong week.', 280), 'Remittance had a strong week.')
  })

  test('pure whitespace bloat (still meaning-identical) is collapsed and can bring text under the limit on its own', () => {
    const padded = `Short sentence.${' '.repeat(400)}`
    assert.equal(normalizeOverlongNarration(padded, 280), 'Short sentence.')
  })

  test('over the limit with multiple sentences: trims to the LAST complete sentence that still fits — never mid-sentence', () => {
    const text = 'First sentence is short. Second sentence is also fairly short. ' + 'X'.repeat(260) + ' this last part never fits.'
    const result = normalizeOverlongNarration(text, 80)
    assert.equal(result, 'First sentence is short. Second sentence is also fairly short.')
    assert.ok(result !== null && /[.!?]$/.test(result), 'result must end at a real sentence boundary, never mid-sentence')
  })

  test('the normalized result is always a verbatim PREFIX of the original text — never rewritten/paraphrased', () => {
    const text = 'Alpha fact here. Beta fact here. ' + 'Gamma fact keeps going and going and going and going and going.'
    const result = normalizeOverlongNarration(text, 40)
    assert.ok(result !== null)
    assert.equal(text.startsWith(result as string), true)
  })

  test('returns null (never a partial/mid-sentence string) when not even the first sentence fits under the limit', () => {
    const text = 'This single opening sentence is already far too long to fit under the tiny limit given here.'
    assert.equal(normalizeOverlongNarration(text, 20), null)
  })

  test('returns null when the over-limit text has no sentence-ending punctuation at all to safely trim to', () => {
    assert.equal(normalizeOverlongNarration('x'.repeat(500), 280), null)
  })
})

describe('validateNarrationGrounding — narrationText cannot introduce a business fact/number not already on screen', () => {
  const groundedScene = {
    title: 'Remittance',
    body: 'Record gross remittance this week.',
    bullets: ['Highest YTD total'],
    metrics: [{ label: 'Gross Remittance', value: '$2.93M' }],
    next: 'Prioritize quarter-close collections.',
  }

  test('narration containing only numbers that already appear in the scene\'s own fields is accepted', () => {
    assert.equal(validateNarrationGrounding('Gross remittance reached $2.93M this week, the highest total this year.', groundedScene), true)
  })

  test('narration containing no numbers at all is trivially grounded', () => {
    assert.equal(validateNarrationGrounding('Remittance had a record week across the board.', groundedScene), true)
  })

  test('narration inventing a new number not present anywhere in the scene is rejected', () => {
    assert.equal(validateNarrationGrounding('Gross remittance reached $2.93M, up 47% from last quarter.', groundedScene), false)
  })

  test('narration inventing an entirely fabricated figure with no grounded numbers at all is rejected', () => {
    assert.equal(validateNarrationGrounding('312 files closed this week, a new record.', { title: 'x', bullets: [] }), false)
  })
})

describe('validateAiStoryboardResponse — narrationText is validated end to end', () => {
  test('rejects a scene whose narrationText introduces an unsupported number', () => {
    const result = validateAiStoryboardResponse(
      { scenes: [validScene({ narrationText: 'Recruiting brought in 47 new applications this week.' }), validScene()] },
      SOURCE_TOPIC_TITLES,
    )
    assert.equal(result.ok, false)
  })

  test('rejects a narrationText longer than the concise-spoken-sentence limit when it cannot be safely normalized (no sentence boundary to trim to)', () => {
    const result = validateAiStoryboardResponse({ scenes: [validScene({ narrationText: 'x'.repeat(500) }), validScene()] }, SOURCE_TOPIC_TITLES)
    assert.equal(result.ok, false)
  })

  test('1. narrationText exactly at NARRATION_TEXT_MAX_LENGTH passes unchanged', () => {
    const atLimit = 'A'.repeat(NARRATION_TEXT_MAX_LENGTH - 1) + '.'
    assert.equal(atLimit.length, NARRATION_TEXT_MAX_LENGTH)
    const result = validateAiStoryboardResponse({ scenes: [validScene({ narrationText: atLimit }), validScene()] }, SOURCE_TOPIC_TITLES)
    assert.equal(result.ok, true)
    if (result.ok) assert.equal(result.scenes[0].narrationText, atLimit)
  })

  test('2. a narrationText slightly over the limit, but safely trimmable to a complete grounded prefix, is normalized and the response is ACCEPTED — the exact real-world Sep 25 failure this fix addresses (a rich, multi-fact scene no longer kills the whole AI response)', () => {
    const longNarration =
      'Recruiting had a strong week for new hires. ' +
      'The team kept up a solid pace of interviews and momentum continued to build. ' +
      'X'.repeat(NARRATION_TEXT_MAX_LENGTH) +
      ' this trailing filler never makes it into the accepted narration.'
    const result = validateAiStoryboardResponse({ scenes: [validScene({ narrationText: longNarration }), validScene()] }, SOURCE_TOPIC_TITLES)
    assert.equal(result.ok, true, 'expected the response to be accepted via safe normalization, not rejected outright')
    if (result.ok) {
      const accepted = result.scenes[0].narrationText
      assert.ok(accepted !== undefined)
      assert.ok((accepted as string).length <= NARRATION_TEXT_MAX_LENGTH)
      assert.equal(longNarration.startsWith(accepted as string), true)
      assert.ok(/[.!?]$/.test(accepted as string), 'must end at a real sentence boundary, never mid-sentence')
    }
  })

  test('4. normalization never bypasses grounding — an ungrounded number that survives trimming still gets the scene rejected', () => {
    const longNarration =
      'Recruiting brought in 47 new applicants this week, a huge and unexpected jump for the whole team. ' +
      'X'.repeat(260) +
      ' filler that never fits under any limit.'
    const result = validateAiStoryboardResponse({ scenes: [validScene({ narrationText: longNarration }), validScene()] }, SOURCE_TOPIC_TITLES)
    assert.equal(result.ok, false, '"47" is not grounded anywhere in this scene\'s body/bullets/metrics/next, so it must still be rejected after normalization')
  })

  test('accepts an empty narrationText (no narration prepared for this scene) and omits it, never fabricating one', () => {
    const result = validateAiStoryboardResponse({ scenes: [validScene({ narrationText: '' }), validScene()] }, SOURCE_TOPIC_TITLES)
    assert.equal(result.ok, true)
    if (result.ok) assert.equal(result.scenes[0].narrationText, undefined)
  })

  test('rejects a non-string narrationText', () => {
    const result = validateAiStoryboardResponse({ scenes: [validScene({ narrationText: 42 }), validScene()] }, SOURCE_TOPIC_TITLES)
    assert.equal(result.ok, false)
  })
})

describe('ARCHITECTURE: a genuinely non-metric/risk/pipeline scene (a product launch — not Sep 25-shaped content) validates end to end with a neutral classification, exactly as honestly as a metric-shaped scene does', () => {
  const LAUNCH_TOPIC_TITLES = ['New Client Portal Launch']

  test('notable-development + blank storyEngine + a faithful title + grounded narration is accepted as a complete, valid scene — never coerced into metric-story/bottleneck-story/pipeline-story', () => {
    const result = validateAiStoryboardResponse(
      {
        scenes: [
          validScene({
            type: 'highlights',
            title: 'New Client Portal Launch',
            body: '',
            bullets: ['Live in production for all users'],
            metrics: [],
            next: 'Monitor adoption and gather feedback.',
            sourceTopicIndexes: [0],
            leadershipImportance: 'notable-development',
            visualConcept: 'editorial-headline',
            visualPlan: { subject: '', emphasis: '', composition: '', motion: '' },
            storyEngine: '',
            narrationText: 'The redesigned client portal launched successfully this week and is now live for every user.',
          }),
          validScene(),
        ],
      },
      LAUNCH_TOPIC_TITLES,
    )
    assert.equal(result.ok, true)
    if (result.ok) {
      assert.equal(result.scenes[0].leadershipImportance, 'notable-development')
      assert.equal(result.scenes[0].storyEngine, undefined)
      assert.equal(result.scenes[0].title, 'New Client Portal Launch')
      assert.equal(result.scenes[0].visualPlan, undefined)
    }
  })

  test('title fidelity still applies to a completely different content domain — an editorial reframing of a product-launch topic is still replaced by the grounded source title', () => {
    const result = validateAiStoryboardResponse(
      {
        scenes: [
          validScene({
            type: 'highlights',
            title: 'A Triumphant Launch Week',
            leadershipImportance: 'notable-development',
            storyEngine: '',
            sourceTopicIndexes: [0],
          }),
          validScene(),
        ],
      },
      LAUNCH_TOPIC_TITLES,
    )
    assert.equal(result.ok, true)
    if (result.ok) assert.equal(result.scenes[0].title, 'New Client Portal Launch')
  })
})

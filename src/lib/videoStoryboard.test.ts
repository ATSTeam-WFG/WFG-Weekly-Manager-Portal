// Run with: node --test src/lib/videoStoryboard.test.ts
//
// buildStoryboardFromAtsReport is a pure function (no Supabase, no AI, no
// DOM) — unlike almost every other test in this project, this one can
// import and actually EXECUTE the real implementation rather than relying
// on source inspection.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildStoryboardFromAtsReport,
  estimateStoryboardDurationSeconds,
  expectedFixedNarrationText,
  FIXED_CLOSING_NARRATION_TEXT,
  FIXED_OPENING_NARRATION_TEXT,
  formatDurationLabel,
  hasReadyTalkingPresenter,
  inferStoryEngine,
  LEADERSHIP_IMPORTANCE_LABELS,
  LEADERSHIP_IMPORTANCE_VALUES,
  sceneBulletsToText,
  sceneMetricsToText,
  STORY_ENGINE_LABELS,
  STORY_ENGINE_VALUES,
  textToSceneBullets,
  textToSceneMetrics,
  VISUAL_COMPOSITION_VALUES,
  VISUAL_CONCEPT_LABELS,
  VISUAL_CONCEPT_VALUES,
  VISUAL_EMPHASIS_VALUES,
  VISUAL_MOTION_VALUES,
  VISUAL_SUBJECT_LABELS,
  VISUAL_SUBJECT_VALUES,
  type VideoStoryboard,
} from './videoStoryboard.ts'
import type { AtsReport } from './atsReport.ts'

const BASE_REPORT: AtsReport = {
  openingParagraph: 'Overall performance held steady this week across every region.',
  topics: [
    {
      title: 'Recruiting',
      statusSummary: 'On track against plan.',
      bullets: ['Interviewed 14 candidates', 'Revenue: $1.2M', 'Completion rate: 92%'],
      next: 'Extend two offers before Friday.',
    },
    {
      title: 'Retention',
      statusSummary: 'Slightly behind expectations.',
      bullets: ['Two agents flagged at-risk'],
      next: '',
    },
    {
      title: 'Training',
      statusSummary: 'No bullets or next this week.',
      bullets: [],
      next: '',
    },
  ],
}

describe('buildStoryboardFromAtsReport — opening/closing are always present', () => {
  test('the first scene is always the opening scene', () => {
    const storyboard = buildStoryboardFromAtsReport(BASE_REPORT, 'Week Ending Sep 26, 2026', 'weekly-summary')
    assert.equal(storyboard.scenes[0].id, 'opening')
    assert.equal(storyboard.scenes[0].type, 'opening')
    assert.equal(storyboard.scenes[0].body, 'Week Ending Sep 26, 2026')
  })

  test('6/7. the opening title is always the fixed "WFG Weekly Leadership Update" with the actual selected week-ending date as its body — never AI-invented, since generate-storyboard.ts always uses THIS scene (deterministic.scenes[0]) for the opening framing scene regardless of AI success/failure', () => {
    const storyboard = buildStoryboardFromAtsReport(BASE_REPORT, 'Week Ending Oct 3, 2026', 'weekly-summary')
    assert.equal(storyboard.scenes[0].title, 'WFG Weekly Leadership Update')
    assert.equal(storyboard.scenes[0].body, 'Week Ending Oct 3, 2026')
  })

  test('the last scene is always the closing scene, using the app\'s existing WFG tagline verbatim', () => {
    const storyboard = buildStoryboardFromAtsReport(BASE_REPORT, 'Week Ending Sep 26, 2026', 'weekly-summary')
    const last = storyboard.scenes[storyboard.scenes.length - 1]
    assert.equal(last.id, 'closing')
    assert.equal(last.type, 'closing')
    assert.equal(last.body, 'Together We Close More.')
  })

  test('title/weekEnding/sourceType are set from the caller-supplied params, not invented', () => {
    const storyboard = buildStoryboardFromAtsReport(BASE_REPORT, 'Week Ending Sep 26, 2026', 'leadership-report')
    assert.equal(storyboard.weekEnding, 'Week Ending Sep 26, 2026')
    assert.equal(storyboard.sourceType, 'leadership-report')
  })

  test('generationMethod is always \'deterministic\' for this transform', () => {
    const storyboard = buildStoryboardFromAtsReport(BASE_REPORT, 'Week Ending Sep 26, 2026', 'weekly-summary')
    assert.equal(storyboard.generationMethod, 'deterministic')
  })

  test('every scene carries a durationSeconds within the sane 3-15s bound', () => {
    const storyboard = buildStoryboardFromAtsReport(BASE_REPORT, 'Week Ending Sep 26, 2026', 'weekly-summary')
    for (const scene of storyboard.scenes) {
      assert.equal(typeof scene.durationSeconds, 'number')
      assert.ok(scene.durationSeconds! >= 3 && scene.durationSeconds! <= 15)
    }
  })
})

describe('buildStoryboardFromAtsReport — executive snapshot is conditional on real content', () => {
  test('an executive-snapshot scene is included, using the opening paragraph verbatim, when non-empty', () => {
    const storyboard = buildStoryboardFromAtsReport(BASE_REPORT, 'Week Ending Sep 26, 2026', 'weekly-summary')
    const snapshot = storyboard.scenes.find((s) => s.type === 'executive-snapshot')
    assert.ok(snapshot)
    assert.equal(snapshot.body, BASE_REPORT.openingParagraph)
  })

  test('a long opening paragraph with no sentence breaks preserves on-screen content, and is narrated truncated (never silently dropped) within the narration limit', () => {
    const longParagraph = 'A'.repeat(421)
    const report: AtsReport = {
      ...BASE_REPORT,
      openingParagraph: longParagraph,
    }

    const storyboard = buildStoryboardFromAtsReport(
      report,
      'Week Ending Oct 23, 2026',
      'weekly-summary',
    )

    const snapshot = storyboard.scenes.find(
      (scene) => scene.type === 'executive-snapshot',
    )

    assert.ok(snapshot)
    // The ON-SCREEN body is always the full paragraph, verbatim, regardless
    // of length — only the SPOKEN narration is ever bounded.
    assert.equal(snapshot.body, longParagraph)
    assert.equal(typeof snapshot.narrationText, 'string')
    assert.ok(snapshot.narrationText!.length <= 210)
    // No sentence-ending punctuation anywhere in the source means there is
    // no safe "complete sentence" boundary to stop at — the fallback is an
    // explicit, visible truncation (ending in an ellipsis), never a silent
    // mid-word cut with no indication anything was shortened.
    assert.ok(snapshot.narrationText!.endsWith('…'))
    assert.ok(longParagraph.startsWith(snapshot.narrationText!.slice(0, -1)))
  })

  test('a long opening paragraph made of real sentences is narrated as its own leading complete sentences, never a mid-sentence cut', () => {
    const sentences = [
      'Commercial transactions grew significantly across every region this week.',
      'Agency leadership credits the new referral program for most of the increase.',
      'Underwriting capacity remains the primary constraint on further growth.',
      'Recruiting pipeline activity stayed flat compared to the prior month.',
      'The technology team shipped two of the three planned platform updates.',
      'Client satisfaction scores held steady across every surveyed region.',
    ]
    const longParagraph = sentences.join(' ')
    const report: AtsReport = { ...BASE_REPORT, openingParagraph: longParagraph }

    const storyboard = buildStoryboardFromAtsReport(report, 'Week Ending Oct 23, 2026', 'weekly-summary')
    const snapshot = storyboard.scenes.find((scene) => scene.type === 'executive-snapshot')

    assert.ok(snapshot)
    assert.equal(snapshot.body, longParagraph)
    assert.ok(snapshot.narrationText)
    assert.ok(snapshot.narrationText!.length <= 210)
    // Every narrated sentence is a COMPLETE, verbatim sentence from the
    // source paragraph — the narration is a leading prefix of real
    // sentences, not a reflowed or reworded summary.
    assert.ok(longParagraph.startsWith(snapshot.narrationText!))
    assert.ok(/[.!?]$/.test(snapshot.narrationText!), 'narration should end on a complete sentence, not mid-sentence')
  })

  test('an opening paragraph that already fits is narrated verbatim, unchanged from before', () => {
    const storyboard = buildStoryboardFromAtsReport(BASE_REPORT, 'Week Ending Sep 26, 2026', 'weekly-summary')
    const snapshot = storyboard.scenes.find((scene) => scene.type === 'executive-snapshot')
    assert.ok(snapshot)
    assert.equal(snapshot.narrationText, BASE_REPORT.openingParagraph)
  })

  test('no executive-snapshot scene is fabricated when openingParagraph is empty/whitespace-only', () => {
    const report: AtsReport = { ...BASE_REPORT, openingParagraph: '   ' }
    const storyboard = buildStoryboardFromAtsReport(report, 'Week Ending Sep 26, 2026', 'weekly-summary')
    assert.equal(
      storyboard.scenes.some((s) => s.type === 'executive-snapshot'),
      false,
    )
  })
})

describe('buildStoryboardFromAtsReport — exactly one scene per source topic, no invented topics', () => {
  test('the number of topic-derived scenes equals report.topics.length, in the same order, with the exact source titles', () => {
    const storyboard = buildStoryboardFromAtsReport(BASE_REPORT, 'Week Ending Sep 26, 2026', 'weekly-summary')
    const topicScenes = storyboard.scenes.filter((s) => s.id.startsWith('topic-'))
    assert.equal(topicScenes.length, BASE_REPORT.topics.length)
    assert.deepEqual(
      topicScenes.map((s) => s.title),
      BASE_REPORT.topics.map((t) => t.title),
    )
  })

  test('status summary is preserved verbatim as the scene body', () => {
    const storyboard = buildStoryboardFromAtsReport(BASE_REPORT, 'Week Ending Sep 26, 2026', 'weekly-summary')
    const recruiting = storyboard.scenes.find((s) => s.title === 'Recruiting')
    assert.ok(recruiting)
    assert.equal(recruiting.body, 'On track against plan.')
  })

  test('next/action text is preserved verbatim when present, and omitted (not an empty string) when absent', () => {
    const storyboard = buildStoryboardFromAtsReport(BASE_REPORT, 'Week Ending Sep 26, 2026', 'weekly-summary')
    const recruiting = storyboard.scenes.find((s) => s.title === 'Recruiting')
    const retention = storyboard.scenes.find((s) => s.title === 'Retention')
    assert.equal(recruiting?.next, 'Extend two offers before Friday.')
    assert.equal(retention?.next, undefined)
  })

  test('a topic with neither bullets nor next produces a bare "status" scene — no fabricated bullets/metrics/next', () => {
    const storyboard = buildStoryboardFromAtsReport(BASE_REPORT, 'Week Ending Sep 26, 2026', 'weekly-summary')
    const training = storyboard.scenes.find((s) => s.title === 'Training')
    assert.ok(training)
    assert.equal(training.type, 'status')
    assert.equal(training.bullets, undefined)
    assert.equal(training.metrics, undefined)
    assert.equal(training.next, undefined)
  })

  test('each topic-derived scene carries sourceTopicIndexes pointing back to exactly its own topic', () => {
    const storyboard = buildStoryboardFromAtsReport(BASE_REPORT, 'Week Ending Sep 26, 2026', 'weekly-summary')
    BASE_REPORT.topics.forEach((topic, index) => {
      const scene = storyboard.scenes.find((s) => s.title === topic.title)
      assert.ok(scene)
      assert.deepEqual(scene.sourceTopicIndexes, [index])
    })
  })
})

describe('buildStoryboardFromAtsReport — deterministic metric extraction from existing bullet text only', () => {
  test('two "Label: value-with-a-digit" bullets become multi-metric, with label/value taken verbatim from the source', () => {
    const storyboard = buildStoryboardFromAtsReport(BASE_REPORT, 'Week Ending Sep 26, 2026', 'weekly-summary')
    const recruiting = storyboard.scenes.find((s) => s.title === 'Recruiting')
    assert.ok(recruiting)
    assert.equal(recruiting.type, 'multi-metric')
    assert.deepEqual(recruiting.metrics, [
      { label: 'Revenue', value: '$1.2M' },
      { label: 'Completion rate', value: '92%' },
    ])
  })

  test('exactly one metric-shaped bullet becomes big-metric', () => {
    const report: AtsReport = {
      openingParagraph: 'x',
      topics: [{ title: 'Solo Metric', statusSummary: 's', bullets: ['Revenue: $1.2M'], next: '' }],
    }
    const storyboard = buildStoryboardFromAtsReport(report, 'Week Ending Sep 26, 2026', 'weekly-summary')
    const scene = storyboard.scenes.find((s) => s.title === 'Solo Metric')
    assert.ok(scene)
    assert.equal(scene.type, 'big-metric')
    assert.deepEqual(scene.metrics, [{ label: 'Revenue', value: '$1.2M' }])
  })

  test('a plain prose bullet with a digit but no label:value shape is NOT misidentified as a metric', () => {
    const storyboard = buildStoryboardFromAtsReport(BASE_REPORT, 'Week Ending Sep 26, 2026', 'weekly-summary')
    const recruiting = storyboard.scenes.find((s) => s.title === 'Recruiting')
    assert.ok(recruiting)
    assert.deepEqual(recruiting.bullets, ['Interviewed 14 candidates'])
  })

  test('a topic with plain bullets and no metric-shaped bullets is "highlights", with bullets preserved verbatim', () => {
    const storyboard = buildStoryboardFromAtsReport(BASE_REPORT, 'Week Ending Sep 26, 2026', 'weekly-summary')
    const retention = storyboard.scenes.find((s) => s.title === 'Retention')
    assert.ok(retention)
    assert.equal(retention.type, 'highlights')
    assert.deepEqual(retention.bullets, ['Two agents flagged at-risk'])
    assert.equal(retention.metrics, undefined)
  })

  test('no new metric values are ever calculated/aggregated — every metric value is a substring of the original bullet', () => {
    const storyboard = buildStoryboardFromAtsReport(BASE_REPORT, 'Week Ending Sep 26, 2026', 'weekly-summary')
    const recruiting = storyboard.scenes.find((s) => s.title === 'Recruiting')
    for (const metric of recruiting?.metrics ?? []) {
      const sourceBullet = BASE_REPORT.topics[0].bullets.find((b) => b.includes(metric.label) && b.includes(metric.value))
      assert.ok(sourceBullet, `metric ${JSON.stringify(metric)} was not derived from an actual source bullet`)
    }
  })
})

describe('buildStoryboardFromAtsReport — forward-look is built only from existing Next/action text', () => {
  test('includes one bullet per topic with non-empty next, formatted as "Title: next", in topic order', () => {
    const storyboard = buildStoryboardFromAtsReport(BASE_REPORT, 'Week Ending Sep 26, 2026', 'weekly-summary')
    const forwardLook = storyboard.scenes.find((s) => s.type === 'forward-look')
    assert.ok(forwardLook)
    assert.deepEqual(forwardLook.bullets, ['Recruiting: Extend two offers before Friday.'])
  })

  test('no forward-look scene is fabricated when every topic has an empty next', () => {
    const report: AtsReport = {
      openingParagraph: 'x',
      topics: [{ title: 'A', statusSummary: 's', bullets: [], next: '' }],
    }
    const storyboard = buildStoryboardFromAtsReport(report, 'Week Ending Sep 26, 2026', 'weekly-summary')
    assert.equal(
      storyboard.scenes.some((s) => s.type === 'forward-look'),
      false,
    )
  })
})

describe('buildStoryboardFromAtsReport — the source report can never be mutated by the transform or by later editing the returned storyboard', () => {
  test('the function itself never reassigns into the source report/topics/bullets (a frozen deep clone survives the call unchanged)', () => {
    const frozenReport = structuredClone(BASE_REPORT)
    const deepFreeze = (obj: unknown): void => {
      if (obj && typeof obj === 'object') {
        Object.values(obj).forEach(deepFreeze)
        Object.freeze(obj)
      }
    }
    deepFreeze(frozenReport)
    assert.doesNotThrow(() => buildStoryboardFromAtsReport(frozenReport, 'Week Ending Sep 26, 2026', 'weekly-summary'))
  })

  test('mutating the returned storyboard\'s scenes/bullets afterward never changes the original report object', () => {
    const report: AtsReport = structuredClone(BASE_REPORT)
    const storyboard: VideoStoryboard = buildStoryboardFromAtsReport(report, 'Week Ending Sep 26, 2026', 'weekly-summary')
    const recruiting = storyboard.scenes.find((s) => s.title === 'Recruiting')
    assert.ok(recruiting?.metrics)
    // Mutate the storyboard's own arrays/objects directly.
    recruiting.title = 'MUTATED TITLE'
    recruiting.metrics![0].value = 'MUTATED VALUE'
    recruiting.bullets?.push('MUTATED BULLET')
    // The original source report must be completely unaffected.
    assert.equal(report.topics[0].title, 'Recruiting')
    assert.equal(report.topics[0].bullets.includes('MUTATED BULLET'), false)
    assert.equal(report.topics[0].bullets.some((b) => b.includes('MUTATED VALUE')), false)
  })
})

describe('LEADERSHIP_IMPORTANCE_LABELS / VISUAL_CONCEPT_LABELS — every controlled-vocabulary value has a human-readable label', () => {
  test('every LeadershipImportance value has a corresponding label', () => {
    for (const value of LEADERSHIP_IMPORTANCE_VALUES) {
      assert.equal(typeof LEADERSHIP_IMPORTANCE_LABELS[value], 'string')
      assert.ok(LEADERSHIP_IMPORTANCE_LABELS[value].length > 0)
    }
  })

  test('every VisualConcept value has a corresponding label', () => {
    for (const value of VISUAL_CONCEPT_VALUES) {
      assert.equal(typeof VISUAL_CONCEPT_LABELS[value], 'string')
      assert.ok(VISUAL_CONCEPT_LABELS[value].length > 0)
    }
  })
})

describe('VisualPlan controlled vocabularies — every value has a label, and the deterministic fallback stays structurally safe', () => {
  test('every VisualSubject value has a corresponding label', () => {
    for (const value of VISUAL_SUBJECT_VALUES) {
      assert.equal(typeof VISUAL_SUBJECT_LABELS[value], 'string')
      assert.ok(VISUAL_SUBJECT_LABELS[value].length > 0)
    }
  })

  test('every scene the deterministic transformer produces carries a full, valid visualPlan (subject/emphasis/composition/motion all from their controlled vocabularies)', () => {
    const storyboard = buildStoryboardFromAtsReport(BASE_REPORT, 'Week Ending Sep 26, 2026', 'weekly-summary')
    for (const scene of storyboard.scenes) {
      assert.ok(scene.visualPlan, `scene ${scene.id} (${scene.type}) is missing a visualPlan`)
      const plan = scene.visualPlan!
      assert.ok((VISUAL_SUBJECT_VALUES as readonly string[]).includes(plan.subject), `scene ${scene.id}'s visualPlan.subject "${plan.subject}" is invalid`)
      assert.ok((VISUAL_EMPHASIS_VALUES as readonly string[]).includes(plan.emphasis), `scene ${scene.id}'s visualPlan.emphasis "${plan.emphasis}" is invalid`)
      assert.ok(
        (VISUAL_COMPOSITION_VALUES as readonly string[]).includes(plan.composition),
        `scene ${scene.id}'s visualPlan.composition "${plan.composition}" is invalid`,
      )
      assert.ok((VISUAL_MOTION_VALUES as readonly string[]).includes(plan.motion), `scene ${scene.id}'s visualPlan.motion "${plan.motion}" is invalid`)
    }
  })
})

describe('buildStoryboardFromAtsReport — leadershipImportance/visualConcept: deterministic fallback stays safe (item 8)', () => {
  test('every scene the deterministic transformer produces carries a visualConcept from the controlled vocabulary', () => {
    const storyboard = buildStoryboardFromAtsReport(BASE_REPORT, 'Week Ending Sep 26, 2026', 'weekly-summary')
    for (const scene of storyboard.scenes) {
      assert.ok(scene.visualConcept, `scene ${scene.id} (${scene.type}) is missing a visualConcept`)
      assert.ok(
        (VISUAL_CONCEPT_VALUES as readonly string[]).includes(scene.visualConcept!),
        `scene ${scene.id}'s visualConcept "${scene.visualConcept}" is not in the controlled vocabulary`,
      )
    }
  })

  test('opening/closing/forward-look get a leadershipImportance (structurally always true), but ordinary topic-derived scenes deliberately get none — judging WHY something matters to leadership is a semantic call the deterministic path never attempts', () => {
    const storyboard = buildStoryboardFromAtsReport(BASE_REPORT, 'Week Ending Sep 26, 2026', 'weekly-summary')
    const opening = storyboard.scenes.find((s) => s.type === 'opening')
    const closing = storyboard.scenes.find((s) => s.type === 'closing')
    const forwardLook = storyboard.scenes.find((s) => s.type === 'forward-look')
    const recruiting = storyboard.scenes.find((s) => s.title === 'Recruiting')

    assert.equal(opening?.leadershipImportance, 'executive-context')
    assert.equal(closing?.leadershipImportance, 'executive-context')
    assert.equal(forwardLook?.leadershipImportance, 'next-priority')
    assert.equal(recruiting?.leadershipImportance, undefined)
  })

  test('the deterministic transformer narrates its own FIXED, app-owned copy for opening/closing, and the executive-snapshot paragraph read back verbatim', () => {
    const storyboard = buildStoryboardFromAtsReport(BASE_REPORT, 'Week Ending Sep 26, 2026', 'weekly-summary')
    const opening = storyboard.scenes.find((s) => s.type === 'opening')
    const closing = storyboard.scenes.find((s) => s.type === 'closing')
    const snapshot = storyboard.scenes.find((s) => s.type === 'executive-snapshot')

    assert.equal(typeof opening?.narrationText, 'string')
    assert.equal(closing?.narrationText, 'Together, we close more.')
    // The snapshot's narration is the SAME opening paragraph already shown
    // on screen, verbatim — never a second, independently-written summary.
    assert.equal(snapshot?.narrationText, snapshot?.body)
    assert.equal(snapshot?.narrationText, BASE_REPORT.openingParagraph)
  })

  test('every topic-derived and forward-look scene now gets REAL narration too — assembled only from that scene\'s own existing title/body/metrics/bullets/next, never a fresh written summary', () => {
    const storyboard = buildStoryboardFromAtsReport(BASE_REPORT, 'Week Ending Sep 26, 2026', 'weekly-summary')

    for (const scene of storyboard.scenes) {
      if (scene.type === 'opening' || scene.type === 'closing' || scene.type === 'executive-snapshot') continue
      assert.equal(typeof scene.narrationText, 'string', `scene ${scene.id} (${scene.type}) should have narration, not silence`)
      assert.ok(scene.narrationText!.length > 0)
      assert.ok(scene.narrationText!.length <= 210, `scene ${scene.id}'s narration exceeds the 210-char limit`)
    }
  })

  test('a topic scene\'s narration always starts with that topic\'s own title, verbatim, when the title is short enough to narrate in full', () => {
    const storyboard = buildStoryboardFromAtsReport(BASE_REPORT, 'Week Ending Sep 26, 2026', 'weekly-summary')
    const recruiting = storyboard.scenes.find((s) => s.title === 'Recruiting')
    const training = storyboard.scenes.find((s) => s.title === 'Training')
    assert.ok(recruiting?.narrationText?.startsWith('Recruiting.'))
    assert.ok(training?.narrationText?.startsWith('Training.'))
  })

  test('an unusually long topic title never crowds out the scene\'s actual content — the title is capped so real metrics/bullets/next still get narrated', () => {
    // A topic title has no length limit of its own (free text a manager
    // typed into the report); narrated in full it could otherwise consume
    // the entire 210-character budget by itself, before any real content
    // is ever reached.
    const longTitle =
      'Application Process, Rate Calculators, Jacket Generators, Systems Integration Friction, and New York Agent Retention Concerns Across All Regions This Quarter and Next'
    const report: AtsReport = {
      openingParagraph: 'x',
      topics: [
        {
          title: longTitle,
          statusSummary: 'This is the real, important, grounded status update that should be spoken.',
          bullets: ['Open tickets: 42'],
          next: 'Resolve the top three integration issues by Friday.',
        },
      ],
    }

    const storyboard = buildStoryboardFromAtsReport(report, 'Week Ending Oct 27, 2026', 'weekly-summary')
    const scene = storyboard.scenes.find((s) => s.id === 'topic-0')

    assert.ok(scene?.narrationText)
    assert.ok(scene.narrationText!.length <= 210)
    assert.ok(scene.narrationText!.includes('…'))
    // It still identifies the topic: narration starts with a real, whole-word
    // PREFIX of the actual title (never invented wording), visibly marked as
    // shortened — and that prefix is SHORTER than the full title, i.e. the
    // title was actually capped, not narrated verbatim.
    const titlePrefix = scene.narrationText!.slice(0, scene.narrationText!.indexOf('…'))
    assert.ok(titlePrefix.length > 0)
    assert.ok(titlePrefix.length < longTitle.length)
    assert.ok(longTitle.startsWith(titlePrefix))
    // Most importantly: the actual grounded content now survives alongside
    // the (shortened) title, instead of being silently crowded out.
    assert.ok(scene.narrationText!.includes('This is the real, important, grounded status update that should be spoken.'))
    assert.ok(scene.narrationText!.includes('Open tickets: 42'))
    assert.ok(scene.narrationText!.includes('Resolve the top three integration issues by Friday.'))
  })

  test('a topic title right at or just under the narration title cap is still narrated completely unchanged (no needless truncation)', () => {
    // 60 chars comfortably clears real short/medium titles without tripping
    // the ~63-char cap (30% of the 210-char narration limit).
    const normalTitle = 'Commercial Growth and New Agent Signings This Quarter'.slice(0, 60)
    const report: AtsReport = {
      openingParagraph: 'x',
      topics: [{ title: normalTitle, statusSummary: 'On track.', bullets: [], next: '' }],
    }
    const storyboard = buildStoryboardFromAtsReport(report, 'Week Ending Oct 27, 2026', 'weekly-summary')
    const scene = storyboard.scenes.find((s) => s.id === 'topic-0')
    assert.equal(scene?.narrationText, `${normalTitle}. On track.`)
    assert.ok(!scene!.narrationText!.includes('…'))
  })

  test('a topic scene\'s narration contains only text that is itself a substring of that topic\'s own title/statusSummary/bullets/next — never invented wording', () => {
    const storyboard = buildStoryboardFromAtsReport(BASE_REPORT, 'Week Ending Sep 26, 2026', 'weekly-summary')
    const recruiting = storyboard.scenes.find((s) => s.title === 'Recruiting')
    const sourceTopic = BASE_REPORT.topics[0]
    const sourceFragments = [sourceTopic.title, sourceTopic.statusSummary, sourceTopic.next, ...sourceTopic.bullets]

    assert.ok(recruiting?.narrationText)
    // Strip the sentence-ending punctuation this function adds, then every
    // remaining clause must be found verbatim somewhere in the topic's own
    // original fields.
    const clauses = recruiting.narrationText!.split('. ').map((clause) => clause.replace(/\.$/, ''))
    for (const clause of clauses) {
      assert.ok(
        sourceFragments.some((fragment) => fragment.includes(clause)),
        `narrated clause "${clause}" was not found verbatim in the source topic`,
      )
    }
  })

  test('a bare topic with only a title and statusSummary (no bullets, metrics, or next) still gets narration from exactly those two fields', () => {
    const training = buildStoryboardFromAtsReport(BASE_REPORT, 'Week Ending Sep 26, 2026', 'weekly-summary')
      .scenes.find((s) => s.title === 'Training')
    assert.equal(training?.narrationText, 'Training. No bullets or next this week.')
  })

  test('the forward-look scene is narrated from the exact same "Title: next" lines already shown as its own bullets', () => {
    const storyboard = buildStoryboardFromAtsReport(BASE_REPORT, 'Week Ending Sep 26, 2026', 'weekly-summary')
    const forwardLook = storyboard.scenes.find((s) => s.type === 'forward-look')
    assert.ok(forwardLook)
    assert.equal(forwardLook.narrationText, 'Recruiting: Extend two offers before Friday.')
    assert.deepEqual(forwardLook.bullets, ['Recruiting: Extend two offers before Friday.'])
  })

  test('a forward-look scene with more "Title: next" lines than fit in 210 characters narrates only as many COMPLETE lines as fit, never a partial line', () => {
    const report: AtsReport = {
      openingParagraph: 'x',
      topics: [
        { title: 'Commercial Growth Initiative', statusSummary: 's', bullets: [], next: 'Finalize the new referral agreement with our top three regional partners by end of week.' },
        { title: 'Underwriting Capacity Expansion', statusSummary: 's', bullets: [], next: 'Complete the second round of candidate interviews for the open underwriter roles.' },
        { title: 'Technology Platform Migration', statusSummary: 's', bullets: [], next: 'Finish migrating the remaining two regions onto the new reporting platform.' },
      ],
    }
    const storyboard = buildStoryboardFromAtsReport(report, 'Week Ending Oct 23, 2026', 'weekly-summary')
    const forwardLook = storyboard.scenes.find((s) => s.type === 'forward-look')

    assert.ok(forwardLook)
    assert.ok(forwardLook.narrationText!.length <= 210)
    // Every included line is a COMPLETE, exact bullet — never a truncated
    // fragment of one of them.
    const includedBullets = (forwardLook.bullets ?? []).filter((bullet) => forwardLook.narrationText!.includes(bullet))
    assert.ok(includedBullets.length >= 1)
    assert.ok(includedBullets.length < (forwardLook.bullets?.length ?? 0), 'expected the fixture to exceed 210 chars and leave at least one line out')
  })

  test('the deterministic transformer never produces a \'risk\' scene type, so no DETERMINISTIC_VISUAL_CONCEPT_BY_SCENE_TYPE entry for it is required (an AI-generated risk scene always supplies its own visualConcept)', () => {
    const storyboard = buildStoryboardFromAtsReport(BASE_REPORT, 'Week Ending Sep 26, 2026', 'weekly-summary')
    assert.equal(
      storyboard.scenes.some((s) => s.type === 'risk'),
      false,
    )
  })
})

describe('inferStoryEngine — the shared, deterministic story-engine mapping (used by both the fallback transformer and generate-storyboard.ts)', () => {
  test('every STORY_ENGINE_VALUES member has a human-readable label', () => {
    for (const value of STORY_ENGINE_VALUES) {
      assert.equal(typeof STORY_ENGINE_LABELS[value], 'string')
      assert.ok(STORY_ENGINE_LABELS[value].length > 0)
    }
  })

  test('1. metric leadershipImportance values (performance, major-metric) map to metric-story', () => {
    assert.equal(inferStoryEngine({ sceneType: 'big-metric', leadershipImportance: 'performance', hasMetrics: true }), 'metric-story')
    assert.equal(inferStoryEngine({ sceneType: 'multi-metric', leadershipImportance: 'major-metric', hasMetrics: true }), 'metric-story')
  })

  test('2. risk/friction/blocker leadershipImportance values map to bottleneck-story', () => {
    for (const li of ['risk', 'operational-friction', 'technology-friction', 'blocker'] as const) {
      assert.equal(inferStoryEngine({ sceneType: 'risk', leadershipImportance: li, hasMetrics: false }), 'bottleneck-story', `expected ${li} -> bottleneck-story`)
    }
  })

  test('3. growth-pipeline/next-priority leadershipImportance values map to pipeline-story', () => {
    assert.equal(inferStoryEngine({ sceneType: 'highlights', leadershipImportance: 'growth-pipeline', hasMetrics: false }), 'pipeline-story')
    assert.equal(inferStoryEngine({ sceneType: 'status', leadershipImportance: 'next-priority', hasMetrics: false }), 'pipeline-story')
  })

  test('"win" breaks the tie using the scene\'s own metrics (a structural signal, never a second semantic judgment)', () => {
    assert.equal(inferStoryEngine({ sceneType: 'highlights', leadershipImportance: 'win', hasMetrics: true }), 'metric-story')
    assert.equal(inferStoryEngine({ sceneType: 'highlights', leadershipImportance: 'win', hasMetrics: false }), 'pipeline-story')
  })

  test('"executive-context"/"notable-development" never get a story engine, regardless of scene type — notable-development is precisely the content no available treatment fits', () => {
    assert.equal(inferStoryEngine({ sceneType: 'executive-snapshot', leadershipImportance: 'executive-context', hasMetrics: false }), undefined)
    assert.equal(inferStoryEngine({ sceneType: 'highlights', leadershipImportance: 'notable-development', hasMetrics: false }), undefined)
  })

  test('4. structural scene.type fallback is used when leadershipImportance is absent (the deterministic transformer\'s own path) — ONLY big-metric/multi-metric infer an engine from shape alone; risk/highlights/status are content-agnostic buckets and correctly get no engine without a real importance signal', () => {
    assert.equal(inferStoryEngine({ sceneType: 'big-metric', hasMetrics: true }), 'metric-story')
    assert.equal(inferStoryEngine({ sceneType: 'multi-metric', hasMetrics: true }), 'metric-story')
    assert.equal(inferStoryEngine({ sceneType: 'risk', hasMetrics: false }), undefined)
    assert.equal(inferStoryEngine({ sceneType: 'highlights', hasMetrics: false }), undefined)
    assert.equal(inferStoryEngine({ sceneType: 'status', hasMetrics: false }), undefined)
  })

  test('opening/executive-snapshot/forward-look/closing NEVER get a story engine, even with a leadershipImportance that would otherwise map to one — they keep their existing simpler editorial treatment', () => {
    for (const sceneType of ['opening', 'executive-snapshot', 'forward-look', 'closing'] as const) {
      assert.equal(inferStoryEngine({ sceneType, leadershipImportance: 'major-metric', hasMetrics: true }), undefined, `expected ${sceneType} to never get a story engine`)
    }
  })
})

describe('buildStoryboardFromAtsReport — storyEngine assignment (deterministic path)', () => {
  test('a multi-metric topic scene gets storyEngine "metric-story"', () => {
    const storyboard = buildStoryboardFromAtsReport(BASE_REPORT, 'Week Ending Sep 26, 2026', 'weekly-summary')
    const recruiting = storyboard.scenes.find((s) => s.title === 'Recruiting')
    assert.equal(recruiting?.type, 'multi-metric')
    assert.equal(recruiting?.storyEngine, 'metric-story')
  })

  test('a highlights topic scene gets NO storyEngine (undefined) from the deterministic path — "highlights" is a content-agnostic bucket that could be any future kind of update, so it is never assumed to be pipeline-shaped without real semantic signal; it still renders with its existing safe editorial treatment', () => {
    const storyboard = buildStoryboardFromAtsReport(BASE_REPORT, 'Week Ending Sep 26, 2026', 'weekly-summary')
    const retention = storyboard.scenes.find((s) => s.title === 'Retention')
    assert.equal(retention?.type, 'highlights')
    assert.equal(retention?.storyEngine, undefined)
  })

  test('a bare status topic scene gets NO storyEngine (undefined) from the deterministic path, for the same reason', () => {
    const storyboard = buildStoryboardFromAtsReport(BASE_REPORT, 'Week Ending Sep 26, 2026', 'weekly-summary')
    const training = storyboard.scenes.find((s) => s.title === 'Training')
    assert.equal(training?.type, 'status')
    assert.equal(training?.storyEngine, undefined)
  })

  test('opening/executive-snapshot/forward-look/closing never get a storyEngine from the deterministic path', () => {
    const storyboard = buildStoryboardFromAtsReport(BASE_REPORT, 'Week Ending Sep 26, 2026', 'weekly-summary')
    for (const scene of storyboard.scenes) {
      if (scene.type === 'opening' || scene.type === 'executive-snapshot' || scene.type === 'forward-look' || scene.type === 'closing') {
        assert.equal(scene.storyEngine, undefined, `expected ${scene.type} to have no storyEngine`)
      }
    }
  })
})

describe('estimateStoryboardDurationSeconds / formatDurationLabel — a rough UI estimate, never a source-derived fact', () => {
  test('duration scales with scene count but never drops below the floor', () => {
    const short: VideoStoryboard = { title: 't', weekEnding: 'w', sourceType: 'weekly-summary', generationMethod: 'deterministic', scenes: [] }
    const long: VideoStoryboard = {
      title: 't',
      weekEnding: 'w',
      sourceType: 'weekly-summary',
      generationMethod: 'deterministic',
      scenes: Array.from({ length: 10 }, (_, i) => ({ id: String(i), type: 'status' as const, title: 'x' })),
    }
    assert.ok(estimateStoryboardDurationSeconds(short) >= 20)
    assert.ok(estimateStoryboardDurationSeconds(long) > estimateStoryboardDurationSeconds(short))
  })

  test('when scenes carry their own durationSeconds, the total sums those exactly rather than using the flat per-scene default', () => {
    const storyboard: VideoStoryboard = {
      title: 't',
      weekEnding: 'w',
      sourceType: 'weekly-summary',
      generationMethod: 'ai',
      scenes: [
        { id: 'a', type: 'opening', title: 'x', durationSeconds: 5 },
        { id: 'b', type: 'status', title: 'x', durationSeconds: 8 },
        { id: 'c', type: 'closing', title: 'x', durationSeconds: 4 },
      ],
    }
    assert.equal(estimateStoryboardDurationSeconds(storyboard), 20)
  })

  test('formatDurationLabel renders an approximate m:ss label, prefixed with a tilde', () => {
    assert.equal(formatDurationLabel(65), '~1:05')
    assert.equal(formatDurationLabel(20), '~0:20')
  })
})

describe('hasReadyTalkingPresenter — a binary Ready/Not-Set signal, never a partial-progress one', () => {
  function storyboardWith(openingPath: string | undefined, closingPath: string | undefined): VideoStoryboard {
    return {
      title: 't',
      weekEnding: 'w',
      sourceType: 'weekly-summary',
      generationMethod: 'deterministic',
      scenes: [
        { id: 'opening', type: 'opening', title: 'x', avatarVideoAssetPath: openingPath },
        { id: 'topic-0', type: 'status', title: 'x' },
        { id: 'closing', type: 'closing', title: 'x', avatarVideoAssetPath: closingPath },
      ],
    }
  }

  test('false when neither scene has a clip (a standard video) — not treated as an error state', () => {
    assert.equal(hasReadyTalkingPresenter(storyboardWith(undefined, undefined)), false)
  })

  test('false when only ONE of opening/closing has a clip — half-prepared never reads as ready', () => {
    assert.equal(hasReadyTalkingPresenter(storyboardWith('avatar-video/opening.mp4', undefined)), false)
    assert.equal(hasReadyTalkingPresenter(storyboardWith(undefined, 'avatar-video/closing.mp4')), false)
  })

  test('true only when BOTH opening and closing have a clip attached', () => {
    assert.equal(hasReadyTalkingPresenter(storyboardWith('avatar-video/opening.mp4', 'avatar-video/closing.mp4')), true)
  })

  test('a storyboard with no opening/closing scenes at all is never falsely "ready"', () => {
    const storyboard: VideoStoryboard = { title: 't', weekEnding: 'w', sourceType: 'weekly-summary', generationMethod: 'deterministic', scenes: [{ id: 'topic-0', type: 'status', title: 'x' }] }
    assert.equal(hasReadyTalkingPresenter(storyboard), false)
  })
})

describe('expectedFixedNarrationText / FIXED_*_NARRATION_TEXT — the one reference restoreReadyPresenterClips can verify a clip against without a stored copy', () => {
  test('returns the exact text opening/closing are built with, for either scene type', () => {
    assert.equal(expectedFixedNarrationText('opening'), FIXED_OPENING_NARRATION_TEXT)
    assert.equal(expectedFixedNarrationText('closing'), FIXED_CLOSING_NARRATION_TEXT)
  })

  test('is undefined for every other scene type — the fixed-text guarantee only ever applied to opening/closing', () => {
    assert.equal(expectedFixedNarrationText('status'), undefined)
    assert.equal(expectedFixedNarrationText('highlights'), undefined)
    assert.equal(expectedFixedNarrationText('forward-look'), undefined)
  })

  test('buildStoryboardFromAtsReport\'s real opening/closing scenes actually use these exact constants, not independent copies that could drift', () => {
    const storyboard = buildStoryboardFromAtsReport(LIGHT_WEEK_REPORT, 'Week Ending Oct 2, 2026', 'weekly-summary')
    const opening = storyboard.scenes.find((s) => s.type === 'opening')
    const closing = storyboard.scenes.find((s) => s.type === 'closing')
    assert.equal(opening?.narrationText, FIXED_OPENING_NARRATION_TEXT)
    assert.equal(closing?.narrationText, FIXED_CLOSING_NARRATION_TEXT)
  })
})

// The Storyboard editor's (VideoCreationStoryboard.tsx) plain-textarea
// encodings — pulled into this pure file specifically so they get real
// execution coverage (a .tsx file's JSX can't be imported/run under plain
// `node --test`). Investigation context: a display issue was reported
// where AI-generated scene values appeared not to render in the editor;
// exhaustive tracing (a full server-side pipeline replay through a real
// JSON round-trip, and a live isolated render of the real
// VideoCreationStoryboard component with realistic AI-shaped data) proved
// the data pipeline and the editor's core rendering logic were both
// already correct. The one CONFIRMED, real bug found during that
// investigation was here: metricsToText discarded a metric's `context`
// entirely. Fixed below by extending the encoding to
// "Label: Value | Context" (context omitted from the line, and from the
// round-tripped object, only when genuinely absent).
describe('sceneBulletsToText / textToSceneBullets — round-trips bullets without fabricating content', () => {
  test('round-trips a list of bullets exactly', () => {
    const bullets = ['Interviewed 14 candidates', 'Two agents flagged at-risk']
    assert.deepEqual(textToSceneBullets(sceneBulletsToText(bullets)), bullets)
  })

  test('undefined bullets encode to an empty string, and an empty string decodes back to an empty array (never a fabricated placeholder bullet)', () => {
    assert.equal(sceneBulletsToText(undefined), '')
    assert.deepEqual(textToSceneBullets(''), [])
  })

  test('blank/whitespace-only lines are dropped rather than becoming empty bullets', () => {
    assert.deepEqual(textToSceneBullets('Real bullet\n\n   \nAnother real bullet'), ['Real bullet', 'Another real bullet'])
  })
})

describe('sceneMetricsToText / textToSceneMetrics — round-trips structured metrics, including context, without data loss', () => {
  test('a metric WITH context round-trips label/value/context exactly', () => {
    const metrics = [{ label: 'Revenue', value: '$1.2M', context: 'Q3 bookings' }]
    assert.deepEqual(textToSceneMetrics(sceneMetricsToText(metrics)), metrics)
  })

  test('a metric WITHOUT context round-trips label/value exactly, with no fabricated context added', () => {
    const metrics = [{ label: 'Completion rate', value: '92%' }]
    const roundTripped = textToSceneMetrics(sceneMetricsToText(metrics))
    assert.deepEqual(roundTripped, metrics)
    assert.equal(roundTripped[0].context, undefined)
  })

  test('a mix of metrics with and without context all round-trip correctly in the same textarea', () => {
    const metrics = [
      { label: 'Revenue', value: '$1.2M', context: 'Q3 bookings' },
      { label: 'Completion rate', value: '92%' },
      { label: 'Headcount', value: '14', context: 'new hires this week' },
    ]
    assert.deepEqual(textToSceneMetrics(sceneMetricsToText(metrics)), metrics)
  })

  test('the encoded text visibly shows label AND value for every metric — this is the exact display the original investigation was about', () => {
    const text = sceneMetricsToText([{ label: 'Revenue', value: '$1.2M', context: 'Q3 bookings' }])
    assert.match(text, /Revenue/)
    assert.match(text, /\$1\.2M/)
    assert.match(text, /Q3 bookings/)
  })

  test('undefined metrics encode to an empty string, and an empty string decodes back to an empty array (never a fabricated placeholder metric)', () => {
    assert.equal(sceneMetricsToText(undefined), '')
    assert.deepEqual(textToSceneMetrics(''), [])
  })

  test('editing the encoded text and re-parsing preserves an untouched metric\'s context — simulates an admin editing one metric line without disturbing another', () => {
    const original = [
      { label: 'Revenue', value: '$1.2M', context: 'Q3 bookings' },
      { label: 'Completion rate', value: '92%' },
    ]
    const text = sceneMetricsToText(original)
    // Simulate editing only the second line's value, as a real onChange would.
    const edited = text.replace('92%', '95%')
    const reparsed = textToSceneMetrics(edited)
    assert.deepEqual(reparsed, [
      { label: 'Revenue', value: '$1.2M', context: 'Q3 bookings' },
      { label: 'Completion rate', value: '95%' },
    ])
  })
})

// ARCHITECTURE CORRECTION — four synthetic AtsReport fixtures, deliberately
// NOT metric/risk/pipeline-shaped, standing in for future weeks whose
// content looks nothing like Sep 25's. Sep 25 is test data, not a design
// constraint — the SAME buildStoryboardFromAtsReport transform must handle
// these exactly as safely and honestly as it handles Recruiting/Retention/
// Training above, never forcing any of them into a metric/bottleneck/
// pipeline meaning they don't actually have. These fixtures exist ONLY to
// prove the architecture; none of this synthetic content is used anywhere
// in production code.
const PRODUCT_LAUNCH_REPORT: AtsReport = {
  openingParagraph: 'This week centered on the client portal launch and the final phase of the data migration project.',
  topics: [
    {
      title: 'New Client Portal Launch',
      statusSummary: 'The redesigned client portal launched successfully this week.',
      bullets: ['Portal is live in production for all users', 'Support team completed launch-readiness training'],
      next: 'Monitor adoption and gather early user feedback.',
    },
    {
      title: 'Data Migration Implementation',
      statusSummary: 'Legacy data migration is in its final implementation phase.',
      bullets: ['Migration scripts validated against staging'],
      next: 'Complete the production migration next week.',
    },
  ],
}

const STAFFING_TRAINING_REPORT: AtsReport = {
  openingParagraph: 'Staff development and customer experience were the focus this week.',
  topics: [
    {
      title: 'New Hire Onboarding Program',
      statusSummary: 'Rolled out a refreshed onboarding program for new staff.',
      bullets: ['First cohort completed the new onboarding training'],
      next: 'Collect feedback from the first cohort.',
    },
    {
      title: 'Customer Experience Survey Results',
      statusSummary: 'Reviewed results from the latest customer experience survey.',
      bullets: ['Survey response themes summarized for leadership'],
      next: 'Share findings with department leads.',
    },
  ],
}

const LIGHT_WEEK_REPORT: AtsReport = {
  openingParagraph: 'A quiet week with only one notable development.',
  topics: [
    {
      title: 'Office Relocation Update',
      statusSummary: 'Office relocation planning continued this week.',
      bullets: [],
      next: '',
    },
  ],
}

const COMPLEX_WEEK_REPORT: AtsReport = {
  openingParagraph: 'A busy week spanning product, staffing, compliance, and delivery updates.',
  topics: [
    {
      title: 'Mobile App Beta Release',
      statusSummary: 'The mobile app entered public beta this week.',
      bullets: ['Beta invitations sent to the first user group'],
      next: 'Review beta feedback before general release.',
    },
    {
      title: 'Regional Manager Staffing Update',
      statusSummary: 'A new regional manager was onboarded this week.',
      bullets: [],
      next: '',
    },
    {
      title: 'Regulatory Filing Update',
      statusSummary: 'Completed a required regulatory filing ahead of deadline.',
      bullets: ['Filing submitted and acknowledged by the regulator'],
      next: '',
    },
    {
      title: 'Facilities Maintenance Note',
      statusSummary: 'Routine facilities maintenance completed with no issues.',
      bullets: [],
      next: '',
    },
    {
      title: 'Strategic Planning Session',
      statusSummary: 'Leadership held a strategic planning session for next year.',
      bullets: ['Three strategic priorities identified for next year'],
      next: 'Circulate the draft strategic plan for review.',
    },
  ],
}

describe('ARCHITECTURE: the deterministic transformer never forces non-metric/risk/pipeline content into a fake metric/bottleneck/pipeline meaning', () => {
  const FIXTURES: Array<[string, AtsReport]> = [
    ['A. product-launch/implementation week', PRODUCT_LAUNCH_REPORT],
    ['B. staffing/training/customer-experience week', STAFFING_TRAINING_REPORT],
    ['C. very light week (a single, bare development)', LIGHT_WEEK_REPORT],
    ['D. complex week requiring prioritization across several unrelated developments', COMPLEX_WEEK_REPORT],
  ]

  for (const [label, report] of FIXTURES) {
    test(`${label}: builds without throwing, generationMethod is 'deterministic', and every topic gets exactly one scene (dynamic count — never a fixed template)`, () => {
      const storyboard = buildStoryboardFromAtsReport(report, 'Week Ending Oct 2, 2026', 'weekly-summary')
      assert.equal(storyboard.generationMethod, 'deterministic')
      const topicScenes = storyboard.scenes.filter((s) => s.id.startsWith('topic-'))
      assert.equal(topicScenes.length, report.topics.length)
    })

    test(`${label}: no topic-derived scene is ever assigned a storyEngine unless it structurally reduces to a number (big-metric/multi-metric) — none of this fixture's plain-prose topics do, so ALL of them correctly get no engine`, () => {
      const storyboard = buildStoryboardFromAtsReport(report, 'Week Ending Oct 2, 2026', 'weekly-summary')
      const topicScenes = storyboard.scenes.filter((s) => s.id.startsWith('topic-'))
      for (const scene of topicScenes) {
        assert.equal(scene.type === 'big-metric' || scene.type === 'multi-metric', false, `expected no metric-shaped scenes in this fixture, got ${scene.type}`)
        assert.equal(scene.storyEngine, undefined, `expected scene "${scene.title}" (type ${scene.type}) to have no storyEngine`)
      }
    })

    test(`${label}: every topic's title survives verbatim, unchanged and untouched — content is preserved even though it fits none of the three story engines`, () => {
      const storyboard = buildStoryboardFromAtsReport(report, 'Week Ending Oct 2, 2026', 'weekly-summary')
      const topicScenes = storyboard.scenes.filter((s) => s.id.startsWith('topic-'))
      assert.deepEqual(topicScenes.map((s) => s.title), report.topics.map((t) => t.title))
    })

    test(`${label}: the source AtsReport is never mutated by building this storyboard`, () => {
      const frozenReport = structuredClone(report)
      buildStoryboardFromAtsReport(report, 'Week Ending Oct 2, 2026', 'weekly-summary')
      assert.deepEqual(report, frozenReport)
    })
  }

  test('the light week (fixture C) still produces a valid, complete storyboard from just one bare topic — no crash, no fabricated content, opening/closing still present', () => {
    const storyboard = buildStoryboardFromAtsReport(LIGHT_WEEK_REPORT, 'Week Ending Oct 2, 2026', 'weekly-summary')
    assert.equal(storyboard.scenes[0].type, 'opening')
    assert.equal(storyboard.scenes[storyboard.scenes.length - 1].type, 'closing')
    const topicScene = storyboard.scenes.find((s) => s.id === 'topic-0')
    assert.equal(topicScene?.type, 'status')
    assert.equal(topicScene?.bullets, undefined)
  })

  test('the complex week (fixture D) with five unrelated topics still produces exactly five topic scenes — no omission, no forced merging, no fixed scene-count ceiling applied by this deterministic path', () => {
    const storyboard = buildStoryboardFromAtsReport(COMPLEX_WEEK_REPORT, 'Week Ending Oct 2, 2026', 'weekly-summary')
    const topicScenes = storyboard.scenes.filter((s) => s.id.startsWith('topic-'))
    assert.equal(topicScenes.length, 5)
  })

  test('Sep 25-style content (BASE_REPORT, which genuinely IS metric-shaped) still correctly gets metric-story — Sep 25 remains a perfectly valid input, it is simply not privileged or special-cased anywhere in this function', () => {
    const storyboard = buildStoryboardFromAtsReport(BASE_REPORT, 'Week Ending Sep 26, 2026', 'weekly-summary')
    const recruiting = storyboard.scenes.find((s) => s.title === 'Recruiting')
    assert.equal(recruiting?.storyEngine, 'metric-story')
  })
})

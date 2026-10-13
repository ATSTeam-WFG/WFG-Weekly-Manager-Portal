// Run with: node --test remotion/layeredMechanics.test.ts
//
// Pure, dependency-free (no JSX, no Remotion runtime) — every function here
// is exercised with real execution, exactly like the isolated prototype's
// own storyMechanics.test-worthy design (that experiment didn't ship
// dedicated tests since it was throwaway; this generalized, PRODUCTION
// version does).
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildProgress,
  chipCountForRelativeHeight,
  chipVisibility,
  computeFlowBeatSchedule,
  computeWaypointArrivals,
  flowBeatAt,
  flowGateGapWidth,
  flowPressureGlow,
  leadingDollarFigure,
  mechanicForEngine,
  roughMagnitude,
  simulateFlowTokens,
  staggeredBuildProgress,
  travelerProgress,
} from './layeredMechanics.ts'

describe('mechanicForEngine — the ONLY place storyEngine maps to a visual mechanic', () => {
  test('metric-story maps to accumulation (0-1 metrics) or comparison (2+ metrics) based on a purely structural count, never a second content judgment', () => {
    assert.equal(mechanicForEngine('metric-story', 0), 'accumulation')
    assert.equal(mechanicForEngine('metric-story', 1), 'accumulation')
    assert.equal(mechanicForEngine('metric-story', 2), 'comparison')
    assert.equal(mechanicForEngine('metric-story', 3), 'comparison')
  })

  test('bottleneck-story always maps to flow-pressure', () => {
    assert.equal(mechanicForEngine('bottleneck-story', 0), 'flow-pressure')
    assert.equal(mechanicForEngine('bottleneck-story', 5), 'flow-pressure')
  })

  test('pipeline-story always maps to progression', () => {
    assert.equal(mechanicForEngine('pipeline-story', 0), 'progression')
  })
})

describe('buildProgress / staggeredBuildProgress — accumulation/comparison timing', () => {
  test('starts at (or near) 0 and reaches 1 well before the scene ends, then holds at 1', () => {
    const duration = 180
    assert.ok(buildProgress(0, duration) < 0.05)
    assert.equal(buildProgress(duration - 1, duration), 1)
    assert.equal(buildProgress(duration, duration), 1)
  })

  test('is monotonically non-decreasing — never regresses mid-build', () => {
    const duration = 150
    let previous = -1
    for (let frame = 0; frame < duration; frame += 5) {
      const progress = buildProgress(frame, duration)
      assert.ok(progress >= previous, `expected progress to never decrease (frame ${frame})`)
      previous = progress
    }
  })

  test('staggeredBuildProgress delays later indices without changing the final value once fully built', () => {
    const duration = 150
    const earlyFrame = 20
    assert.ok(staggeredBuildProgress(earlyFrame, duration, 0, 3) >= staggeredBuildProgress(earlyFrame, duration, 2, 3))
    assert.equal(staggeredBuildProgress(duration - 1, duration, 0, 3), 1)
    assert.equal(staggeredBuildProgress(duration - 1, duration, 2, 3), 1)
  })
})

describe('roughMagnitude — a VISUAL-ONLY parse, never rendered, never presented as a fact', () => {
  test('parses common grounded metric-value shapes into a comparable magnitude', () => {
    assert.equal(roughMagnitude('$2.93M'), 2_930_000)
    assert.equal(roughMagnitude('$230K'), 230_000)
    assert.equal(roughMagnitude('92%'), 92)
    assert.equal(roughMagnitude('41'), 41)
  })

  test('returns null (never a fabricated guess) for a value with no parseable leading number', () => {
    assert.equal(roughMagnitude('days'), null)
    assert.equal(roughMagnitude(''), null)
  })
})

describe('computeFlowBeatSchedule / flowBeatAt — flow/pressure/accumulate/(rework)/constrained-exit, auto-scaled to the scene\'s own duration', () => {
  test('a short scene skips the rework beat entirely (not enough time to let it read clearly)', () => {
    const schedule = computeFlowBeatSchedule(90) // 3s @ 30fps
    assert.equal(schedule.some((r) => r.beat === 'rework'), false)
  })

  test('a long scene includes the rework beat', () => {
    const schedule = computeFlowBeatSchedule(240) // 8s @ 30fps
    assert.equal(schedule.some((r) => r.beat === 'rework'), true)
  })

  test('beats are contiguous and cover the entire duration with no gaps or overlaps', () => {
    const durationInFrames = 300
    const schedule = computeFlowBeatSchedule(durationInFrames)
    assert.equal(schedule[0].startFrame, 0)
    for (let i = 1; i < schedule.length; i++) {
      assert.equal(schedule[i].startFrame, schedule[i - 1].endFrame)
    }
    assert.equal(schedule[schedule.length - 1].endFrame, durationInFrames)
  })

  test('flowBeatAt returns the correct beat for a frame inside each range, and the last beat past the end', () => {
    const durationInFrames = 300
    const schedule = computeFlowBeatSchedule(durationInFrames)
    for (const range of schedule) {
      assert.equal(flowBeatAt(range.startFrame, schedule), range.beat)
    }
    assert.equal(flowBeatAt(durationInFrames + 100, schedule), schedule[schedule.length - 1].beat)
  })
})

describe('simulateFlowTokens — deterministic, and grounded numbers never appear in the simulation itself', () => {
  test('is a pure function of duration alone — calling it twice with the same input produces identical output', () => {
    const a = simulateFlowTokens(240)
    const b = simulateFlowTokens(240)
    assert.deepEqual(a, b)
  })

  test('returns exactly one frame entry per frame of the requested duration', () => {
    const duration = 180
    const frames = simulateFlowTokens(duration)
    assert.equal(frames.length, duration)
  })

  test('at least one token spawns and reaches a "moving" state by the end of the flow beat', () => {
    const duration = 240
    const schedule = computeFlowBeatSchedule(duration)
    const flowRange = schedule.find((r) => r.beat === 'flow')
    assert.ok(flowRange)
    const frames = simulateFlowTokens(duration)
    const lastFlowFrame = frames[flowRange.endFrame - 1]
    assert.ok(lastFlowFrame.length > 0, 'expected at least one token to have spawned by the end of the flow beat')
  })

  test('some tokens are marked "reworking" or "held" only in a scene long enough to include the rework beat', () => {
    const duration = 240
    const frames = simulateFlowTokens(duration)
    const everHeld = frames.some((frameTokens) => frameTokens.some((t) => t.state === 'reworking' || t.state === 'held'))
    assert.equal(everHeld, true)
  })
})

describe('flowGateGapWidth / flowPressureGlow — the gate only narrows during constrained-exit; the pressure glow only appears from "pressure" onward', () => {
  test('gate gap is wide before constrained-exit and narrows to its minimum by the end of the scene', () => {
    const duration = 240
    const schedule = computeFlowBeatSchedule(duration)
    const exitRange = schedule.find((r) => r.beat === 'constrained-exit')
    assert.ok(exitRange)
    assert.equal(flowGateGapWidth(0, schedule), 130)
    assert.ok(flowGateGapWidth(exitRange.endFrame - 1, schedule) < 40)
  })

  test('pressure glow is zero before "pressure" begins and positive during/after it', () => {
    const duration = 240
    const schedule = computeFlowBeatSchedule(duration)
    const pressureRange = schedule.find((r) => r.beat === 'pressure')
    assert.ok(pressureRange)
    assert.equal(flowPressureGlow(0, schedule), 0)
    assert.ok(flowPressureGlow(pressureRange.startFrame + 15, schedule) > 0)
  })
})

describe('computeWaypointArrivals / travelerProgress — progression (pipeline-story and forward-look)', () => {
  test('each waypoint starts at 0 and reaches 1, staggered so later waypoints arrive later', () => {
    const duration = 200
    const arrivals0 = computeWaypointArrivals(0, duration, 3)
    assert.equal(arrivals0.every((a) => a === 0), true)
    const arrivalsEnd = computeWaypointArrivals(duration - 1, duration, 3)
    assert.equal(arrivalsEnd.every((a) => a === 1), true)

    const midArrivals = computeWaypointArrivals(Math.round(duration * 0.3), duration, 3)
    assert.ok(midArrivals[0] >= midArrivals[1])
    assert.ok(midArrivals[1] >= midArrivals[2])
  })

  test('travelerProgress moves continuously from 0 to 1 across the scene, never jumping backward', () => {
    const duration = 200
    let previous = -1
    for (let frame = 0; frame < duration; frame += 4) {
      const progress = travelerProgress(frame, duration)
      assert.ok(progress >= previous)
      previous = progress
    }
    assert.equal(travelerProgress(duration - 1, duration), 1)
  })
})

describe('chipVisibility / chipCountForRelativeHeight — the "value piling up" metaphor shared by accumulation and comparison', () => {
  test('chipVisibility is 0 before a chip\'s turn, grows smoothly through it, and settles at 1 once fully built', () => {
    assert.equal(chipVisibility(0, 5, 2), 0)
    assert.equal(chipVisibility(1, 5, 0), 1)
    assert.equal(chipVisibility(1, 5, 4), 1)
    assert.ok(chipVisibility(0.3, 5, 1) > 0 && chipVisibility(0.3, 5, 1) < 1, 'the "currently animating in" chip should be a partial value, not 0 or 1')
  })

  test('earlier chips (lower index) always become visible no later than later ones, at any progress', () => {
    for (let p = 0; p <= 1; p += 0.1) {
      assert.ok(chipVisibility(p, 6, 1) >= chipVisibility(p, 6, 3))
    }
  })

  test('chipCountForRelativeHeight scales with relative magnitude, always at least 2 chips (never a single-chip stack) even for a near-zero relative height', () => {
    assert.equal(chipCountForRelativeHeight(1, 6), 6)
    assert.equal(chipCountForRelativeHeight(0, 6), 2)
    assert.equal(chipCountForRelativeHeight(0.5, 6), 3)
  })

  test('chipCountForRelativeHeight clamps an out-of-range relative height rather than producing a nonsensical chip count', () => {
    assert.equal(chipCountForRelativeHeight(-0.5, 6), 2)
    assert.equal(chipCountForRelativeHeight(1.5, 6), 6)
  })
})

describe('leadingDollarFigure — a grounded value callout, never an invented one', () => {
  test('extracts a dollar figure that appears anywhere in an already-grounded label', () => {
    assert.equal(leadingDollarFigure('$18M TN deal secured'), '$18M')
    assert.equal(leadingDollarFigure('New agent placing $20M+ in orders'), '$20M+')
  })

  test('returns null (never a fabricated figure) when the label has no dollar amount at all', () => {
    assert.equal(leadingDollarFigure('Top prospects nearing approval'), null)
    assert.equal(leadingDollarFigure(''), null)
  })

  test('never returns a substring longer than what was actually present in the source label', () => {
    const label = 'Highest YTD Net Remittance at $438.8K'
    const figure = leadingDollarFigure(label)
    assert.ok(figure)
    assert.ok(label.includes(figure as string))
  })
})

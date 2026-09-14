// Run with: node --test src/lib/reminderService.test.ts
// reminderService.ts's only imports are `import type` (ManagerSummary,
// ReportingWeek), erased entirely at compile time, so this runs directly
// via bare `node --test` — no build step, no scratch-compile workaround.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { getReminderTargets, buildFridayReminderEmail } from './reminderService.ts'
import type { ManagerSummary } from './adminService.ts'
import type { ReportingWeek } from '../utils/week.ts'

function manager(overrides: Partial<ManagerSummary> = {}): ManagerSummary {
  return {
    id: 'm1',
    fullName: 'Jane Manager',
    email: 'jane@example.com',
    status: 'not_started',
    submittedAt: null,
    submissionSource: null,
    ...overrides,
  }
}

const WEEK: ReportingWeek = {
  label: 'Jan 5 – Jan 9, 2026',
  fridayDate: new Date(2026, 0, 9),
  deadlineLabel: 'Friday, January 9 at 3:00 PM ET',
  weekStartDate: '2026-01-05',
}

describe('getReminderTargets', () => {
  test('includes a not_started manager', () => {
    const targets = getReminderTargets([manager({ id: 'a', status: 'not_started' })])
    assert.equal(targets.length, 1)
    assert.equal(targets[0].id, 'a')
  })

  test('includes a draft manager', () => {
    const targets = getReminderTargets([manager({ id: 'b', status: 'draft' })])
    assert.equal(targets.length, 1)
    assert.equal(targets[0].id, 'b')
  })

  test('excludes a submitted manager — the core Friday-noon targeting rule', () => {
    const targets = getReminderTargets([manager({ id: 'c', status: 'submitted' })])
    assert.equal(targets.length, 0)
  })

  test('a mixed list only ever returns the non-submitted managers', () => {
    const targets = getReminderTargets([
      manager({ id: 'a', status: 'not_started' }),
      manager({ id: 'b', status: 'draft' }),
      manager({ id: 'c', status: 'submitted' }),
      manager({ id: 'd', status: 'submitted' }),
    ])
    assert.deepEqual(
      targets.map((t) => t.id),
      ['a', 'b'],
    )
  })

  test('an empty manager list produces an empty target list', () => {
    assert.deepEqual(getReminderTargets([]), [])
  })
})

describe('buildFridayReminderEmail', () => {
  test('subject line reflects the 3:00 PM ET deadline', () => {
    const content = buildFridayReminderEmail(
      { id: 'a', fullName: 'Jane Manager', email: 'jane@example.com', status: 'not_started' },
      WEEK,
    )
    assert.match(content.subject, /3:00 PM ET/)
    assert.doesNotMatch(content.subject, /4:00 PM/)
  })

  test('draft-status body mentions the 3:00 PM auto-submit and the 3:30 PM edit window', () => {
    const content = buildFridayReminderEmail(
      { id: 'a', fullName: 'Jane Manager', email: 'jane@example.com', status: 'draft' },
      WEEK,
    )
    assert.match(content.body, /3:00 PM ET/)
    assert.match(content.body, /3:30 PM ET/)
    assert.doesNotMatch(content.body, /4:00 PM/)
  })

  test('not_started-status body never claims the (nonexistent) report will be auto-submitted', () => {
    const content = buildFridayReminderEmail(
      { id: 'a', fullName: 'Jane Manager', email: 'jane@example.com', status: 'not_started' },
      WEEK,
    )
    assert.doesNotMatch(content.body, /automatically submitted for you/)
  })
})

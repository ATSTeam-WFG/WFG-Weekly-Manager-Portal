// Run with: node --test api/_lib/autoSubmit.test.ts
// No relative imports of its own, so this runs directly via bare
// `node --test` — no scratch compile needed. Uses a fake in-memory
// "reports" table only: no real Supabase call, no real database mutation.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { runAutoSubmit, type AutoSubmitQuery, type AutoSubmitReportRow } from './autoSubmit.ts'

interface FakeRow extends AutoSubmitReportRow {
  week_start_date: string
}

function makeFakeReportsTable(initialRows: FakeRow[]) {
  const rows: FakeRow[] = initialRows.map((r) => ({ ...r }))
  let updateCallCount = 0

  const query: AutoSubmitQuery = {
    async selectDraftReports(weekStartDate) {
      const matched = rows.filter((r) => r.week_start_date === weekStartDate && r.status === 'draft')
      return { data: matched.map(({ week_start_date: _w, ...rest }) => rest), error: null }
    },
    async updateDraftReportsToSubmitted(weekStartDate, submittedAt) {
      updateCallCount++
      const matched = rows.filter((r) => r.week_start_date === weekStartDate && r.status === 'draft')
      for (const row of matched) {
        row.status = 'submitted'
        row.submitted_at = submittedAt
        row.submission_source = 'automatic'
      }
      return { data: matched.map(({ week_start_date: _w, ...rest }) => rest), error: null }
    },
  }

  return { rows, query, updateCallCount: () => updateCallCount }
}

const WEEK_A = '2099-01-05'
const WEEK_B = '2099-01-12'

describe('runAutoSubmit', () => {
  test('draft -> submitted, submission_source becomes automatic, submitted_at is set', async () => {
    const { rows, query } = makeFakeReportsTable([
      { id: 'r1', manager_id: 'm1', week_start_date: WEEK_A, status: 'draft', submitted_at: null, submission_source: null },
    ])

    const outcome = await runAutoSubmit(query, WEEK_A, false, () => '2099-01-09T21:00:00.000Z')

    assert.equal(outcome.ok, true)
    if (outcome.ok) {
      assert.equal(outcome.count, 1)
      assert.equal(outcome.reports[0].status, 'submitted')
      assert.equal(outcome.reports[0].submission_source, 'automatic')
      assert.equal(outcome.reports[0].submitted_at, '2099-01-09T21:00:00.000Z')
    }
    assert.equal(rows[0].status, 'submitted')
    assert.equal(rows[0].submission_source, 'automatic')
  })

  test('already submitted with submission_source=manual is left completely unchanged', async () => {
    const { rows, query } = makeFakeReportsTable([
      { id: 'r1', manager_id: 'm1', week_start_date: WEEK_A, status: 'submitted', submitted_at: '2099-01-08T12:00:00.000Z', submission_source: 'manual' },
    ])

    const outcome = await runAutoSubmit(query, WEEK_A, false, () => '2099-01-09T21:00:00.000Z')

    assert.equal(outcome.ok, true)
    if (outcome.ok) assert.equal(outcome.count, 0, 'a manually-submitted report must never be touched')
    assert.deepEqual(rows[0], {
      id: 'r1',
      manager_id: 'm1',
      week_start_date: WEEK_A,
      status: 'submitted',
      submitted_at: '2099-01-08T12:00:00.000Z',
      submission_source: 'manual',
    })
  })

  test('already submitted with submission_source=automatic is left completely unchanged', async () => {
    const { rows, query } = makeFakeReportsTable([
      { id: 'r1', manager_id: 'm1', week_start_date: WEEK_A, status: 'submitted', submitted_at: '2099-01-09T21:00:00.000Z', submission_source: 'automatic' },
    ])

    const outcome = await runAutoSubmit(query, WEEK_A, false, () => '2099-01-09T22:00:00.000Z')

    assert.equal(outcome.ok, true)
    if (outcome.ok) assert.equal(outcome.count, 0, 're-running must not touch an already-auto-submitted report')
    assert.equal(rows[0].submitted_at, '2099-01-09T21:00:00.000Z', 'the original timestamp must not be overwritten')
  })

  test('second run for the same week is idempotent: zero additional rows change, nothing is duplicated', async () => {
    const { rows, query } = makeFakeReportsTable([
      { id: 'r1', manager_id: 'm1', week_start_date: WEEK_A, status: 'draft', submitted_at: null, submission_source: null },
    ])

    const first = await runAutoSubmit(query, WEEK_A, false, () => '2099-01-09T21:00:00.000Z')
    const second = await runAutoSubmit(query, WEEK_A, false, () => '2099-01-09T23:00:00.000Z')

    assert.equal(first.ok && first.count, 1)
    assert.equal(second.ok && second.count, 0, 'the second run must find zero drafts left to touch')
    assert.equal(rows.length, 1, 'no duplicate report was created')
    assert.equal(rows[0].submitted_at, '2099-01-09T21:00:00.000Z', 'the original submission timestamp is preserved, not overwritten by the second run')
  })

  test('dry run performs zero mutations', async () => {
    const { rows, query, updateCallCount } = makeFakeReportsTable([
      { id: 'r1', manager_id: 'm1', week_start_date: WEEK_A, status: 'draft', submitted_at: null, submission_source: null },
    ])
    const before = JSON.parse(JSON.stringify(rows))

    const outcome = await runAutoSubmit(query, WEEK_A, true)

    assert.equal(outcome.ok, true)
    if (outcome.ok) {
      assert.equal(outcome.dryRun, true)
      assert.equal(outcome.count, 1)
      assert.equal(outcome.reports[0].status, 'draft', 'the preview must show the CURRENT status, never a mutated one')
    }
    assert.deepEqual(rows, before, 'the underlying data must be byte-identical after a dry run')
    assert.equal(updateCallCount(), 0, 'the update operation must never be invoked during a dry run')
  })

  test('only the selected reporting week is affected — a different week\'s drafts are untouched', async () => {
    const { rows, query } = makeFakeReportsTable([
      { id: 'r1', manager_id: 'm1', week_start_date: WEEK_A, status: 'draft', submitted_at: null, submission_source: null },
      { id: 'r2', manager_id: 'm2', week_start_date: WEEK_B, status: 'draft', submitted_at: null, submission_source: null },
    ])

    const outcome = await runAutoSubmit(query, WEEK_A, false, () => '2099-01-09T21:00:00.000Z')

    assert.equal(outcome.ok && outcome.count, 1)
    assert.equal(rows.find((r) => r.id === 'r1')?.status, 'submitted')
    assert.equal(rows.find((r) => r.id === 'r2')?.status, 'draft', 'a different week\'s draft must not be affected')
  })

  test('a query error is reported cleanly without assuming any partial mutation succeeded', async () => {
    const query: AutoSubmitQuery = {
      selectDraftReports: async () => ({ data: null, error: { message: 'connection lost' } }),
      updateDraftReportsToSubmitted: async () => ({ data: null, error: { message: 'connection lost' } }),
    }

    const outcome = await runAutoSubmit(query, WEEK_A, false)

    assert.equal(outcome.ok, false)
    if (!outcome.ok) assert.equal(outcome.error, 'connection lost')
  })

  test('multiple eligible reports in the same week are all correctly auto-submitted together', async () => {
    const { rows, query } = makeFakeReportsTable([
      { id: 'r1', manager_id: 'm1', week_start_date: WEEK_A, status: 'draft', submitted_at: null, submission_source: null },
      { id: 'r2', manager_id: 'm2', week_start_date: WEEK_A, status: 'draft', submitted_at: null, submission_source: null },
      { id: 'r3', manager_id: 'm3', week_start_date: WEEK_A, status: 'submitted', submitted_at: '2099-01-08T10:00:00.000Z', submission_source: 'manual' },
    ])

    const outcome = await runAutoSubmit(query, WEEK_A, false, () => '2099-01-09T21:00:00.000Z')

    assert.equal(outcome.ok && outcome.count, 2)
    assert.equal(rows.find((r) => r.id === 'r1')?.status, 'submitted')
    assert.equal(rows.find((r) => r.id === 'r2')?.status, 'submitted')
    assert.equal(rows.find((r) => r.id === 'r3')?.submission_source, 'manual', 'the pre-existing manual submission is untouched')
  })
})

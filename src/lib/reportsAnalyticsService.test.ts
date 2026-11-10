// Run with: node --import ./scripts/register-test-hooks.mjs --test src/lib/reportsAnalyticsService.test.ts
//
// Genuine behavioral test for fetchPeriodReportStats, using a minimal fake
// Supabase query builder (no network, no real Supabase import) — this
// function's own shape (one awaited .from().select()...chain per call) is
// simple enough to fake directly, unlike the serverless handlers elsewhere
// in this codebase that import the real @supabase/supabase-js client.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { fetchPeriodReportStats } from './reportsAnalyticsService.ts'

interface FakeChain extends PromiseLike<{ data: unknown; error: null }> {
  select: (...args: unknown[]) => FakeChain
  eq: (...args: unknown[]) => FakeChain
  order: (...args: unknown[]) => FakeChain
  in: (...args: unknown[]) => FakeChain
}

function makeFakeClient(opts: {
  currentSubmitterProfiles: { id: string; full_name: string }[]
  reports: { manager_id: string; week_start_date: string; status: string }[]
  historicalProfiles: { id: string; full_name: string }[]
}) {
  return {
    from(table: string) {
      const calls: { method: string; args: unknown[] }[] = []
      const chain: FakeChain = {
        select(...args) {
          calls.push({ method: 'select', args })
          return chain
        },
        eq(...args) {
          calls.push({ method: 'eq', args })
          return chain
        },
        order(...args) {
          calls.push({ method: 'order', args })
          return chain
        },
        in(...args) {
          calls.push({ method: 'in', args })
          return chain
        },
        then(onfulfilled) {
          let result: { data: unknown; error: null }
          if (table === 'reports') {
            result = { data: opts.reports, error: null }
          } else if (table === 'profiles' && calls.some((c) => c.method === 'eq')) {
            result = { data: opts.currentSubmitterProfiles, error: null }
          } else if (table === 'profiles' && calls.some((c) => c.method === 'in')) {
            result = { data: opts.historicalProfiles, error: null }
          } else {
            result = { data: [], error: null }
          }
          return Promise.resolve(result).then(onfulfilled as never)
        },
      }
      return chain
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any
}

describe('fetchPeriodReportStats — historical visibility without disturbing KPI math', () => {
  test('a manager no longer a current submitter still has their historical submitted report visible in entries, with their name resolved via the historical lookup', async () => {
    const client = makeFakeClient({
      currentSubmitterProfiles: [{ id: 'current-1', full_name: 'Current Manager' }],
      reports: [
        { manager_id: 'current-1', week_start_date: '2026-11-02', status: 'submitted' },
        { manager_id: 'converted-1', week_start_date: '2026-10-26', status: 'submitted' },
      ],
      historicalProfiles: [{ id: 'converted-1', full_name: 'Joey Grampa' }],
    })

    const stats = await fetchPeriodReportStats(client, ['2026-11-02', '2026-10-26'])

    const converted = stats.entries.find((e) => e.managerId === 'converted-1')
    assert.ok(converted, 'the no-longer-current-submitter manager must still appear in entries')
    assert.equal(converted!.managerName, 'Joey Grampa')
    assert.equal(converted!.weeks.length, 1)
    assert.equal(converted!.weeks[0].weekStartDate, '2026-10-26')
  })

  test('uniqueManagers/expectedReports count only the current submitter, even though two managers have reports in range', async () => {
    const client = makeFakeClient({
      currentSubmitterProfiles: [{ id: 'current-1', full_name: 'Current Manager' }],
      reports: [
        { manager_id: 'current-1', week_start_date: '2026-11-02', status: 'submitted' },
        { manager_id: 'converted-1', week_start_date: '2026-11-02', status: 'submitted' },
      ],
      historicalProfiles: [{ id: 'converted-1', full_name: 'Joey Grampa' }],
    })

    const stats = await fetchPeriodReportStats(client, ['2026-11-02'])

    assert.equal(stats.uniqueManagers, 1)
    assert.equal(stats.expectedReports, 1)
    // submittedReports (the KPI numerator) must also stay scoped to current
    // submitters only, so completionPct can never exceed 100% just because
    // a historical manager's report also exists in the same window.
    assert.equal(stats.submittedReports, 1)
    assert.equal(stats.completionPct, 100)
  })

  test('a manager with no submitted weeks in range (draft-only or none) never appears in entries, converted or not', async () => {
    const client = makeFakeClient({
      currentSubmitterProfiles: [{ id: 'current-1', full_name: 'Current Manager' }],
      reports: [{ manager_id: 'converted-1', week_start_date: '2026-11-02', status: 'draft' }],
      historicalProfiles: [{ id: 'converted-1', full_name: 'Joey Grampa' }],
    })

    const stats = await fetchPeriodReportStats(client, ['2026-11-02'])
    assert.equal(stats.entries.find((e) => e.managerId === 'converted-1'), undefined)
  })

  test('pendingManagers stays scoped to current submitters only — a converted-away manager is never reported as pending', async () => {
    const client = makeFakeClient({
      currentSubmitterProfiles: [{ id: 'current-1', full_name: 'Current Manager' }],
      reports: [],
      historicalProfiles: [],
    })

    const stats = await fetchPeriodReportStats(client, ['2026-11-02'])
    assert.equal(stats.pendingManagers.length, 1)
    assert.equal(stats.pendingManagers[0].managerId, 'current-1')
  })
})

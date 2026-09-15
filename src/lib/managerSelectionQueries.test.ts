// Run with: node --test src/lib/managerSelectionQueries.test.ts
//
// adminService.ts and reportsAnalyticsService.ts both import
// reportContentMapping.js (a real runtime import resolved by Vite/tsc's
// bundler mode to the sibling .ts file) — bare `node --test` cannot resolve
// that specifier directly, the same limitation documented in
// managerEditLock.test.ts and reportsServiceLockWiring.test.ts. This
// verifies the manager-selection query filter via source inspection
// instead: the three query sites that decide "who is a submitter" for the
// Dashboard/Weekly Summary/Reports Analytics must all key off
// submits_weekly_report, never role — so a dual-role admin submitter is
// included and a plain Admin is not, without either query needing to know
// anything about roles at all.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const dir = path.dirname(fileURLToPath(import.meta.url))
const adminServiceSrc = readFileSync(path.join(dir, 'adminService.ts'), 'utf8')
const analyticsServiceSrc = readFileSync(path.join(dir, 'reportsAnalyticsService.ts'), 'utf8')

describe('fetchManagersForWeek (src/lib/adminService.ts)', () => {
  const fnMatch = adminServiceSrc.match(/export async function fetchManagersForWeek\([\s\S]*?\n\}/)
  assert.ok(fnMatch, 'could not locate fetchManagersForWeek')
  const body = fnMatch[0]

  test('filters profiles on submits_weekly_report = true', () => {
    assert.match(body, /\.eq\('submits_weekly_report', true\)/)
  })

  test('never filters on role = manager anymore', () => {
    assert.equal(/\.eq\('role', ?'manager'\)/.test(body), false)
  })
})

describe('fetchWeeklySummary (src/lib/adminService.ts)', () => {
  const fnMatch = adminServiceSrc.match(/export async function fetchWeeklySummary\([\s\S]*?\n\}/)
  assert.ok(fnMatch, 'could not locate fetchWeeklySummary')
  const body = fnMatch[0]

  test('filters profiles on submits_weekly_report = true', () => {
    assert.match(body, /\.eq\('submits_weekly_report', true\)/)
  })

  test('never filters on role = manager anymore', () => {
    assert.equal(/\.eq\('role', ?'manager'\)/.test(body), false)
  })
})

describe('fetchPeriodReportStats (src/lib/reportsAnalyticsService.ts)', () => {
  const fnMatch = analyticsServiceSrc.match(/export async function fetchPeriodReportStats\([\s\S]*?\n\}/)
  assert.ok(fnMatch, 'could not locate fetchPeriodReportStats')
  const body = fnMatch[0]

  test('filters profiles on submits_weekly_report = true', () => {
    assert.match(body, /\.eq\('submits_weekly_report', true\)/)
  })

  test('never filters on role = manager anymore', () => {
    assert.equal(/\.eq\('role', ?'manager'\)/.test(body), false)
  })
})

describe('reminderService.ts / api/reminders.ts need no separate change', () => {
  test('reminderService.ts has no role or submits_weekly_report filter of its own — it consumes ManagerSummary[] already produced by fetchManagersForWeek', () => {
    const reminderSrc = readFileSync(path.join(dir, 'reminderService.ts'), 'utf8')
    assert.equal(reminderSrc.includes('submits_weekly_report'), false)
    assert.equal(/role\s*===\s*'manager'/.test(reminderSrc), false)
  })
})

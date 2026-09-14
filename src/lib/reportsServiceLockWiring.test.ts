// Run with: node --test src/lib/reportsServiceLockWiring.test.ts
//
// reportsService.ts imports the real Supabase browser client
// (supabaseClient.ts), which constructs a client at module load time and
// would throw immediately if required env vars aren't set in this shell —
// so its actual write functions aren't safe to import and execute directly
// here. This verifies the Friday-cutoff guard's *wiring* via source
// inspection instead — the same pattern used by
// api/_lib/scheduler-endpoints.test.ts for handlers with a similar
// direct-import limitation. The guard's own decision logic is exhaustively,
// dynamically tested in managerEditLock.test.ts.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const dir = path.dirname(fileURLToPath(import.meta.url))
const src = readFileSync(path.join(dir, 'reportsService.ts'), 'utf8')

describe('reportsService.ts wires the Friday-cutoff guard into every Manager write path', () => {
  test('updateReportSectionsV2 asserts not locked, always as an existing report (isNewReport=false)', () => {
    const fnMatch = src.match(/export async function updateReportSectionsV2\([\s\S]*?\n\}/)
    assert.ok(fnMatch, 'could not locate updateReportSectionsV2')
    assert.match(fnMatch[0], /assertNotLocked\(false\)/)
  })

  test('saveReportV2 asserts not locked using the caller-supplied isNewReport flag', () => {
    const fnMatch = src.match(/export async function saveReportV2\([\s\S]*?\n\}/)
    assert.ok(fnMatch, 'could not locate saveReportV2')
    assert.match(fnMatch[0], /assertNotLocked\(isNewReport\)/)
  })

  test('the guard is checked before the Supabase call in both functions, not after', () => {
    for (const fnName of ['updateReportSectionsV2', 'saveReportV2']) {
      const fnMatch = src.match(new RegExp(`export async function ${fnName}\\([\\s\\S]*?\\n\\}`))
      assert.ok(fnMatch, `could not locate ${fnName}`)
      const body = fnMatch[0]
      const guardIndex = body.indexOf('assertNotLocked(')
      const supabaseCallIndex = body.indexOf('await supabase')
      assert.ok(guardIndex !== -1 && supabaseCallIndex !== -1, `${fnName}: missing guard or Supabase call`)
      assert.ok(guardIndex < supabaseCallIndex, `${fnName}: the lock guard must run before the Supabase write`)
    }
  })

  test('ManagerEditLockedError is exported for App.tsx to catch', () => {
    assert.match(src, /export class ManagerEditLockedError extends Error/)
  })
})

// Stale-draft reconciliation wiring — the fix for a manager's local 'draft'
// state going stale relative to an auto-submitted database row (see
// managerEditLock.test.ts for the exhaustive behavioral coverage of the
// pure decision itself, resolveSaveStatus).
describe('saveReportV2 wires the stale-draft reconciliation before writing', () => {
  const fnMatch = src.match(/export async function saveReportV2\([\s\S]*?\n\}/)

  test('saveReportV2 exists and is matched for the rest of these checks', () => {
    assert.ok(fnMatch, 'could not locate saveReportV2')
  })

  test('the lock guard runs before the stale-draft reconciliation, which runs before any write', () => {
    const body = fnMatch![0]
    const guardIndex = body.indexOf('assertNotLocked(')
    const resolveIndex = body.indexOf('resolveSaveStatus(')
    const contentOnlyCallIndex = body.indexOf('updateReportSectionsV2(')
    const upsertIndex = body.indexOf('await supabase')
    assert.ok(
      guardIndex !== -1 && resolveIndex !== -1 && contentOnlyCallIndex !== -1 && upsertIndex !== -1,
      'missing one of: lock guard, resolveSaveStatus, updateReportSectionsV2 delegation, or the upsert call',
    )
    assert.ok(guardIndex < resolveIndex, 'the lock guard must run before the stale-draft reconciliation')
    assert.ok(resolveIndex < contentOnlyCallIndex, 'the reconciliation decision must run before any write is attempted')
    assert.ok(contentOnlyCallIndex < upsertIndex, 'the content-only delegation must be reachable before the upsert path')
  })

  test('the current status is only re-read from the database when requesting draft on an existing report', () => {
    const body = fnMatch![0]
    assert.match(body, /status === 'draft' && !isNewReport \? await fetchCurrentStatus\(/)
  })

  test('a content-only resolution returns without ever reaching the upsert call', () => {
    const body = fnMatch![0]
    const contentOnlyBlockMatch = body.match(/if \(resolution\.mode === 'content-only'\) \{([\s\S]*?)\n {2}\}/)
    assert.ok(contentOnlyBlockMatch, 'could not locate the content-only branch')
    assert.match(contentOnlyBlockMatch[1], /await updateReportSectionsV2\(/)
    assert.match(contentOnlyBlockMatch[1], /return resolution\.status/)
  })
})

// Run with: node --test api/_lib/scheduler-endpoints.test.ts
//
// api/reminders.ts and api/auto-submit.ts have a deep transitive import
// graph (adminService, reminderService, emailSender, week, easternTime,
// requestHelpers, adminAuth — all using .js specifiers per this project's
// nodenext convention for api/ code) that Node's own bare runtime cannot
// resolve directly, the same limitation already documented in
// src/utils/week.test.ts. So these tests verify the exact structural
// change via direct source inspection rather than importing and executing
// the real handlers — which also means nothing here ever sends an email or
// runs auto-submit. The authentication logic these handlers now depend on
// (isSchedulerBearerToken, authenticateRequest's dispatch) is separately,
// fully exercised dynamically in adminAuth.test.ts, which has no such
// resolution problem (adminAuth.ts has no relative imports of its own).
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const dir = path.dirname(fileURLToPath(import.meta.url))
const remindersSrc = readFileSync(path.join(dir, '..', 'reminders.ts'), 'utf8')
const autoSubmitSrc = readFileSync(path.join(dir, '..', 'auto-submit.ts'), 'utf8')
const adminAuthSrc = readFileSync(path.join(dir, 'adminAuth.ts'), 'utf8')

const handlers = [
  { name: 'reminders.ts', src: remindersSrc },
  { name: 'auto-submit.ts', src: autoSubmitSrc },
]

describe('no remaining production reference to the old scheduler header', () => {
  for (const { name, src } of [...handlers, { name: 'adminAuth.ts', src: adminAuthSrc }]) {
    test(`${name} contains no mention of x-scheduler-request / SCHEDULER_REQUEST / isSchedulerRequest(...)`, () => {
      assert.equal(src.includes('x-scheduler-request'), false, `${name} still references the literal header name`)
      assert.equal(src.includes('SCHEDULER_REQUEST'), false, `${name} still references SCHEDULER_REQUEST`)
      // Matches the removed function's *call* form (e.g.
      // `isSchedulerRequest(req.headers[...])`) — NOT
      // requestHelpers.ts's unrelated `isSchedulerRequest:` option key on
      // resolveDryRun, which is a harmless, pre-existing naming
      // coincidence with a different, still-correct meaning.
      assert.equal(/isSchedulerRequest\(/.test(src), false, `${name} still calls the removed isSchedulerRequest() function`)
    })
  }
})

describe('reminders.ts / auto-submit.ts — scheduler auth wiring, verified structurally', () => {
  for (const { name, src } of handlers) {
    test(`${name}: a genuine cron GET is no longer rejected before authentication runs`, () => {
      // The old code had two separate 405 returns: one generic
      // method-allowlist check, and one GET-specific PRE-AUTH rejection
      // keyed on the (now-removed) header-derived `scheduled` flag. Only
      // the generic allowlist check should remain, and it must not
      // distinguish GET from POST.
      const count405 = (src.match(/405/g) ?? []).length
      assert.equal(count405, 1, `expected exactly one 405 (the generic method allowlist) in ${name}, found ${count405}`)
      assert.equal(src.includes("req.method === 'GET' && !scheduled"), false)
    })

    test(`${name}: authenticateRequest is called without a schedulerRequestHeader property`, () => {
      assert.match(src, /authenticateRequest\(/)
      assert.equal(src.includes('schedulerRequestHeader:'), false)
    })

    test(`${name}: scheduler status is derived from the authenticated result (auth.via), not a request header`, () => {
      assert.match(src, /via\s*===\s*'scheduler-bot'/)
    })

    test(`${name}: every method is authenticated the same single way before branching on the result`, () => {
      assert.match(src, /const auth = await authenticateRequest\(/)
      // Only one authenticateRequest call exists — GET and POST share it,
      // so the human-Admin (POST) path is authenticated exactly as before
      // this step (authenticateAdmin itself was not modified).
      const callCount = (src.match(/authenticateRequest\(/g) ?? []).length
      assert.equal(callCount, 1, `expected exactly one authenticateRequest call in ${name}, found ${callCount}`)
    })
  }
})

// isInEasternActionWindow itself is exhaustively, dynamically tested
// (EST/EDT, exact-minute/+14/+15/before/two-hours-late/wrong-weekday) in
// src/utils/easternTime.test.ts, using the exact (12,0,15) and (15,0,15)
// parameters these two handlers use. The same import-graph limitation noted
// above applies here too, so what's verified below is the *wiring*: correct
// parameters, correctly gated to the scheduler-bot path only, positioned
// before any action-related work, with a safe 200 no-op response shape.
describe('Step 6 — Eastern action-window gate wiring', () => {
  test('reminders.ts gates on Friday 12:00–12:14 PM America/New_York', () => {
    assert.match(remindersSrc, /REMINDER_WINDOW_HOUR\s*=\s*12/)
    assert.match(remindersSrc, /REMINDER_WINDOW_MINUTE\s*=\s*0\b/)
    assert.match(remindersSrc, /REMINDER_WINDOW_MINUTES\s*=\s*15/)
    assert.match(
      remindersSrc,
      /isInEasternActionWindow\(REMINDER_WINDOW_HOUR,\s*REMINDER_WINDOW_MINUTE,\s*REMINDER_WINDOW_MINUTES\)/,
    )
  })

  test('auto-submit.ts gates on Friday 3:00–3:14 PM America/New_York', () => {
    assert.match(autoSubmitSrc, /AUTO_SUBMIT_WINDOW_HOUR\s*=\s*15/)
    assert.match(autoSubmitSrc, /AUTO_SUBMIT_WINDOW_MINUTE\s*=\s*0\b/)
    assert.match(autoSubmitSrc, /AUTO_SUBMIT_WINDOW_MINUTES\s*=\s*15/)
    assert.match(
      autoSubmitSrc,
      /isInEasternActionWindow\(AUTO_SUBMIT_WINDOW_HOUR,\s*AUTO_SUBMIT_WINDOW_MINUTE,\s*AUTO_SUBMIT_WINDOW_MINUTES\)/,
    )
  })

  for (const { name, src } of handlers) {
    test(`${name}: the window check is gated behind "scheduled &&" — a human Admin's POST is never restricted by it`, () => {
      assert.match(src, /if\s*\(scheduled\s*&&\s*!isInEasternActionWindow\(/)
    })

    test(`${name}: the window check occurs before resolveDryRun and before any action-related work`, () => {
      const gateIndex = src.indexOf('isInEasternActionWindow(')
      const dryRunIndex = src.indexOf('resolveDryRun(')
      assert.ok(gateIndex !== -1, 'window check not found')
      assert.ok(dryRunIndex !== -1, 'resolveDryRun call not found')
      assert.ok(gateIndex < dryRunIndex, 'window check must occur before resolveDryRun')
    })

    test(`${name}: the outside-window response is a safe 200 no-op that reveals no secrets`, () => {
      const gateBlockMatch = src.match(/if\s*\(scheduled[^{]*\{([\s\S]*?)\n\s*\}/)
      assert.ok(gateBlockMatch, 'could not locate the window-check block')
      const block = gateBlockMatch[1]
      assert.match(block, /res\.status\(200\)/)
      assert.match(block, /skipped:\s*true/)
      assert.match(block, /reason:\s*'outside_action_window'/)
      // No env var or secret-shaped value is ever interpolated into this
      // response block.
      assert.equal(/process\.env/.test(block), false)
    })
  }
})

describe('Step 7 — reminder_deliveries wiring (reminders.ts only)', () => {
  test('the scheduler outside-window no-op still occurs before any ledger work', () => {
    const windowIndex = remindersSrc.indexOf('isInEasternActionWindow(')
    // Matches the actual call site (with its opening paren and argument),
    // not the `import { processReminderTarget }` line, which always
    // precedes everything else in the file regardless.
    const claimCallIndex = remindersSrc.indexOf('await processReminderTarget(')
    assert.ok(windowIndex !== -1 && claimCallIndex !== -1)
    assert.ok(windowIndex < claimCallIndex, 'the action-window check must occur before any reference to ledger/claim work')
  })

  test('dry-run returns before any claim/ledger work is ever reached', () => {
    const dryRunReturnIndex = remindersSrc.indexOf('if (dryRun) {')
    const claimCallIndex = remindersSrc.indexOf('await processReminderTarget(')
    assert.ok(dryRunReturnIndex !== -1 && claimCallIndex !== -1)
    assert.ok(dryRunReturnIndex < claimCallIndex, 'the dry-run early return must occur before the claim/processing loop')
  })

  test('the privileged service-client ledger functions are used, not the request-scoped supabase client, for claim/resolve calls', () => {
    assert.match(remindersSrc, /claim:\s*claimReminderDelivery/)
    assert.match(remindersSrc, /resolveSent:\s*resolveReminderDeliverySent/)
    assert.match(remindersSrc, /resolveFailed:\s*resolveReminderDeliveryFailed/)
    // These are imported from supabaseServiceClient.js (the privileged
    // client), not called as methods on the `supabase` destructured from
    // `auth` (the request-scoped, RLS-gated client used for
    // fetchManagersForWeek).
    assert.match(remindersSrc, /from '\.\/_lib\/supabaseServiceClient\.js'/)
  })

  test("the per-item loop has no break/return that would abort processing of remaining managers on one manager's outcome", () => {
    const loopMatch = remindersSrc.match(/for \(const item of preview\) \{([\s\S]*?)\n {4}\}/)
    assert.ok(loopMatch, 'could not locate the per-item loop')
    const loopBody = loopMatch[1]
    assert.equal(/\bbreak\b/.test(loopBody), false, 'loop body must not break out early')
    assert.equal(/\breturn\b/.test(loopBody), false, 'loop body must not return out of the handler early')
  })

  test('the "no email on file" skip path is unchanged and never reaches the ledger', () => {
    assert.match(remindersSrc, /if \(!item\.email\) \{/)
    const skipBlockMatch = remindersSrc.match(/if \(!item\.email\) \{([\s\S]*?)\n\s*\}/)
    assert.ok(skipBlockMatch)
    assert.equal(skipBlockMatch[1].includes('processReminderTarget'), false)
  })
})

describe('Step 8 — auto-submit.ts wiring to the extracted runAutoSubmit logic', () => {
  test('the Step 6 window check still occurs before runAutoSubmit is ever called', () => {
    const windowIndex = autoSubmitSrc.indexOf('isInEasternActionWindow(')
    const runCallIndex = autoSubmitSrc.indexOf('await runAutoSubmit(')
    assert.ok(windowIndex !== -1 && runCallIndex !== -1)
    assert.ok(windowIndex < runCallIndex, 'the action-window check must occur before runAutoSubmit is called')
  })

  test('runAutoSubmit is called with the dryRun flag threaded through unchanged', () => {
    assert.match(autoSubmitSrc, /runAutoSubmit\(query,\s*week\.weekStartDate,\s*dryRun\)/)
  })

  test('the update query still filters to status=\'draft\' only and sets submission_source=\'automatic\'', () => {
    assert.match(autoSubmitSrc, /\.eq\('status',\s*'draft'\)/)
    assert.match(autoSubmitSrc, /submission_source:\s*'automatic'/)
    assert.match(autoSubmitSrc, /status:\s*'submitted'/)
  })

  test('no direct .update( call remains inline in the handler — it goes through the query adapter', () => {
    // Exactly one .update( call should exist, inside the query object
    // passed to runAutoSubmit, not a second ad hoc one elsewhere.
    const updateCallCount = (autoSubmitSrc.match(/\.update\(/g) ?? []).length
    assert.equal(updateCallCount, 1, `expected exactly one .update( call in auto-submit.ts, found ${updateCallCount}`)
  })
})

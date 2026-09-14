// Run with: node --test api/_lib/reminderDelivery.test.ts
// No relative imports of its own beyond emailSender.ts (which has none
// either), so this runs directly via bare `node --test` — no scratch
// compile needed. Uses fakes only: no real Supabase call, no real email
// provider, no real reminder execution.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  processReminderTarget,
  sanitizeSendFailureReason,
  normalizeProviderMessageId,
  type ReminderDeliveryClaim,
  type ReminderDeliveryDeps,
} from './reminderDelivery.ts'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { EmailSendResult } from './emailSender.ts'

const WEEK = '2099-01-05'

function target(managerId: string) {
  return { managerId, email: `${managerId}@example.invalid`, subject: 'Reminder', body: 'body' }
}

// A stateful fake ledger: mimics claim_reminder_delivery/resolve_* closely
// enough for these tests — one row per (managerId, week), a claim_token
// that changes on every successful (re)claim, and resolves that check the
// token like the real RPCs do.
function makeFakeLedger() {
  const rows = new Map<
    string,
    { deliveryId: number; claimToken: string; status: 'pending' | 'sent' | 'failed'; providerMessageId: string | null }
  >()
  let nextId = 1
  let nextTokenSuffix = 1
  const calls = { claim: [] as string[], resolveSent: [] as unknown[], resolveFailed: [] as unknown[] }

  const claim: ReminderDeliveryDeps['claim'] = async (managerId, weekStartDate) => {
    calls.claim.push(managerId)
    const key = `${managerId}:${weekStartDate}`
    const existing = rows.get(key)
    if (existing && existing.status !== 'failed') {
      // 'sent' or fresh 'pending' -> not claimable, matching the real RPC.
      if (existing.status === 'sent') return null
      return null
    }
    const token = `token-${nextTokenSuffix++}`
    const deliveryId = existing ? existing.deliveryId : nextId++
    rows.set(key, { deliveryId, claimToken: token, status: 'pending', providerMessageId: null })
    return { deliveryId, claimToken: token, attemptCount: 1 }
  }

  const resolveSent: ReminderDeliveryDeps['resolveSent'] = async (deliveryId, claimToken, providerMessageId) => {
    calls.resolveSent.push({ deliveryId, claimToken, providerMessageId })
    for (const row of rows.values()) {
      if (row.deliveryId === deliveryId) {
        if (row.claimToken !== claimToken) return false
        row.status = 'sent'
        row.providerMessageId = providerMessageId
        return true
      }
    }
    return false
  }

  const resolveFailed: ReminderDeliveryDeps['resolveFailed'] = async (deliveryId, claimToken) => {
    calls.resolveFailed.push({ deliveryId, claimToken })
    for (const row of rows.values()) {
      if (row.deliveryId === deliveryId) {
        if (row.claimToken !== claimToken) return false
        row.status = 'failed'
        return true
      }
    }
    return false
  }

  return { rows, calls, claim, resolveSent, resolveFailed }
}

describe('normalizeProviderMessageId', () => {
  test('a real id is trimmed and passed through', () => {
    assert.equal(normalizeProviderMessageId('  real-id-1  '), 'real-id-1')
    assert.equal(normalizeProviderMessageId('real-id-2'), 'real-id-2')
  })

  test('absent, empty, or whitespace-only maps to null — never a fabricated placeholder', () => {
    assert.equal(normalizeProviderMessageId(undefined), null)
    assert.equal(normalizeProviderMessageId(''), null)
    assert.equal(normalizeProviderMessageId('   '), null)
  })
})

describe('sanitizeSendFailureReason', () => {
  test('never includes any sender-supplied text — fixed, generic reasons only', () => {
    assert.equal(sanitizeSendFailureReason('skipped'), 'Email not delivered: sender reported skipped/test-mode/disabled.')
    assert.equal(sanitizeSendFailureReason('failed'), 'Email provider reported failure while sending the reminder.')
  })
})

describe('processReminderTarget', () => {
  test('fresh claim -> provider success -> resolved sent', async () => {
    const ledger = makeFakeLedger()
    const sendCalls: unknown[] = []
    const send = async (msg: { to: string }): Promise<EmailSendResult> => {
      sendCalls.push(msg)
      return { to: msg.to, status: 'sent', detail: 'delivered', providerMessageId: 'msg-123' }
    }

    const outcome = await processReminderTarget(target('mgr-1'), WEEK, { ...ledger, send })

    assert.equal(outcome.status, 'sent')
    assert.equal(sendCalls.length, 1)
    assert.equal(ledger.calls.resolveSent.length, 1)
    assert.equal(ledger.calls.resolveFailed.length, 0)
    assert.equal(ledger.rows.get('mgr-1:' + WEEK)?.status, 'sent')
    assert.equal(ledger.rows.get('mgr-1:' + WEEK)?.providerMessageId, 'msg-123')
  })

  test('successful send WITH a real provider id -> resolved sent with that exact id', async () => {
    const ledger = makeFakeLedger()
    const send = async (msg: { to: string }): Promise<EmailSendResult> => ({
      to: msg.to,
      status: 'sent',
      detail: 'delivered',
      providerMessageId: '  real-provider-id-789  ', // deliberately padded, to confirm trimming
    })

    const outcome = await processReminderTarget(target('mgr-1'), WEEK, { ...ledger, send })

    assert.equal(outcome.status, 'sent')
    const call = ledger.calls.resolveSent[0] as { providerMessageId: string | null }
    assert.equal(call.providerMessageId, 'real-provider-id-789')
    assert.equal(ledger.rows.get('mgr-1:' + WEEK)?.providerMessageId, 'real-provider-id-789')
  })

  test('successful send WITHOUT a provider id -> still resolved sent, with null (never fabricated)', async () => {
    const ledger = makeFakeLedger()
    const send = async (msg: { to: string }): Promise<EmailSendResult> => ({
      to: msg.to,
      status: 'sent',
      detail: 'delivered',
      // providerMessageId intentionally omitted
    })

    const outcome = await processReminderTarget(target('mgr-1'), WEEK, { ...ledger, send })

    assert.equal(outcome.status, 'sent', 'a genuinely sent email must still resolve as sent even with no provider id')
    const call = ledger.calls.resolveSent[0] as { providerMessageId: string | null }
    assert.equal(call.providerMessageId, null)
    assert.equal(ledger.rows.get('mgr-1:' + WEEK)?.providerMessageId, null)
  })

  test('duplicate/no claim -> send is never called', async () => {
    const ledger = makeFakeLedger()
    // Pre-claim it (simulating a concurrent invocation that already owns this row).
    await ledger.claim('mgr-1', WEEK)

    let sendCallCount = 0
    const send = async (): Promise<EmailSendResult> => {
      sendCallCount++
      return { to: 'x', status: 'sent', detail: 'delivered' }
    }

    const outcome = await processReminderTarget(target('mgr-1'), WEEK, { ...ledger, send })

    assert.equal(outcome.status, 'skipped')
    assert.equal(sendCallCount, 0, 'send must never be called when no claim was obtained')
    assert.equal(ledger.calls.resolveSent.length, 0)
    assert.equal(ledger.calls.resolveFailed.length, 0)
  })

  test('provider failure -> resolved failed', async () => {
    const ledger = makeFakeLedger()
    const send = async (msg: { to: string }): Promise<EmailSendResult> => ({
      to: msg.to,
      status: 'failed',
      detail: 'SMTP timeout',
    })

    const outcome = await processReminderTarget(target('mgr-1'), WEEK, { ...ledger, send })

    assert.equal(outcome.status, 'failed')
    assert.equal(ledger.calls.resolveFailed.length, 1)
    assert.equal(ledger.calls.resolveSent.length, 0)
    assert.equal(ledger.rows.get('mgr-1:' + WEEK)?.status, 'failed')
  })

  test('test-mode/skipped sender is never resolved as sent', async () => {
    const ledger = makeFakeLedger()
    const send = async (msg: { to: string }): Promise<EmailSendResult> => ({
      to: msg.to,
      status: 'skipped',
      detail: 'Test mode — no email provider is configured yet; nothing was actually sent.',
    })

    const outcome = await processReminderTarget(target('mgr-1'), WEEK, { ...ledger, send })

    assert.equal(outcome.status, 'skipped')
    assert.equal(ledger.calls.resolveSent.length, 0, 'resolve_reminder_delivery_sent must never be called for a skipped send')
    assert.equal(ledger.calls.resolveFailed.length, 1, 'a skipped send should still resolve the claim (as failed) so it is retryable')
    assert.equal(ledger.rows.get('mgr-1:' + WEEK)?.status, 'failed')
  })

  test('stale-token resolve (resolveSent returns false) is handled safely, not reported as success', async () => {
    const ledger = makeFakeLedger()
    const send = async (msg: { to: string }): Promise<EmailSendResult> => ({ to: msg.to, status: 'sent', detail: 'delivered' })
    // Force resolveSent to report a stale/lost claim regardless of token.
    const resolveSent: ReminderDeliveryDeps['resolveSent'] = async () => false

    const outcome = await processReminderTarget(target('mgr-1'), WEEK, { ...ledger, send, resolveSent })

    assert.equal(outcome.status, 'failed')
    assert.match(outcome.detail, /no longer valid/)
  })

  test('an unexpected exception from send is caught, resolved as failed, and never propagates', async () => {
    const ledger = makeFakeLedger()
    const send = async (): Promise<EmailSendResult> => {
      throw new Error('network exploded')
    }

    const outcome = await processReminderTarget(target('mgr-1'), WEEK, { ...ledger, send })

    assert.equal(outcome.status, 'failed')
    assert.equal(ledger.calls.resolveFailed.length, 1)
    // The raw exception message must never leak into the stored reason or
    // the returned detail.
    assert.equal(outcome.detail.includes('network exploded'), false)
  })

  test('multiple eligible managers are processed independently', async () => {
    const ledger = makeFakeLedger()
    const send = async (msg: { to: string }): Promise<EmailSendResult> => ({ to: msg.to, status: 'sent', detail: 'delivered' })

    const [a, b] = await Promise.all([
      processReminderTarget(target('mgr-a'), WEEK, { ...ledger, send }),
      processReminderTarget(target('mgr-b'), WEEK, { ...ledger, send }),
    ])

    assert.equal(a.status, 'sent')
    assert.equal(b.status, 'sent')
    assert.equal(ledger.rows.get('mgr-a:' + WEEK)?.status, 'sent')
    assert.equal(ledger.rows.get('mgr-b:' + WEEK)?.status, 'sent')
    assert.equal(ledger.calls.claim.length, 2)
  })

  test("one manager's failure does not affect another manager's outcome", async () => {
    const ledger = makeFakeLedger()
    const send = async (msg: { to: string }): Promise<EmailSendResult> => {
      if (msg.to.startsWith('mgr-fail')) throw new Error('boom')
      return { to: msg.to, status: 'sent', detail: 'delivered' }
    }

    const failing = await processReminderTarget(target('mgr-fail'), WEEK, { ...ledger, send })
    const succeeding = await processReminderTarget(target('mgr-ok'), WEEK, { ...ledger, send })

    assert.equal(failing.status, 'failed')
    assert.equal(succeeding.status, 'sent')
  })
})

describe('no fabricated provider-id sentinel in production code', () => {
  // Scoped to the two production files only — this test file's own
  // detection logic necessarily mentions the sentinel strings by name to
  // check for them, which is not the same as generating one as behavior.
  test('reminderDelivery.ts and supabaseServiceClient.ts never fabricate "unknown"/"n/a" as a provider id', () => {
    const dir = fileURLToPath(new URL('.', import.meta.url))
    const files = ['reminderDelivery.ts', 'supabaseServiceClient.ts']
    for (const file of files) {
      const src = readFileSync(dir + file, 'utf8')
      assert.equal(src.includes("?? 'unknown'"), false, `${file} still falls back to a fabricated 'unknown' provider id`)
      assert.equal(/providerMessageId\s*\?\?\s*['"]/.test(src), false, `${file} still substitutes a fabricated placeholder for a missing provider id`)
    }
  })
})

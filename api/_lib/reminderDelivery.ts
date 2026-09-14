import type { EmailSendResult } from './emailSender.js'

// Extracted from api/reminders.ts's send loop specifically so this decision
// logic (claim -> send -> resolve, and every outcome branch) is directly
// unit-testable with injected fakes — reminders.ts itself has a deep
// transitive import graph that Node's bare runtime can't resolve directly
// (see api/scheduler-endpoints.test.ts), but this module has none.

export interface ReminderSendTarget {
  managerId: string
  email: string
  subject: string
  body: string
}

export interface ReminderDeliveryClaim {
  deliveryId: number
  claimToken: string
  attemptCount: number
}

export interface ReminderDeliveryDeps {
  claim: (managerId: string, weekStartDate: string) => Promise<ReminderDeliveryClaim | null>
  send: (message: { to: string; subject: string; body: string }) => Promise<EmailSendResult>
  // null means the provider genuinely didn't give us one — never fabricate
  // a placeholder value here (see normalizeProviderMessageId).
  resolveSent: (deliveryId: number, claimToken: string, providerMessageId: string | null) => Promise<boolean>
  resolveFailed: (deliveryId: number, claimToken: string, sanitizedError: string) => Promise<boolean>
}

export interface ReminderDeliveryOutcome {
  managerId: string
  to: string
  status: EmailSendResult['status']
  detail: string
}

// Never includes any sender-supplied free text — a real provider's own
// error detail could, in principle, echo back something unexpected — only a
// fixed, generic reason keyed on the known EmailSendResult status enum, so
// nothing beyond "which of these two things happened" can ever reach the
// ledger's last_error column.
export function sanitizeSendFailureReason(status: 'skipped' | 'failed'): string {
  return status === 'skipped'
    ? 'Email not delivered: sender reported skipped/test-mode/disabled.'
    : 'Email provider reported failure while sending the reminder.'
}

// Trims whitespace and maps "no real id" (absent, empty, or
// whitespace-only) to null — never fabricates a placeholder like "unknown"
// or "n/a". A genuinely sent email must still resolve as sent even when the
// provider gave no id; inventing one here would be indistinguishable from a
// real id later, and marking a real success as failed just because the id
// is missing would make the next invocation retry and risk a duplicate
// delivery.
export function normalizeProviderMessageId(providerMessageId: string | undefined): string | null {
  const trimmed = providerMessageId?.trim()
  return trimmed ? trimmed : null
}

// Claims a ledger row immediately before attempting to send, and resolves
// it based on the actual outcome — this is the one place that decides
// whether an attempt is recorded as sent, failed, or skipped:
//   - no claim obtained (already sent, or a recent/still-valid pending
//     claim) -> skip, never call send at all.
//   - send reports 'sent' -> resolve_reminder_delivery_sent. If that
//     returns false (the claim was reclaimed by someone else since —
//     stale/lost), this is reported as 'failed', never as a silent success.
//   - send reports 'skipped' or 'failed' -> resolve_reminder_delivery_failed
//     with a sanitized, fixed reason. Never resolved as 'sent'.
//   - send throws unexpectedly -> caught here, resolved as 'failed' with a
//     generic reason, so one manager's problem can never abort processing
//     of the others (see the loop in reminders.ts) and the claim is never
//     left stuck pending.
export async function processReminderTarget(
  target: ReminderSendTarget,
  weekStartDate: string,
  deps: ReminderDeliveryDeps,
): Promise<ReminderDeliveryOutcome> {
  const claim = await deps.claim(target.managerId, weekStartDate)
  if (!claim) {
    return {
      managerId: target.managerId,
      to: target.email,
      status: 'skipped',
      detail: 'Already claimed or already sent for this week.',
    }
  }

  let sendResult: EmailSendResult
  try {
    sendResult = await deps.send({ to: target.email, subject: target.subject, body: target.body })
  } catch {
    const reason = 'Unexpected error while attempting to send the reminder.'
    await deps.resolveFailed(claim.deliveryId, claim.claimToken, reason)
    return { managerId: target.managerId, to: target.email, status: 'failed', detail: reason }
  }

  if (sendResult.status === 'sent') {
    const resolved = await deps.resolveSent(
      claim.deliveryId,
      claim.claimToken,
      normalizeProviderMessageId(sendResult.providerMessageId),
    )
    if (!resolved) {
      return {
        managerId: target.managerId,
        to: target.email,
        status: 'failed',
        detail: 'Reminder was sent, but the delivery claim was no longer valid when recording the result (likely a concurrent retry).',
      }
    }
    return { managerId: target.managerId, to: target.email, status: 'sent', detail: sendResult.detail }
  }

  const reason = sanitizeSendFailureReason(sendResult.status)
  const resolved = await deps.resolveFailed(claim.deliveryId, claim.claimToken, reason)
  if (!resolved) {
    console.error(
      'reminderDelivery: resolve_reminder_delivery_failed did not affect any row (stale claim) for manager',
      target.managerId,
    )
  }
  return { managerId: target.managerId, to: target.email, status: sendResult.status, detail: sendResult.detail }
}

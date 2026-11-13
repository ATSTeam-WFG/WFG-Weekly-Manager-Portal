export interface EmailMessage {
  to: string
  subject: string
  body: string
}

export interface EmailSendResult {
  to: string
  status: 'sent' | 'skipped' | 'failed'
  detail: string
  // Set only on a genuine provider success — an opaque tracking id, never
  // sensitive. TestModeEmailSender never sets it, since it never actually
  // sends anything; a real provider implementation should populate it from
  // whatever id the provider itself returns.
  providerMessageId?: string
}

export interface EmailSender {
  send(message: EmailMessage): Promise<EmailSendResult>
}

// Server-only, non-secret configuration — a display name/address is not a
// credential, so a safe placeholder default is fine until it's configured.
// WEEKLY_UPDATES_FROM_EMAIL is the single approved company sender address
// (WeeklyUpdates@wfgtitle.com), shared conceptually across both the Friday
// reminder emails (wired here) and onboarding/invitation emails — see
// api/_lib/supabaseServiceClient.ts's inviteApprovedEmployee for why the
// invitation path cannot actually consume this same value in code: Supabase-
// hosted invite emails have no from-address parameter at all; that sender is
// configured entirely in the Supabase project's own Auth SMTP settings, not
// here. This function is intentionally not named "reminder"-anything, since
// the address it returns is not reminder-specific.
export function getWeeklyUpdatesFromEmail(): string {
  return process.env.WEEKLY_UPDATES_FROM_EMAIL || 'weekly-updates-test@example.com'
}

export function getReminderFromName(): string {
  return process.env.REMINDER_FROM_NAME || 'WFG OneReport Pulse (Test Sender)'
}

// Safe local/manual test path: this never delivers anywhere. Used whenever
// RESEND_API_KEY is not configured (see getEmailSender below) — which is
// the case everywhere right now, by design: no real email has been sent by
// this app yet, and none will be until that key is deliberately set.
export class TestModeEmailSender implements EmailSender {
  async send(message: EmailMessage): Promise<EmailSendResult> {
    console.log(
      `[TEST EMAIL — not actually sent]\nFrom: "${getReminderFromName()}" <${getWeeklyUpdatesFromEmail()}>\nTo: ${message.to}\nSubject: ${message.subject}\n\n${message.body}\n`,
    )
    return {
      to: message.to,
      status: 'skipped',
      detail: 'Test mode — no email provider is configured yet; nothing was actually sent.',
    }
  }
}

// Resend (https://resend.com) — chosen for this app because: a single
// HTTP POST with no SDK/dependency needed (consistent with this codebase's
// existing preference for calling provider APIs directly over `fetch`
// rather than adding a client library — see e.g. @supabase/supabase-js
// being the one exception, already a hard dependency for everything else
// this app does); a generous free tier appropriate for this app's low
// transactional volume (Friday reminders + the occasional email-change
// verification link, not bulk/marketing mail); and first-class support
// for a verified custom sending domain, which WEEKLY_UPDATES_FROM_EMAIL
// already models this app as having. Swapping providers later means
// implementing EmailSender once more and changing the one branch in
// getEmailSender() below — every call site (reminders.ts,
// requestEmailChangeVerification) is already written against the
// interface, not this class.
//
// RESEND_API_KEY is read here and ONLY here (mirrors this project's
// SUPABASE_SECRET_KEY discipline: a single named file is the only place
// permitted to reference each server secret) — server-only, never sent to
// the browser, never logged. A missing key is not an error; it is the
// current, intentional state of every environment until a key and
// approved recipients are configured (see getEmailSender below).
export class ResendEmailSender implements EmailSender {
  async send(message: EmailMessage): Promise<EmailSendResult> {
    const apiKey = process.env.RESEND_API_KEY
    if (!apiKey) {
      return { to: message.to, status: 'skipped', detail: 'RESEND_API_KEY is not configured — no email was sent.' }
    }

    let response: Response
    try {
      response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: `${getReminderFromName()} <${getWeeklyUpdatesFromEmail()}>`,
          to: [message.to],
          subject: message.subject,
          text: message.body,
        }),
      })
    } catch (err) {
      return { to: message.to, status: 'failed', detail: `Resend request failed: ${err instanceof Error ? err.message : String(err)}` }
    }

    if (!response.ok) {
      // Never surface the raw response body — it could echo back request
      // details (recipient, subject) into logs more verbosely than
      // intended, and a provider error page is not for an end user. The
      // status code alone is enough for an operator to look this up in
      // the provider's own dashboard.
      return { to: message.to, status: 'failed', detail: `Resend API returned ${response.status}.` }
    }

    const body = await response.json().catch(() => null)
    const providerMessageId = body && typeof body === 'object' && typeof (body as Record<string, unknown>).id === 'string' ? ((body as Record<string, unknown>).id as string) : undefined
    return { to: message.to, status: 'sent', detail: 'Sent via Resend.', providerMessageId }
  }
}

// Production must fail CLOSED, loudly, when no real provider is
// configured — never the same quiet 'skipped' status TestModeEmailSender
// reports elsewhere, which reads as "working as intended" in a log and
// could mask a genuine Production misconfiguration indefinitely. This is
// NOT request-aborting (the DB write that recorded a pending email
// change, or the roster entry for a new invite, already succeeded and
// stays valid either way) — it is a visibly wrong, unambiguous 'failed'
// result an operator will actually notice, rather than console.log noise
// nobody is watching in a real deployment.
class ProductionEmailNotConfiguredSender implements EmailSender {
  async send(message: EmailMessage): Promise<EmailSendResult> {
    return {
      to: message.to,
      status: 'failed',
      detail: 'PRODUCTION EMAIL PROVIDER NOT CONFIGURED — RESEND_API_KEY is missing. No email was sent.',
    }
  }
}

function isProductionEnvironment(): boolean {
  return process.env.VERCEL_ENV === 'production'
}

// Real delivery activates ONLY when RESEND_API_KEY is set. Local and
// Preview stay on TestModeEmailSender until a key is configured — an
// explicitly test-mode-labeled state, safe for controlled testing.
// Production never silently falls back to console-only delivery; see
// ProductionEmailNotConfiguredSender above. No recipient list or domain
// approval is implied by this code shipping; setting the key is a
// separate, deliberate step for whoever holds it.
export function getEmailSender(): EmailSender {
  if (process.env.RESEND_API_KEY) return new ResendEmailSender()
  if (isProductionEnvironment()) return new ProductionEmailNotConfiguredSender()
  return new TestModeEmailSender()
}

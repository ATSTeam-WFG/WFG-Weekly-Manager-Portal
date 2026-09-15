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
  return process.env.REMINDER_FROM_NAME || 'WFG Weekly Manager Reports (Test Sender)'
}

// Safe local/manual test path: this never delivers anywhere. No third-party
// email service is wired in until one is approved — swap the instance
// returned by getEmailSender() for a real implementation (e.g. an approved
// provider) behind the same EmailSender interface later; no call site needs
// to change.
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

export function getEmailSender(): EmailSender {
  return new TestModeEmailSender()
}

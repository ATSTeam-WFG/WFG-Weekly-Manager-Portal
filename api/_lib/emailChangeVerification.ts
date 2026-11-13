// Pure decision logic for finalizing a Sales Rep email-change verification
// link. No imports, no I/O — exhaustively, dynamically testable with
// plain `node --test`, mirroring this project's established pattern.

export interface PendingEmailChange {
  pendingEmail: string
  tokenHash: string
  requestedAt: string
}

export type EmailChangeVerificationDecision =
  | { action: 'not_found' } // no pending change exists for this profile (already verified, cancelled, or never requested)
  | { action: 'invalid_token' } // a pending change exists, but the provided token does not match its hash
  | { action: 'expired' }
  | { action: 'email_conflict' } // the pending email is now in use by a different account (changed since the request was made)
  | { action: 'finalize'; newEmail: string }

// tokenIsValid is computed by the caller via verifyEmailChangeToken
// (constant-time hash comparison) BEFORE calling this function — kept out
// of this pure function so the actual crypto comparison, and its
// constant-time property, is never duplicated or reimplemented here.
export function decideEmailChangeVerification(
  pending: PendingEmailChange | null,
  tokenIsValid: boolean,
  nowIso: string,
  expiryWindowMs: number,
  emailConflictExists: boolean,
): EmailChangeVerificationDecision {
  if (!pending) return { action: 'not_found' }
  if (!tokenIsValid) return { action: 'invalid_token' }
  const expiresAtIso = new Date(new Date(pending.requestedAt).getTime() + expiryWindowMs).toISOString()
  if (nowIso >= expiresAtIso) return { action: 'expired' }
  if (emailConflictExists) return { action: 'email_conflict' }
  return { action: 'finalize', newEmail: pending.pendingEmail }
}

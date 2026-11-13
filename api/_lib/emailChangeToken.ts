import { randomBytes, createHash, timingSafeEqual } from 'node:crypto'

// 32 random bytes (256 bits) — the raw token exists only in the one-time
// verification email and the link's own query string; it is never
// persisted anywhere. Only its hash is stored (see hashEmailChangeToken).
export function generateEmailChangeToken(): string {
  return randomBytes(32).toString('hex')
}

export function hashEmailChangeToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

// Constant-time comparison against the stored hash — never a plain ===,
// which would leak timing information about how many leading hex
// characters matched. A length mismatch (a malformed/tampered token)
// still costs an equal-time comparison against itself before returning
// false, same discipline as adminAuth.ts's timingSafeStringEqual.
export function verifyEmailChangeToken(token: string, storedHash: string): boolean {
  let computed: Buffer
  try {
    computed = Buffer.from(hashEmailChangeToken(token), 'hex')
  } catch {
    return false
  }
  const stored = Buffer.from(storedHash, 'hex')
  if (computed.length !== stored.length) {
    timingSafeEqual(computed, computed)
    return false
  }
  return timingSafeEqual(computed, stored)
}

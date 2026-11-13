// A best-effort, in-memory, per-Vercel-function-instance rate limiter —
// NOT a substitute for a shared/durable limit (this project's existing
// check_onboarding_request_rate_limit RPC is that, for the one flow it
// already covers; its own SQL definition isn't tracked in this repo's
// supabase/migrations, so this file deliberately does not try to reuse or
// extend it blind). Under Vercel's serverless model, concurrent/scaled
// instances each keep their own independent counts, and a cold start
// resets to zero — so a sufficiently distributed or patient attacker is
// not fully stopped by this alone. What it DOES meaningfully raise the
// bar against: a single naive script hammering one endpoint from one
// source in a tight loop, which is the realistic threat for a
// verification-link endpoint whose real security boundary is already the
// token's own 256 bits of entropy (not an email/id guessing surface the
// way request-access.ts's rate limit protects against). A proper
// shared/durable limiter (a new, reviewed migration, or an edge-level
// product like Vercel's own rate limiting) is the correct follow-up if
// this endpoint's abuse profile ever turns out to need more than this.
const WINDOW_MS = 60_000
const MAX_ATTEMPTS_PER_WINDOW = 20

const attemptsByKey = new Map<string, number[]>()

export function isRateLimited(key: string, now: number = Date.now()): boolean {
  const timestamps = (attemptsByKey.get(key) ?? []).filter((t) => now - t < WINDOW_MS)
  timestamps.push(now)
  attemptsByKey.set(key, timestamps)
  // Opportunistic cleanup so this Map can never grow unbounded across the
  // lifetime of one warm instance — only ever touches the key just used.
  if (timestamps.length === 1 && attemptsByKey.size > 10_000) {
    for (const [k, v] of attemptsByKey) {
      if (v.every((t) => now - t >= WINDOW_MS)) attemptsByKey.delete(k)
    }
  }
  return timestamps.length > MAX_ATTEMPTS_PER_WINDOW
}

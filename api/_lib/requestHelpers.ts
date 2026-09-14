// Shared by every admin api/*.ts handler that supports both a manual POST
// (human Admin) and a scheduled GET (cron) invocation.

import { createHash } from 'node:crypto'

// Verified against Vercel's own docs (https://vercel.com/docs/headers/request-headers,
// "x-forwarded-for" — retrieved 2026-09-04): Vercel overwrites this header
// with the IP it verified itself and does not forward client-supplied
// values, specifically to prevent spoofing. x-vercel-forwarded-for is
// preferred per the same page since it stays correct even if a proxy is
// later placed in front of Vercel. Falls back to a fixed 'unknown' bucket
// when neither header is present, which is always true in local dev (no
// Vercel edge sits in front of the Vite dev server). The raw IP is never
// returned, logged, or stored anywhere — only its SHA-256 hash.
//
// Re-review this if the project's Vercel plan ever enables the Enterprise
// "Trusted Proxy" feature, which is explicitly designed to let a fronting
// proxy's own X-Forwarded-For value through.
export function getClientIpHash(headers: Record<string, string | string[] | undefined>): string {
  const raw = headers['x-vercel-forwarded-for'] ?? headers['x-forwarded-for']
  const value = Array.isArray(raw) ? raw[0] : raw
  const parts = (value ?? '').split(',').map((p) => p.trim()).filter(Boolean)
  const ip = parts.length > 0 ? parts[parts.length - 1] : 'unknown'
  return createHash('sha256').update(ip).digest('hex')
}

export function parseDryRunFromQuery(url: string | undefined): boolean | null {
  if (!url) return null
  try {
    const parsed = new URL(url, 'http://localhost')
    const raw = parsed.searchParams.get('dryRun')
    if (raw === null) return null
    return raw === 'true'
  } catch {
    return null
  }
}

// Resolves the effective dryRun flag. Human-Admin requests default to a safe
// preview (dryRun=true) unless they explicitly opt out — unchanged from
// before Feature 6B. A scheduler-authenticated request defaults the other
// way: it defaults to actually running the action (that's the job's whole
// purpose, and a real production trigger shouldn't depend on remembering to
// pass dryRun:false), but can still be told to preview via an explicit flag
// for safely testing the scheduler auth chain locally.
export function resolveDryRun(options: { isSchedulerRequest: boolean; body: unknown; url: string | undefined }): boolean {
  const { isSchedulerRequest, body, url } = options
  const bodyRecord = (body ?? {}) as { dryRun?: unknown }
  const bodyDryRun = typeof bodyRecord.dryRun === 'boolean' ? bodyRecord.dryRun : null
  const queryDryRun = parseDryRunFromQuery(url)
  const explicitDryRun = bodyDryRun ?? queryDryRun

  return isSchedulerRequest ? explicitDryRun === true : explicitDryRun !== false
}

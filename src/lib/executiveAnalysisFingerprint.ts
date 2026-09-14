import type { PeriodManagerEntry } from './reportsAnalyticsService.js'

// The one place the "what did the AI see" snapshot is defined — imported by
// both api/executive-summary.ts (to compute and store it at generation
// time) and the client (to recompute and compare at display time), so the
// two calculations can never drift apart.

// A legacy week's canonical shape is unchanged from before V2 existed —
// exactly the four legacy fields, nothing more. This is deliberate: every
// already-persisted analysis's stored fingerprint was computed over this
// exact shape, so a legacy week must keep hashing to the identical value it
// always has, or every existing Gene-facing analysis would falsely show as
// "content changed" the moment this ships, despite nothing having changed.
interface LegacyFingerprintFields {
  topPriorities: string
  wins: string
  challenges: string
  nextWeekPriorities: string
}

// A V2 week additionally contributes its five real fields — so an edit to
// any of them (including one with no legacy-shaped analog, like OKR Notes)
// is correctly detected as a content change.
interface V2FingerprintFields {
  whatMattersNow: string[]
  lookingAroundCorner: string[]
  nextWeekPriorities: string[]
  otherNotableItems: string
  okrNotes: string
}

export type FingerprintSourceEntry = { managerId: string; weekStartDate: string } & (
  LegacyFingerprintFields | V2FingerprintFields
)

// Flattens the manager->weeks grouping used everywhere else in this app
// into one row per (manager, week) — the unit a content change actually
// happens at, and the unit that needs to be individually sortable for a
// deterministic canonical order below.
//
// Deliberately no "version" marker is added to the object itself — a legacy
// week's contribution here must be byte-for-byte identical to what this
// function produced before V2 existed (managerId, weekStartDate, and exactly
// the four legacy fields), so every already-persisted analysis's stored
// fingerprint stays valid. A V2 week's own five distinct field names are
// already enough to make its contribution distinguishable from a legacy
// week's, with no extra key required.
export function entriesToFingerprintSource(entries: PeriodManagerEntry[]): FingerprintSourceEntry[] {
  return entries.flatMap((entry) =>
    entry.weeks.map((week) => ({
      managerId: entry.managerId,
      weekStartDate: week.weekStartDate,
      ...week.content.sections,
    })),
  )
}

// Deterministic regardless of fetch order — sorted before serializing, so a
// report being added/removed/edited, or the set of submitters for a week
// changing, always changes this string. JSON.stringify over sorted plain
// objects avoids any custom delimiter/escaping scheme that could ambiguously
// collide with report content.
export function buildCanonicalSource(entries: FingerprintSourceEntry[]): string {
  const sorted = [...entries].sort((a, b) =>
    a.managerId === b.managerId ? a.weekStartDate.localeCompare(b.weekStartDate) : a.managerId.localeCompare(b.managerId),
  )
  return JSON.stringify(sorted)
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

// The standard Web Crypto API — available as a runtime global in both every
// browser and this project's Node runtime (Node 19+), so server and client
// use the literal same call, not just the same canonicalization step before
// it. Accessed via a minimal local shape rather than the ambient `crypto`
// global type, since api/*.ts's tsconfig has no DOM lib and so doesn't know
// about it — the runtime object is identical either way.
interface MinimalSubtleCrypto {
  digest(algorithm: string, data: Uint8Array): Promise<ArrayBuffer>
}
const webCrypto = (globalThis as unknown as { crypto: { subtle: MinimalSubtleCrypto } }).crypto

export async function hashCanonicalSource(canonicalSource: string): Promise<string> {
  const encoded = new TextEncoder().encode(canonicalSource)
  const digest = await webCrypto.subtle.digest('SHA-256', encoded)
  return toHex(digest)
}

// Only this hex digest is ever persisted — never the raw canonical string,
// and never raw report content.
export async function computeSourceFingerprint(entries: PeriodManagerEntry[]): Promise<string> {
  return hashCanonicalSource(buildCanonicalSource(entriesToFingerprintSource(entries)))
}

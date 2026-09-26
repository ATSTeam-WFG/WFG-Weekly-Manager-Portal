// Run with: node --test src/lib/leadershipReportDraftPersistenceWiring.test.ts
//
// Leadership Report — leadershipReportDraftService.ts, the shared client
// data layer used by both LeadershipReportCurrent.tsx (current week's
// editable draft + previous-work read) and LeadershipReportHistory.tsx
// (arbitrary past week, read-only). This file imports supabaseClient.ts
// (import.meta.env), so it cannot be imported and executed directly under
// plain `node --test`; verified via source inspection instead, the
// established pattern used throughout this project.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const dir = path.dirname(fileURLToPath(import.meta.url))
const draftServiceSrc = readFileSync(path.join(dir, 'leadershipReportDraftService.ts'), 'utf8')

describe('leadershipReportDraftService.ts — save_leadership_report_draft is the only write path', () => {
  test('saveLeadershipReportDraft calls the RPC — no direct INSERT/UPDATE/DELETE against leadership_report_drafts exists anywhere in this module', () => {
    assert.match(draftServiceSrc, /supabase\.rpc\('save_leadership_report_draft', \{/)
    assert.equal(/\.insert\(/.test(draftServiceSrc), false, 'must never call .insert() directly')
    assert.equal(/\.update\(/.test(draftServiceSrc), false, 'must never call .update() directly')
    assert.equal(/\.delete\(/.test(draftServiceSrc), false, 'must never call .delete() directly')
  })

  test('fetchLeadershipReportDraft is a plain SELECT scoped by period_start_date, relying on existing RLS — reused as-is by both the Current tab and History', () => {
    assert.match(draftServiceSrc, /\.from\('leadership_report_drafts'\)/)
    assert.match(draftServiceSrc, /\.select\(/)
    assert.match(draftServiceSrc, /\.eq\('period_start_date', periodStartDate\)/)
    assert.match(draftServiceSrc, /\.maybeSingle\(\)/)
  })

  test('every RPC parameter is mapped with the exact p_ prefix save_leadership_report_draft expects', () => {
    const rpcCallStart = draftServiceSrc.indexOf("supabase.rpc('save_leadership_report_draft'")
    const rpcCallEnd = draftServiceSrc.indexOf('})', rpcCallStart)
    const rpcArgs = draftServiceSrc.slice(rpcCallStart, rpcCallEnd)
    assert.match(rpcArgs, /p_period_start_date: params\.periodStartDate/)
    assert.match(rpcArgs, /p_period_end_date: params\.periodEndDate/)
    assert.match(rpcArgs, /p_period_label: params\.periodLabel/)
    assert.match(rpcArgs, /p_source_analysis_id: params\.sourceAnalysisId/)
    assert.match(rpcArgs, /p_source_ats_fingerprint: params\.sourceAtsFingerprint/)
    assert.match(rpcArgs, /p_content: params\.content/)
  })

  test('audit fields are never sent by the client — created_by/updated_by/created_at/updated_at never appear as outgoing RPC arguments', () => {
    const rpcCallStart = draftServiceSrc.indexOf("supabase.rpc('save_leadership_report_draft'")
    const rpcCallEnd = draftServiceSrc.indexOf('})', rpcCallStart)
    const rpcArgs = draftServiceSrc.slice(rpcCallStart, rpcCallEnd)
    assert.equal(/p_created_by|p_updated_by|p_created_at|p_updated_at/.test(rpcArgs), false)
  })

  test('this module never queries or writes executive_analyses/executive_analysis_versions as a table target', () => {
    // The bare substring appears in an explanatory doc comment (this module
    // "never writes to executive_analyses/executive_analysis_versions") —
    // scoped here to the actual .from(...) call shape, not the whole file,
    // so that comment can't produce a false positive.
    assert.equal(/\.from\(['"]executive_analys/.test(draftServiceSrc), false)
  })
})

describe('leadershipReportDraftService.ts — fetchPreviousLeadershipReportDraft is the nearest-prior-week, owner-blind read', () => {
  test('queries strictly before the given week, ordered descending, limited to one row', () => {
    const fnStart = draftServiceSrc.indexOf('export async function fetchPreviousLeadershipReportDraft')
    const fnEnd = draftServiceSrc.indexOf('\n}', fnStart)
    const fnBody = draftServiceSrc.slice(fnStart, fnEnd)
    assert.match(fnBody, /\.from\('leadership_report_drafts'\)/)
    assert.match(fnBody, /\.lt\('period_start_date', beforePeriodStartDate\)/)
    assert.match(fnBody, /\.order\('period_start_date', \{ ascending: false \}\)/)
    assert.match(fnBody, /\.limit\(1\)/)
    assert.match(fnBody, /\.maybeSingle\(\)/)
  })

  test('accepts no owner_id parameter, and never filters by owner_id — RLS alone scopes this to the caller', () => {
    const signatureLine = draftServiceSrc.match(/export async function fetchPreviousLeadershipReportDraft\(([^)]*)\)/)
    assert.ok(signatureLine)
    assert.equal(/owner/i.test(signatureLine[1]), false)

    const fnStart = draftServiceSrc.indexOf('export async function fetchPreviousLeadershipReportDraft')
    const fnEnd = draftServiceSrc.indexOf('\n}', fnStart)
    const fnBody = draftServiceSrc.slice(fnStart, fnEnd)
    assert.equal(/\.eq\(['"]owner_id/.test(fnBody), false)
  })
})

describe('leadershipReportDraftService.ts — fetchIsLeadershipReportAuthorized is a read-only, server-backed UX check', () => {
  test('calls the same is_leadership_report_authorized() function the RLS policy and Save Draft RPC both rely on — never a hard-coded allowlist', () => {
    assert.match(draftServiceSrc, /supabase\.rpc\('is_leadership_report_authorized'\)/)
    assert.equal(/agrace@|grebadow@|['"]Andria['"]|['"]Gene['"]/.test(draftServiceSrc), false)
  })

  test('fails closed (false) on any error, rather than assuming authorized', () => {
    const fnStart = draftServiceSrc.indexOf('export async function fetchIsLeadershipReportAuthorized')
    const fnEnd = draftServiceSrc.indexOf('\n}', fnStart)
    const fnBody = draftServiceSrc.slice(fnStart, fnEnd)
    assert.match(fnBody, /if \(error\) \{\s*\n\s*console\.error\([^\n]*\)\s*\n\s*return false/)
  })
})

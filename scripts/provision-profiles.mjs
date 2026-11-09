// Dry-run-by-default profile pre-provisioning for the real Managers and
// Sales Reps already onboarded (Phase 1 / Phase 3) — the "Option A" fix for
// the onboarding sequencing problem (assign_sales_rep requires an active
// profiles row for both sides, which normally doesn't exist until first
// login). Calls the exact same createProfileFromApprovedEmployee function
// complete-profile.ts itself calls at real first login — no new
// account-creation logic, no new table, no RLS change.
//
// Data-driven, not a hardcoded roster: the worklist is derived live from
// approved_employees (role IN ('manager','sales_rep'), active, with an
// Auth account already created) MINUS anyone who already has a profiles
// row — so it can never re-embed (and risk drifting from) the 43-person
// roster a second time, and it naturally does nothing on a second run once
// everyone already has a profile.
//
// Usage:
//   node --import ./scripts/register-test-hooks.mjs scripts/provision-profiles.mjs            # dry run (default) — no writes
//   node --import ./scripts/register-test-hooks.mjs scripts/provision-profiles.mjs --execute   # real run, one record at a time, verified after each
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const EXECUTE = process.argv.includes('--execute')

const dir = path.dirname(fileURLToPath(import.meta.url))
const envPath = path.join(dir, '..', '.env.local')
for (const line of readFileSync(envPath, 'utf8').split('\n')) {
  const trimmed = line.trim()
  if (!trimmed || trimmed.startsWith('#')) continue
  const eq = trimmed.indexOf('=')
  if (eq === -1) continue
  const key = trimmed.slice(0, eq)
  const value = trimmed.slice(eq + 1)
  if (!(key in process.env)) process.env[key] = value
}

const EXPECTED_REF = 'asojatcycijoikeovibs'
if (!process.env.NEXT_PUBLIC_SUPABASE_URL?.includes(EXPECTED_REF)) {
  console.error(`REFUSING: NEXT_PUBLIC_SUPABASE_URL does not reference the confirmed PREVIEW project (${EXPECTED_REF}).`)
  process.exit(1)
}

const { createClient } = await import('@supabase/supabase-js')
const { createProfileFromApprovedEmployee } = await import('../api/_lib/supabaseServiceClient.ts')

const service = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, {
  auth: { persistSession: false },
})

console.log(`Target project ref: ${EXPECTED_REF}`)
console.log(`Mode: ${EXECUTE ? 'EXECUTE (will write)' : 'DRY RUN (no writes will be made)'}`)
console.log()

// 1. Every active, account-created Manager/Sales Rep roster row.
const { data: candidates, error: candidatesError } = await service
  .from('approved_employees')
  .select('full_name, email, email_normalized, portal_role, is_active, auth_user_id, submits_weekly_report')
  .in('portal_role', ['manager', 'sales_rep'])
  .eq('is_active', true)
  .not('auth_user_id', 'is', null)
  .order('portal_role', { ascending: true })
  .order('full_name', { ascending: true })

if (candidatesError) {
  console.error('FAILED to read approved_employees:', candidatesError.message)
  process.exit(1)
}

// 2. Who already has a profiles row — never touched, never overwritten.
const { data: existingProfiles, error: profilesError } = await service.from('profiles').select('id')
if (profilesError) {
  console.error('FAILED to read profiles:', profilesError.message)
  process.exit(1)
}
const existingProfileIds = new Set((existingProfiles ?? []).map((p) => p.id))

const toProvision = candidates.filter((c) => !existingProfileIds.has(c.auth_user_id))
const alreadyDone = candidates.filter((c) => existingProfileIds.has(c.auth_user_id))

console.log(`Candidates (active Manager/Sales Rep with an Auth account): ${candidates.length}`)
console.log(`Already have a profile (will be skipped, never overwritten): ${alreadyDone.length}`)
console.log(`To provision: ${toProvision.length}`)
console.log()

let created = 0
let failed = 0

for (const [i, employee] of toProvision.entries()) {
  const label = `[${i + 1}/${toProvision.length}] ${employee.full_name} <${employee.email}> (${employee.portal_role})`

  if (!EXECUTE) {
    console.log(`DRY RUN — would provision: ${label}`)
    continue
  }

  console.log(`Provisioning: ${label}`)
  const result = await createProfileFromApprovedEmployee(employee.auth_user_id, {
    id: employee.auth_user_id,
    fullName: employee.full_name,
    email: employee.email,
    emailNormalized: employee.email_normalized,
    portalRole: employee.portal_role,
    isActive: employee.is_active,
    submitsWeeklyReport: employee.submits_weekly_report,
    authUserId: employee.auth_user_id,
    title: null,
  })

  if (!result) {
    console.error(`FAILED: ${label} — createProfileFromApprovedEmployee returned null. Stopping.`)
    failed++
    break
  }

  // Verify immediately — id, role, is_active, email, submits_weekly_report
  // all match what was requested, and password_change_required on the
  // Auth side is completely untouched by this step.
  const { data: verifyRow, error: verifyError } = await service
    .from('profiles')
    .select('id, role, is_active, email, submits_weekly_report')
    .eq('id', employee.auth_user_id)
    .single()
  const { data: authUser } = await service.auth.admin.getUserById(employee.auth_user_id)

  const ok =
    !verifyError &&
    verifyRow?.id === employee.auth_user_id &&
    verifyRow?.role === employee.portal_role &&
    verifyRow?.is_active === true &&
    verifyRow?.email === employee.email_normalized &&
    verifyRow?.submits_weekly_report === employee.submits_weekly_report &&
    authUser?.user?.app_metadata?.password_change_required === true

  if (!ok) {
    console.error(`FAILED verification: ${label}`, { verifyRow, verifyError, passwordChangeRequired: authUser?.user?.app_metadata?.password_change_required })
    console.error('STOPPING — not provisioning any further records until this is reviewed.')
    failed++
    break
  }

  console.log(`VERIFIED OK: ${label}`)
  created++
}

console.log()
if (!EXECUTE) {
  console.log(`DRY RUN complete. ${toProvision.length} record(s) would be provisioned. Re-run with --execute to actually write.`)
} else {
  console.log(`EXECUTE complete. ${created} provisioned and verified, ${failed} failed, ${alreadyDone.length} already had a profile (skipped).`)
  if (failed > 0) process.exit(1)
}

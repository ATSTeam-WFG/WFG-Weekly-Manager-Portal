// LOCAL-ONLY proof of concept for the "pre-provision profiles" (Option A)
// approach. Hardcoded to the disposable local Supabase stack
// (127.0.0.1:54321) — never reads .env.local, so there is zero chance of
// this ever touching PREVIEW or production regardless of what that file
// contains. Exercises the REAL application functions directly (no
// reimplementation): addOrCreateManagerAccount, addOrCreateSalesRepAccount,
// lookupApprovedEmployeeByNormalizedEmail, createProfileFromApprovedEmployee,
// assign_sales_rep (via the DB), and the real complete-profile.ts handler.
import { createClient } from '@supabase/supabase-js'

const LOCAL_URL = 'http://127.0.0.1:54321'
// Read from the environment rather than hardcoding — `supabase status`
// prints these same local-stack keys for your own disposable container;
// export them before running this script:
//   export LOCAL_SUPABASE_PUBLISHABLE_KEY=<anon key from `supabase status`>
//   export LOCAL_SUPABASE_SECRET_KEY=<service_role key from `supabase status`>
const LOCAL_PUBLISHABLE = process.env.LOCAL_SUPABASE_PUBLISHABLE_KEY
const LOCAL_SECRET = process.env.LOCAL_SUPABASE_SECRET_KEY
const LOCAL_TEMP_PASSWORD = 'LocalPoc-Test-Only-Temp-987!'
const NEW_REAL_PASSWORD = 'LocalPoc-Test-Only-NewPw-654!'

// Hard refusal if anything ever points this at a real host.
if (!LOCAL_URL.includes('127.0.0.1') && !LOCAL_URL.includes('localhost')) {
  console.error('REFUSING: this script only runs against 127.0.0.1/localhost.')
  process.exit(1)
}

if (!LOCAL_PUBLISHABLE || !LOCAL_SECRET) {
  console.error(
    'REFUSING: LOCAL_SUPABASE_PUBLISHABLE_KEY and/or LOCAL_SUPABASE_SECRET_KEY are not set.\n' +
      "Export your local disposable stack's own keys (from `supabase status`) before running this script.",
  )
  process.exit(1)
}

process.env.NEXT_PUBLIC_SUPABASE_URL = LOCAL_URL
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = LOCAL_PUBLISHABLE
process.env.SUPABASE_SECRET_KEY = LOCAL_SECRET
process.env.EMPLOYEE_TEMP_PASSWORD = LOCAL_TEMP_PASSWORD

const {
  addOrCreateManagerAccount,
  addOrCreateSalesRepAccount,
  lookupApprovedEmployeeByNormalizedEmail,
  createProfileFromApprovedEmployee,
} = await import('../api/_lib/supabaseServiceClient.ts')
const completeProfileHandler = (await import('../api/onboarding/complete-profile.ts')).default

const results = []
function record(name, pass, detail) {
  results.push({ name, pass })
  console.log(`${pass ? 'PASS' : 'FAIL'}: ${name}${detail ? ' — ' + detail : ''}`)
  if (!pass) {
    console.error('STOPPING: a check failed. See above.')
    printSummary()
    process.exit(1)
  }
}

function printSummary() {
  const passed = results.filter((r) => r.pass).length
  console.log(`\n${passed}/${results.length} checks passed.`)
}

const service = createClient(LOCAL_URL, LOCAL_SECRET, { auth: { persistSession: false } })
const anon = () => createClient(LOCAL_URL, LOCAL_PUBLISHABLE, { auth: { persistSession: false } })

const MANAGER_EMAIL = 'localtest-manager@wfgtitle.com'
const REP_EMAIL = 'localtest-rep@wfgtitle.com'

async function psql(sql) {
  // Direct admin-role query against the local disposable Postgres via the
  // service client's own connection is not available for raw SQL/SET ROLE
  // simulation (PostgREST only exposes table/RPC access) — this helper
  // shells out to the already-running local container instead, exactly the
  // same mechanism every migration self-test in this engagement already
  // uses to simulate an authenticated session (SET ROLE authenticated +
  // request.jwt.claims), never a service-role REST bypass.
  const { execSync } = await import('node:child_process')
  return execSync(
    `docker exec -i supabase_db_wfg-phase1a-local-stack psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres -t -A 2>&1`,
    { input: sql, encoding: 'utf8' },
  )
}

// psql -t suppresses SELECT headers/footers but NOT transaction-control
// status tags (BEGIN/SET/COMMIT) — strip those before pulling the last
// real data row out of a multi-statement call's output.
function lastDataLine(output) {
  const lines = output
    .trim()
    .split('\n')
    .filter((l) => !['BEGIN', 'COMMIT', 'ROLLBACK', 'SET', 'RESET', 'DO'].includes(l.trim()))
  return lines[lines.length - 1] ?? ''
}

console.log('=== 1. Create synthetic Manager + Sales Rep via the real account-creation functions ===')
const mgrOutcome = await addOrCreateManagerAccount('LocalTest Manager', MANAGER_EMAIL)
record('Manager account created', mgrOutcome.status === 'created', mgrOutcome.status)
const repOutcome = await addOrCreateSalesRepAccount('LocalTest Rep', REP_EMAIL)
record('Sales Rep account created', repOutcome.status === 'created', repOutcome.status)

const mgrEmployee = await lookupApprovedEmployeeByNormalizedEmail(MANAGER_EMAIL)
const repEmployee = await lookupApprovedEmployeeByNormalizedEmail(REP_EMAIL)
record('Manager approved_employees row resolvable with auth_user_id', !!mgrEmployee?.authUserId)
record('Rep approved_employees row resolvable with auth_user_id', !!repEmployee?.authUserId)

console.log('\n=== 2. Pre-provision profiles via the real createProfileFromApprovedEmployee function ===')
const mgrProfile = await createProfileFromApprovedEmployee(mgrEmployee.authUserId, mgrEmployee)
record('Manager profile pre-provisioned', !!mgrProfile)
const repProfile = await createProfileFromApprovedEmployee(repEmployee.authUserId, repEmployee)
record('Rep profile pre-provisioned', !!repProfile)

console.log('\n=== 3. Verify both profiles: UUID, role, email, active, reporting attributes ===')
record('Manager profile id matches auth_user_id', mgrProfile.id === mgrEmployee.authUserId)
record('Manager profile role = manager', mgrProfile.role === 'manager')
record('Manager profile is_active = true', mgrProfile.isActive === true)
record('Manager profile submits_weekly_report = true', mgrProfile.submitsWeeklyReport === true)
record('Rep profile id matches auth_user_id', repProfile.id === repEmployee.authUserId)
record('Rep profile role = sales_rep', repProfile.role === 'sales_rep')
record('Rep profile is_active = true', repProfile.isActive === true)
record('Rep profile submits_weekly_report = false', repProfile.submitsWeeklyReport === false)

console.log('\n=== 4 & 8. Confirm password_change_required is still TRUE for both, immediately after profile creation, before any sign-in ===')
const { data: mgrAuthBefore } = await service.auth.admin.getUserById(mgrEmployee.authUserId)
const { data: repAuthBefore } = await service.auth.admin.getUserById(repEmployee.authUserId)
record(
  'Manager password_change_required still true after profile pre-provisioning',
  mgrAuthBefore.user.app_metadata.password_change_required === true,
)
record(
  'Rep password_change_required still true after profile pre-provisioning (not cleared merely by a profile existing)',
  repAuthBefore.user.app_metadata.password_change_required === true,
)

console.log('\n=== 5. An authenticated Admin can call assign_sales_rep legitimately (SET ROLE authenticated + simulated JWT, the same technique every migration self-test in this engagement uses — not a service-role bypass) ===')
const adminIdRow = await psql(`SELECT id FROM public.profiles WHERE role='admin' AND is_active=true LIMIT 1;`)
const adminId = adminIdRow.trim()
record('A real local admin profile exists to act as the authenticated caller', !!adminId)

const assignSql = `
BEGIN;
SET ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub','${adminId}')::text, true);
SELECT (public.assign_sales_rep('${repEmployee.authUserId}'::uuid, '${mgrEmployee.authUserId}'::uuid)).manager_id;
RESET ROLE;
COMMIT;
`
let assignResult
try {
  assignResult = lastDataLine(await psql(assignSql))
} catch (err) {
  assignResult = `ERROR: ${err.message}`
}
record('assign_sales_rep succeeded for an authenticated admin', assignResult === mgrEmployee.authUserId, assignResult)

console.log('\n=== 6. An unauthorized caller (the rep itself) cannot perform the same assignment ===')
const unauthorizedSql = `
BEGIN;
SET ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub','${repEmployee.authUserId}')::text, true);
DO $$
BEGIN
  PERFORM public.assign_sales_rep('${repEmployee.authUserId}'::uuid, '${mgrEmployee.authUserId}'::uuid);
  RAISE EXCEPTION 'UNEXPECTED_SUCCESS';
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM LIKE 'FORBIDDEN%' THEN RAISE NOTICE 'CORRECTLY_FORBIDDEN'; ELSE RAISE; END IF;
END $$;
RESET ROLE;
COMMIT;
`
const unauthorizedOut = await psql(unauthorizedSql)
record('Rep (unauthorized) was correctly refused with FORBIDDEN', unauthorizedOut.includes('CORRECTLY_FORBIDDEN'))

console.log('\n=== 7. Complete first-login password-change workflow, end to end ===')
const signInRes = await fetch(`${LOCAL_URL}/auth/v1/token?grant_type=password`, {
  method: 'POST',
  headers: { apikey: LOCAL_PUBLISHABLE, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: REP_EMAIL, password: LOCAL_TEMP_PASSWORD }),
})
const signInData = await signInRes.json()
record('Rep can sign in with the shared temp password', !!signInData.access_token)
record('Session reports password_change_required = true at sign-in', signInData.user?.app_metadata?.password_change_required === true)

const repClient = anon()
const { error: updateErr } = await repClient.auth.setSession({
  access_token: signInData.access_token,
  refresh_token: signInData.refresh_token,
})
record('Rep session established client-side', !updateErr)

const { error: pwErr } = await repClient.auth.updateUser({ password: NEW_REAL_PASSWORD })
record('Rep successfully sets their own real password (simulating CreatePassword.tsx)', !pwErr, pwErr?.message)

console.log('\n=== Invoking the REAL complete-profile.ts handler directly, with the rep\'s own bearer token ===')
let completeProfileResponse = null
let completeProfileStatus = null
const mockReq = { method: 'POST', headers: { authorization: `Bearer ${signInData.access_token}` }, body: {} }
const mockRes = {
  status(code) {
    completeProfileStatus = code
    return this
  },
  json(body) {
    completeProfileResponse = body
  },
}
await completeProfileHandler(mockReq, mockRes)
record('complete-profile.ts returned 200', completeProfileStatus === 200, JSON.stringify(completeProfileResponse))
record('complete-profile.ts took the idempotent "found" branch (status: created, correct role)', completeProfileResponse?.status === 'created' && completeProfileResponse?.role === 'sales_rep')

console.log('\n=== 8 (continued). password_change_required is cleared ONLY NOW, after the real password change ===')
const { data: repAuthAfter } = await service.auth.admin.getUserById(repEmployee.authUserId)
record('Rep password_change_required is now false, only after actually changing the password', repAuthAfter.user.app_metadata.password_change_required === false)

console.log('\n=== 9. Profile and assignment remain intact after onboarding ===')
const { data: repProfileAfter } = await service.from('profiles').select('*').eq('id', repEmployee.authUserId).single()
record('Rep profile role unchanged (sales_rep)', repProfileAfter.role === 'sales_rep')
record('Rep profile full_name unchanged', repProfileAfter.full_name === 'LocalTest Rep')
const { data: assignmentAfter } = await service
  .from('rep_manager_assignments')
  .select('manager_id, unassigned_at')
  .eq('rep_id', repEmployee.authUserId)
  .is('unassigned_at', null)
  .maybeSingle()
record('Assignment to the Manager is still active after onboarding', assignmentAfter?.manager_id === mgrEmployee.authUserId)

console.log('\n=== 10. RLS: the assigned Manager can see the rep\'s profile; an unrelated manager cannot ===')
const assignedMgrReadSql = `
BEGIN;
SET ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub','${mgrEmployee.authUserId}')::text, true);
SELECT count(*) FROM public.profiles WHERE id = '${repEmployee.authUserId}';
RESET ROLE;
COMMIT;
`
const assignedMgrCount = lastDataLine(await psql(assignedMgrReadSql))
record('Assigned Manager can read the rep\'s profile via RLS', assignedMgrCount === '1', assignedMgrCount)

// A genuinely UNRELATED manager (not admin — is_admin() is a separate,
// permissive policy that would independently allow an admin to read any
// profile, which would not actually test the assigned-rep-only EXISTS
// clause this policy depends on) proves the policy gates on the real
// assignment relationship, not merely on being authenticated.
const unrelatedManagerId = await psql(`SELECT id FROM public.profiles WHERE role='manager' AND is_active=true AND id != '${mgrEmployee.authUserId}' LIMIT 1;`)
const unrelatedManagerIdTrim = unrelatedManagerId.trim()
if (unrelatedManagerIdTrim) {
  const unrelatedSql = `
BEGIN;
SET ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub','${unrelatedManagerIdTrim}')::text, true);
SELECT count(*) FROM public.profiles WHERE id = '${repEmployee.authUserId}';
RESET ROLE;
COMMIT;
`
  const unrelatedCount = lastDataLine(await psql(unrelatedSql))
  record('An unrelated Manager CANNOT read the rep\'s profile via RLS', unrelatedCount === '0', unrelatedCount)
} else {
  console.log('SKIPPED: no unrelated active manager profile available on the local stack to test against.')
}

console.log('\n=== Cleanup: remove all synthetic data created by this proof of concept ===')
// auth.admin.deleteUser() was observed to report success without actually
// removing the row on this local GoTrue instance — direct SQL cleanup is
// used instead for reliability, same as every other cleanup step here.
await service.from('rep_manager_assignments').delete().eq('rep_id', repEmployee.authUserId)
await service.from('profiles').delete().in('id', [mgrEmployee.authUserId, repEmployee.authUserId])
await service.from('approved_employees').delete().in('email_normalized', [MANAGER_EMAIL, REP_EMAIL])
await psql(`DELETE FROM auth.users WHERE email IN ('${MANAGER_EMAIL}', '${REP_EMAIL}');`)
console.log('Cleanup complete.')

printSummary()

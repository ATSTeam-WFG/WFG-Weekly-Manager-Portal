// Run with: node --test api/_lib/adminUserManagementWiring.test.ts
//
// The api/admin/users/*.ts endpoints and supabaseServiceClient.ts all have
// real @supabase/supabase-js / privileged-client dependencies, so executing
// them directly here isn't safe — this verifies their wiring via source
// inspection instead, the same pattern already used elsewhere in this
// project (e.g. api/_lib/scheduler-endpoints.test.ts,
// api/_lib/reportsServiceLockWiring.test.ts) for files with a similar
// limitation. The pure decision logic these all delegate to is exhaustively,
// dynamically tested in adminUserManagement.test.ts.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const dir = path.dirname(fileURLToPath(import.meta.url))
const serviceClientSrc = readFileSync(path.join(dir, 'supabaseServiceClient.ts'), 'utf8')
const listSrc = readFileSync(path.join(dir, '..', 'admin', 'users', 'list.ts'), 'utf8')
const inviteSrc = readFileSync(path.join(dir, '..', 'admin', 'users', 'invite.ts'), 'utf8')
const createAccountSrc = readFileSync(path.join(dir, '..', 'admin', 'users', 'create-account.ts'), 'utf8')
const setActiveSrc = readFileSync(path.join(dir, '..', 'admin', 'users', 'set-active.ts'), 'utf8')
const updateSrc = readFileSync(path.join(dir, '..', 'admin', 'users', 'update.ts'), 'utf8')

describe('Admin authorization — every Admin User Management endpoint authenticates before any privileged action', () => {
  for (const [name, src] of [
    ['list.ts', listSrc],
    ['invite.ts', inviteSrc],
    ['create-account.ts', createAccountSrc],
    ['set-active.ts', setActiveSrc],
    ['update.ts', updateSrc],
  ] as const) {
    test(`${name} calls authenticateAdmin (never authenticateRequest/scheduler path) and checks auth.ok before proceeding`, () => {
      assert.match(src, /import \{ authenticateAdmin \} from '\.\.\/\.\.\/_lib\/adminAuth\.js'/)
      assert.match(src, /const auth = await authenticateAdmin\(/)
      assert.match(src, /if \(!auth\.ok\)/)
      // Never imports the dual (human + scheduler-bot) dispatcher — these
      // are human-Admin-only actions, no legitimate scheduler caller exists
      // for user management.
      assert.equal(src.includes('authenticateRequest'), false)
    })

    test(`${name}: the auth check happens before the privileged service-client call`, () => {
      const authIndex = src.indexOf('await authenticateAdmin(')
      const privilegedCallIndex = src.search(
        /await (listManagedUsers|addOrCreateManagerAccount|createAccountForExistingEmployee|setManagedUserActive|updateManagedEmployee)\(/,
      )
      assert.ok(authIndex !== -1 && privilegedCallIndex !== -1, `${name}: missing auth call or privileged call`)
      assert.ok(authIndex < privilegedCallIndex, `${name}: auth must be checked before any privileged action`)
    })
  }

  test('Manager denial is inherent: authenticateAdmin itself independently re-verifies role=admin and is_active on every call (see adminAuth.test.ts) — no endpoint here re-implements or bypasses that check', () => {
    for (const src of [listSrc, inviteSrc, createAccountSrc, setActiveSrc, updateSrc]) {
      assert.equal(/profile\.role\s*===\s*'admin'/.test(src), false, 'no endpoint should re-implement its own role check')
    }
  })
})

describe('invite.ts and create-account.ts never accept a role from the request body', () => {
  test('invite.ts only reads fullName/email from the body, never a role/portal_role field', () => {
    const bodyMatch = inviteSrc.match(/const body = \(req\.body[\s\S]*?\n\s*\}/)
    assert.ok(bodyMatch)
    assert.equal(bodyMatch[0].includes('role'), false)
  })

  test('create-account.ts only reads email from the body, never fullName/role/portal_role', () => {
    const bodyMatch = createAccountSrc.match(/const body = \(req\.body[\s\S]*?\n\s*\}/)
    assert.ok(bodyMatch)
    assert.equal(bodyMatch[0].includes('role'), false)
    assert.equal(bodyMatch[0].includes('fullName'), false)
  })
})

describe('createEmployeeAccount — the shared-temporary-password account creation call', () => {
  const fnMatch = serviceClientSrc.match(/export async function createEmployeeAccount\([\s\S]*?\n\}/)
  assert.ok(fnMatch, 'could not locate createEmployeeAccount')
  const body = fnMatch[0]

  test('reads the temporary password from EMPLOYEE_TEMP_PASSWORD, never a hardcoded value or a request-supplied one', () => {
    assert.match(body, /process\.env\.EMPLOYEE_TEMP_PASSWORD/)
  })

  test('fails closed (status: failed) when EMPLOYEE_TEMP_PASSWORD is not configured — never falls back to a default or empty password', () => {
    const guardMatch = body.match(/if \(!tempPassword\) \{([\s\S]*?)\n {2}\}/)
    assert.ok(guardMatch, 'could not locate the missing-tempPassword guard')
    assert.match(guardMatch[1], /return \{ status: 'failed' \}/)
  })

  test('calls auth.admin.createUser with email_confirm, password, and app_metadata — never inviteUserByEmail', () => {
    assert.match(body, /auth\.admin\.createUser\(\{/)
    assert.match(body, /password: tempPassword/)
    assert.match(body, /email_confirm: true/)
    assert.match(body, /app_metadata: PASSWORD_CHANGE_REQUIRED_APP_METADATA/)
    assert.equal(body.includes('inviteUserByEmail'), false)
  })

  test('never logs the temporary password value itself — only whether the call succeeded/failed', () => {
    const logCalls = body.match(/console\.error\([^)]*\)/gs) ?? []
    for (const call of logCalls) {
      assert.equal(/tempPassword/.test(call), false, `a console.error call references tempPassword: ${call}`)
    }
  })

  test('maps email_exists/user_already_exists to already_registered, and only logs for other failures', () => {
    assert.match(body, /error\.code === 'email_exists' \|\| error\.code === 'user_already_exists'/)
    assert.match(body, /alreadyRegistered \? \{ status: 'already_registered' \} : \{ status: 'failed' \}/)
  })

  test('on success, returns the new Auth user\'s own id (authUserId) so the caller can persist it — never discards it', () => {
    assert.match(body, /return \{ status: 'created', authUserId: data\.user\.id \}/)
  })
})

describe('PASSWORD_CHANGE_REQUIRED_APP_METADATA is the exact marker src/lib/onboardingSession.ts reads', () => {
  test('sets password_change_required: true (boolean), not a string like the old onboarding_source marker', () => {
    assert.match(serviceClientSrc, /const PASSWORD_CHANGE_REQUIRED_APP_METADATA = \{ password_change_required: true \} as const/)
  })
})

describe('clearPasswordChangeRequired', () => {
  const fnMatch = serviceClientSrc.match(/export async function clearPasswordChangeRequired\([\s\S]*?\n\}/)
  assert.ok(fnMatch, 'could not locate clearPasswordChangeRequired')
  const body = fnMatch[0]

  test('sets password_change_required: false via the privileged updateUserById call', () => {
    assert.match(body, /auth\.admin\.updateUserById\(userId, \{\s*\n\s*app_metadata: \{ password_change_required: false \}/)
  })

  test('a failure is logged, never thrown — returns a boolean, not an exception', () => {
    assert.match(body, /if \(error\) \{\s*\n\s*console\.error/)
    assert.match(body, /return false/)
    assert.match(body, /return true/)
  })
})

describe('supabaseServiceClient.ts wires the pure decision logic before any roster/account write', () => {
  test('addOrCreateManagerAccount calls decideCreateManagerAccountAction before upserting or creating the account', () => {
    const fnMatch = serviceClientSrc.match(/export async function addOrCreateManagerAccount\([\s\S]*?\n\}/)
    assert.ok(fnMatch, 'could not locate addOrCreateManagerAccount')
    const body = fnMatch[0]
    const decisionIndex = body.indexOf('decideCreateManagerAccountAction(')
    const upsertIndex = body.indexOf('.upsert(')
    const createIndex = body.indexOf('createAccountAndMarkRoster(')
    assert.ok(decisionIndex !== -1 && upsertIndex !== -1 && createIndex !== -1)
    assert.ok(decisionIndex < upsertIndex && decisionIndex < createIndex)
  })

  test('addOrCreateManagerAccount never accepts a role param — the roster upsert always hardcodes portal_role: manager', () => {
    const fnMatch = serviceClientSrc.match(/export async function addOrCreateManagerAccount\([\s\S]*?\n\}/)
    assert.ok(fnMatch)
    assert.match(fnMatch[0], /portal_role: 'manager'/)
  })

  test('addOrCreateManagerAccount always sets submits_weekly_report: true on the roster upsert — every manager created through User Management is explicitly a submitter, never inferred from portal_role', () => {
    const fnMatch = serviceClientSrc.match(/export async function addOrCreateManagerAccount\([\s\S]*?\n\}/)
    assert.ok(fnMatch)
    assert.match(fnMatch[0], /submits_weekly_report: true/)
  })

  test('createAccountForExistingEmployee calls decideCreateAccountForExistingAction and never performs an upsert (never creates a roster row)', () => {
    const fnMatch = serviceClientSrc.match(/export async function createAccountForExistingEmployee\([\s\S]*?\n\}/)
    assert.ok(fnMatch, 'could not locate createAccountForExistingEmployee')
    const body = fnMatch[0]
    assert.match(body, /decideCreateAccountForExistingAction\(/)
    assert.equal(body.includes('.upsert('), false)
  })

  test('both addOrCreateManagerAccount and createAccountForExistingEmployee delegate to the same shared createAccountAndMarkRoster helper — no parallel account-creation mechanism', () => {
    const inviteFn = serviceClientSrc.match(/export async function addOrCreateManagerAccount\([\s\S]*?\n\}/)
    const createFn = serviceClientSrc.match(/export async function createAccountForExistingEmployee\([\s\S]*?\n\}/)
    assert.ok(inviteFn && createFn)
    assert.match(inviteFn[0], /await createAccountAndMarkRoster\(emailNormalized, email\)/)
    assert.match(createFn[0], /await createAccountAndMarkRoster\(emailNormalized, email\)/)
  })

  test('createAccountAndMarkRoster calls createEmployeeAccount and then records approved_employees.account_created_at', () => {
    const fnMatch = serviceClientSrc.match(/async function createAccountAndMarkRoster\([\s\S]*?\n\}/)
    assert.ok(fnMatch, 'could not locate createAccountAndMarkRoster')
    const body = fnMatch[0]
    const createIndex = body.indexOf('await createEmployeeAccount(email)')
    const markIndex = body.indexOf("update({ account_created_at:")
    assert.ok(createIndex !== -1 && markIndex !== -1 && createIndex < markIndex)
  })

  test('createAccountAndMarkRoster also records auth_user_id from the new Auth user, in the SAME write as account_created_at', () => {
    const fnMatch = serviceClientSrc.match(/async function createAccountAndMarkRoster\([\s\S]*?\n\}/)
    assert.ok(fnMatch, 'could not locate createAccountAndMarkRoster')
    assert.match(fnMatch[0], /update\(\{ account_created_at: new Date\(\)\.toISOString\(\), auth_user_id: outcome\.authUserId \}\)/)
  })

  test('setManagedUserActive never writes role or portal_role — role is always preserved across deactivate/reactivate', () => {
    const fnMatch = serviceClientSrc.match(/export async function setManagedUserActive\([\s\S]*?\n\}/)
    assert.ok(fnMatch, 'could not locate setManagedUserActive')
    const body = fnMatch[0]
    assert.equal(/\.update\(\{[^}]*\brole\b/.test(body), false, 'must never update role')
    assert.equal(/\.update\(\{[^}]*portal_role/.test(body), false, 'must never update portal_role')
    assert.match(body, /\.update\(\{ is_active: isActive \}\)/)
  })

  test('setManagedUserActive updates both approved_employees and profiles (when a profile exists), not just one', () => {
    const fnMatch = serviceClientSrc.match(/export async function setManagedUserActive\([\s\S]*?\n\}/)
    assert.ok(fnMatch)
    const body = fnMatch[0]
    assert.match(body, /from\('approved_employees'\)\s*\n\s*\.update/)
    assert.match(body, /from\('profiles'\)\s*\n\s*\.update/)
  })

  test('listManagedUsers joins approved_employees and profiles by normalized email, reads account_created_at, and passes it into deriveManagedUserStatus', () => {
    const fnMatch = serviceClientSrc.match(/export async function listManagedUsers\([\s\S]*?\n\}/)
    assert.ok(fnMatch, 'could not locate listManagedUsers')
    assert.match(fnMatch[0], /account_created_at/)
    assert.match(fnMatch[0], /profileByEmail\.get\(row\.email_normalized\)/)
    assert.match(fnMatch[0], /deriveManagedUserStatus\(row\.is_active, row\.account_created_at !== null, profileSnapshot\)/)
  })

  test('listManagedUsers selects submits_weekly_report from approved_employees and returns it read-only on each summary — never toggled here', () => {
    const fnMatch = serviceClientSrc.match(/export async function listManagedUsers\([\s\S]*?\n\}/)
    assert.ok(fnMatch, 'could not locate listManagedUsers')
    assert.match(fnMatch[0], /\.select\('[^']*submits_weekly_report[^']*'\)/)
    assert.match(fnMatch[0], /submitsWeeklyReport: row\.submits_weekly_report/)
    assert.equal(fnMatch[0].includes('.update('), false, 'listManagedUsers must be read-only')
  })

  test('listManagedUsers selects and returns approved_employees.id — the stable identifier Edit Employee (and the client\'s own row key) must use instead of email', () => {
    const fnMatch = serviceClientSrc.match(/export async function listManagedUsers\([\s\S]*?\n\}/)
    assert.ok(fnMatch, 'could not locate listManagedUsers')
    assert.match(fnMatch[0], /\.select\('id, /)
    assert.match(fnMatch[0], /id: row\.id/)
  })
})

describe('updateManagedEmployee ("Edit Employee") — stable-id targeting, self-lockout, email sync, historical-report safety', () => {
  const fnMatch = serviceClientSrc.match(/export async function updateManagedEmployee\([\s\S]*?\n\}\n/)
  assert.ok(fnMatch, 'could not locate updateManagedEmployee')
  const body = fnMatch[0]

  test('resolves the target row by its stable id (.eq(\'id\', id)) — never by the request\'s (editable) email field', () => {
    assert.match(body, /\.from\('approved_employees'\)\s*\n\s*\.select\(/)
    assert.match(body, /\.eq\('id', id\)/)
  })

  test('calls decideUpdateEmployeeAction before making any write, and branches on every one of its outcomes', () => {
    const decisionIndex = body.indexOf('decideUpdateEmployeeAction(')
    const firstWriteIndex = body.search(/\.(update|updateUserById)\(/)
    assert.ok(decisionIndex !== -1 && firstWriteIndex !== -1)
    assert.ok(decisionIndex < firstWriteIndex, 'the decision must be made before any write is attempted')
    for (const action of ['not_found', 'invalid_domain', 'self_role_change_blocked', 'email_conflict']) {
      assert.match(body, new RegExp(`decision\\.action === '${action}'`))
    }
  })

  test('self-lockout is resolved from the ACTING admin\'s own profile (by their own Auth user id), never from anything the request body claims', () => {
    assert.match(body, /\.from\('profiles'\)\s*\n\s*\.select\('email'\)\s*\n\s*\.eq\('id', actingAdminUserId\)/)
    assert.match(body, /isActingAdminSelf = !!target && !!actingAdminProfile && actingAdminProfile\.email === target\.emailNormalized/)
  })

  test('duplicate-email rejection checks approved_employees for the new email EXCLUDING the row being edited (.neq(\'id\', id))', () => {
    assert.match(body, /\.eq\('email_normalized', emailNormalized\)\s*\n\s*\.neq\('id', id\)/)
  })

  test('never touches is_active — Edit Employee and Deactivate/Reactivate remain fully independent actions', () => {
    assert.equal(/\.update\(\{[^}]*is_active/.test(body), false, 'updateManagedEmployee must never write is_active')
  })

  test('the profile row (if any) is looked up by the CURRENT email once, before any write, and reused — never re-derived from the just-updated roster row', () => {
    const profileLookupIndex = body.indexOf("findProfileByEmail(targetRow!.email_normalized)")
    const rosterUpdateIndex = body.indexOf("from('approved_employees')\n    .update(")
    assert.ok(profileLookupIndex !== -1, 'expected a single findProfileByEmail(targetRow!.email_normalized) call')
    assert.ok(rosterUpdateIndex !== -1)
    assert.ok(profileLookupIndex < rosterUpdateIndex, 'the profile must be looked up by the ORIGINAL email before the roster row (and its email) is changed')
  })

  test('the profile update (when a profile exists) targets it by its OWN id, never by email, and never writes profiles.id itself', () => {
    const profileUpdateBlockMatch = body.match(/if \(existingProfile\) \{([\s\S]*?)\n {2}\}/)
    assert.ok(profileUpdateBlockMatch, 'could not locate the existingProfile update branch')
    assert.match(profileUpdateBlockMatch[1], /\.eq\('id', existingProfile\.id\)/)
    assert.equal(/\.update\(\{[^}]*\bid:/.test(profileUpdateBlockMatch[1]), false, 'must never write profiles.id')
  })

  test('never deletes or re-inserts the profiles row — only ever .update(), so reports.manager_id (the FK to profiles.id) can never be affected', () => {
    assert.equal(body.includes('.insert('), false)
    assert.equal(body.includes('.delete('), false)
    assert.equal(/\.from\('reports'\)/.test(body), false, 'updateManagedEmployee should never query/write the reports table itself')
  })

  test('an Auth email update is attempted ONLY when the account already exists AND the email is actually changing', () => {
    assert.match(body, /if \(accountCreated && emailChanging\) \{/)
    const authBlockMatch = body.match(/if \(accountCreated && emailChanging\) \{([\s\S]*?)\n {2}\}/)
    assert.ok(authBlockMatch)
    assert.match(authBlockMatch[1], /auth\.admin\.updateUserById\(/)
  })

  test('the Auth email update never touches password or app_metadata — editing an email can never reset a password or re-trigger the first-login workflow', () => {
    const authBlockMatch = body.match(/if \(accountCreated && emailChanging\) \{([\s\S]*?)\n {2}\}/)
    assert.ok(authBlockMatch)
    assert.equal(authBlockMatch[1].includes('password'), false)
    assert.equal(authBlockMatch[1].includes('app_metadata'), false)
    assert.equal(authBlockMatch[1].includes('EMPLOYEE_TEMP_PASSWORD'), false)
  })

  test('an Auth email conflict (email_exists/user_already_exists) is mapped to the same email_conflict outcome as a roster-level duplicate', () => {
    assert.match(body, /authUpdateError\.code === 'email_exists' \|\| authUpdateError\.code === 'user_already_exists'/)
    assert.match(body, /return conflict \? \{ status: 'email_conflict' \} : \{ status: 'error' \}/)
  })

  test('resolves the Auth user EXCLUSIVELY from the stable auth_user_id column — never by re-deriving it from a profile or anything else', () => {
    assert.match(body, /const authUserId = targetRow!\.auth_user_id/)
    assert.equal(body.includes('existingProfile?.id ??'), false, 'must not fall back to the profile id to guess the Auth user')
  })

  test('no Auth listUsers/email-scan mechanism remains anywhere in this file', () => {
    assert.equal(serviceClientSrc.includes('findAuthUserIdByEmail'), false)
    assert.equal(serviceClientSrc.includes('auth.admin.listUsers'), false)
  })

  test('fails closed with auth_identity_unresolved when account_created_at is set but auth_user_id is still null for an email change — never guesses', () => {
    const gapBlockMatch = body.match(/if \(!authUserId\) \{([\s\S]*?)\n {4}\}/)
    assert.ok(gapBlockMatch, 'could not locate the auth_user_id-missing guard')
    assert.match(gapBlockMatch[1], /return \{ status: 'auth_identity_unresolved' \}/)
  })

  test('the auth_identity_unresolved gap only blocks EMAIL changes — it is checked inside the "account exists AND email changing" branch, not unconditionally', () => {
    const authGateIndex = body.indexOf('if (accountCreated && emailChanging) {')
    const gapCheckIndex = body.indexOf('if (!authUserId) {')
    assert.ok(authGateIndex !== -1 && gapCheckIndex !== -1)
    assert.ok(authGateIndex < gapCheckIndex, 'the missing-auth_user_id check must be inside the email-changing branch')
  })

  test('never creates a second Auth user and never resets a password — the only Auth call in this function is updateUserById with email/email_confirm only', () => {
    const authUpdateCallMatch = body.match(/client\.auth\.admin\.updateUserById\(authUserId, \{([\s\S]*?)\}\)/)
    assert.ok(authUpdateCallMatch, 'could not locate the primary Auth email update call')
    assert.match(authUpdateCallMatch[1], /email: updates\.email/)
    assert.match(authUpdateCallMatch[1], /email_confirm: true/)
    assert.equal(authUpdateCallMatch[1].includes('password'), false)
    assert.equal(body.includes('auth.admin.createUser'), false)
  })

  test('Auth is updated BEFORE the roster row, so the harder-to-recover failure (a real Auth uniqueness conflict) surfaces before any local data changes', () => {
    const authCallIndex = body.indexOf('auth.admin.updateUserById(')
    const rosterUpdateIndex = body.indexOf("from('approved_employees')\n    .update(")
    assert.ok(authCallIndex !== -1 && rosterUpdateIndex !== -1)
    assert.ok(authCallIndex < rosterUpdateIndex)
  })

  test('rollbackAuthEmail is a no-op (returns true) when the Auth email was never actually changed', () => {
    const rollbackFnMatch = body.match(/async function rollbackAuthEmail\(\): Promise<boolean> \{([\s\S]*?)\n {2}\}/)
    assert.ok(rollbackFnMatch, 'could not locate rollbackAuthEmail')
    assert.match(rollbackFnMatch[1], /if \(!authEmailChanged \|\| !authUserId\) return true/)
  })

  test('rollbackRoster is a no-op (returns true) when the roster row was never actually changed', () => {
    const rollbackFnMatch = body.match(/async function rollbackRoster\(\): Promise<boolean> \{([\s\S]*?)\n {2}\}/)
    assert.ok(rollbackFnMatch, 'could not locate rollbackRoster')
    assert.match(rollbackFnMatch[1], /if \(!rosterUpdated\) return true/)
  })

  test('rollbackRoster restores ALL four editable roster fields (full_name, email, email_normalized, portal_role, submits_weekly_report) from the pre-edit snapshot, never just email', () => {
    const rollbackFnMatch = body.match(/async function rollbackRoster\(\): Promise<boolean> \{([\s\S]*?)\n {2}\}/)
    assert.ok(rollbackFnMatch)
    for (const field of ['full_name: originalRoster.fullName', 'email: originalRoster.email', 'email_normalized: originalRoster.emailNormalized', 'portal_role: originalRoster.portalRole', 'submits_weekly_report: originalRoster.submitsWeeklyReport']) {
      assert.ok(rollbackFnMatch[1].includes(field), `rollbackRoster must restore ${field}`)
    }
    assert.match(rollbackFnMatch[1], /\.eq\('id', id\)/)
    assert.equal(/\bid:/.test(rollbackFnMatch[1].replace(/approvedEmployeeId/g, '')), false, 'rollbackRoster must never write id itself')
  })

  test('the originalRoster snapshot is captured once, before any write, from ALL four editable columns — not just email', () => {
    const snapshotMatch = body.match(/const originalRoster = \{([\s\S]*?)\n {2}\}/)
    assert.ok(snapshotMatch, 'could not locate the originalRoster snapshot')
    for (const field of ['fullName: targetRow!.full_name', 'email: targetRow!.email', 'emailNormalized: targetRow!.email_normalized', 'portalRole: targetRow!.portal_role', 'submitsWeeklyReport: targetRow!.submits_weekly_report']) {
      assert.ok(snapshotMatch[1].includes(field), `originalRoster must capture ${field}`)
    }
    const snapshotIndex = body.indexOf('const originalRoster = {')
    const rosterWriteIndex = body.indexOf("from('approved_employees')\n    .update(")
    assert.ok(snapshotIndex !== -1 && rosterWriteIndex !== -1 && snapshotIndex < rosterWriteIndex, 'the snapshot must be captured before the roster row is ever written to')
  })

  test('a roster-update failure compensates ONLY Auth (roster was never actually changed, so rollbackRoster is never given anything to undo) — case A', () => {
    const rosterFailureBlockMatch = body.match(/if \(rosterUpdateError\) \{([\s\S]*?)\n {2}\}/)
    assert.ok(rosterFailureBlockMatch, 'could not locate the roster-update failure branch')
    assert.match(rosterFailureBlockMatch[1], /return rollbackAndReport\('roster_update_failed'\)/)
    assert.equal(/rosterUpdated\s*=\s*true/.test(rosterFailureBlockMatch[1]), false, 'rosterUpdated must not be set true before the roster write is confirmed to have succeeded')
  })

  test('rosterUpdated is only set true AFTER the roster write succeeds, and the profile-failure branch compensates roster before Auth — case B', () => {
    const rosterUpdatedIndex = body.indexOf('rosterUpdated = true')
    const rosterUpdateErrorIndex = body.indexOf('if (rosterUpdateError) {')
    assert.ok(rosterUpdatedIndex !== -1 && rosterUpdateErrorIndex !== -1)
    assert.ok(rosterUpdateErrorIndex < rosterUpdatedIndex, 'the failure check must come before rosterUpdated is set true')

    const profileFailureBlockMatch = body.match(/if \(profileUpdateError\) \{([\s\S]*?)\n {4}\}/)
    assert.ok(profileFailureBlockMatch, 'could not locate the profile-update failure branch')
    assert.match(profileFailureBlockMatch[1], /return rollbackAndReport\('profile_update_failed'\)/)

    const rollbackAndReportMatch = body.match(/async function rollbackAndReport\([\s\S]*?\n {2}\}/)
    assert.ok(rollbackAndReportMatch, 'could not locate rollbackAndReport')
    const rosterRollbackIndex = rollbackAndReportMatch[0].indexOf('rollbackRoster()')
    const authRollbackIndex = rollbackAndReportMatch[0].indexOf('rollbackAuthEmail()')
    assert.ok(rosterRollbackIndex !== -1 && authRollbackIndex !== -1)
    assert.ok(rosterRollbackIndex < authRollbackIndex, 'roster must be compensated before Auth, the reverse of the write order')
  })

  test('rollbackAndReport tracks each store as changed/unchanged before compensating it, and never blindly writes to a store this request never touched', () => {
    const rollbackAndReportMatch = body.match(/async function rollbackAndReport\([\s\S]*?\n {2}\}/)
    assert.ok(rollbackAndReportMatch)
    assert.match(rollbackAndReportMatch[0], /rosterUpdated \? await rollbackRoster\(\) : 'not_attempted_unchanged'/)
    assert.match(rollbackAndReportMatch[0], /authEmailChanged \? await rollbackAuthEmail\(\) : 'not_attempted_unchanged'/)
  })

  test('when every attempted compensation succeeds (or nothing needed compensating), rollbackAndReport returns a normal error — state is consistent with the pre-edit row again', () => {
    const rollbackAndReportMatch = body.match(/async function rollbackAndReport\([\s\S]*?\n {2}\}/)
    assert.ok(rollbackAndReportMatch)
    assert.match(rollbackAndReportMatch[0], /const anyRollbackFailed = profileRollback === false \|\| rosterRollback === false \|\| authRollback === false/)
    assert.match(rollbackAndReportMatch[0], /if \(!anyRollbackFailed\) \{[\s\S]*?return \{ status: 'error' \}/)
  })

  test('if ANY attempted compensation fails — roster rollback, Auth rollback, or both — rollbackAndReport returns the distinct partial_failure outcome, never a plain error', () => {
    const rollbackAndReportMatch = body.match(/async function rollbackAndReport\([\s\S]*?\n {2}\}/)
    assert.ok(rollbackAndReportMatch)
    // The only way out of the function once `anyRollbackFailed` is true is the
    // partial_failure return — there is no separate branch per which single
    // store failed, so this covers roster-only-failed, Auth-only-failed, and
    // both-failed identically.
    const afterGuard = rollbackAndReportMatch[0].slice(rollbackAndReportMatch[0].indexOf('if (!anyRollbackFailed)'))
    assert.match(afterGuard, /return \{ status: 'partial_failure' \}/)
    assert.equal(/return \{ status: 'error' \}/.test(afterGuard.replace(/if \(!anyRollbackFailed\) \{[\s\S]*?\n {4}\}\n\n/, '')), false, 'once any rollback has failed, the function must never still return a plain error')
  })

  test('partial_failure and successful-rollback logging both report which store(s) rolled back and which did not — never just a boolean', () => {
    const rollbackAndReportMatch = body.match(/async function rollbackAndReport\([\s\S]*?\n {2}\}/)
    assert.ok(rollbackAndReportMatch)
    assert.match(rollbackAndReportMatch[0], /\{ approvedEmployeeId: id, authUserId, profileRollback, rosterRollback, authRollback \}/)
    assert.match(rollbackAndReportMatch[0], /profileRollback,\s*\n\s*rosterRollback,\s*\n\s*authRollback,/)
  })

  test('partial_failure logging never includes the password, a token, a temp password, an API key, or any other secret — only ids and email addresses', () => {
    const rollbackAndReportMatch = body.match(/async function rollbackAndReport\([\s\S]*?\n {2}\}/)
    assert.ok(rollbackAndReportMatch)
    assert.equal(/password|token|secret|api[_-]?key|EMPLOYEE_TEMP_PASSWORD/i.test(rollbackAndReportMatch[0]), false, 'rollbackAndReport must never log a credential')
  })

  test('a successful edit (no failure at any step) never invokes either rollback function and returns a plain ok', () => {
    const successPathIndex = body.lastIndexOf("return { status: 'ok' }")
    assert.ok(successPathIndex !== -1)
    const rollbackAndReportCalls = [...body.matchAll(/rollbackAndReport\(/g)].map((m) => m.index ?? -1)
    assert.ok(rollbackAndReportCalls.every((i) => i < successPathIndex), 'rollbackAndReport must only be reached from a failure branch, never on the way to the ok return')
  })

  test('historical report identity remains untouched by the rollback path too: rollbackRoster/rollbackAuthEmail never reference profiles.id, reports, or reports.manager_id', () => {
    const rollbackRosterMatch = body.match(/async function rollbackRoster\(\): Promise<boolean> \{([\s\S]*?)\n {2}\}/)
    const rollbackAuthMatch = body.match(/async function rollbackAuthEmail\(\): Promise<boolean> \{([\s\S]*?)\n {2}\}/)
    assert.ok(rollbackRosterMatch && rollbackAuthMatch)
    for (const fnBody of [rollbackRosterMatch[1], rollbackAuthMatch[1]]) {
      assert.equal(fnBody.includes("from('profiles')"), false)
      assert.equal(fnBody.includes("from('reports')"), false)
      assert.equal(fnBody.includes('manager_id'), false)
      assert.equal(/\bprofiles\.id\b/.test(fnBody), false)
    }
  })

  describe('write-evidence vs value-verification — .update().eq(...) can return error: null with zero rows affected, and a returned row proves a write regardless of its values', () => {
    const rosterBlockMatch = body.match(/const \{ data: rosterUpdateRows, error: rosterUpdateError \} = await client\s*\n {4}\.from\('approved_employees'\)([\s\S]*?)\n {2}\/\/ 3\) Profile row/)
    const profileBlockMatch = body.match(/if \(existingProfile\) \{([\s\S]*?)\n {2}\}\n\n {2}return \{ status: 'ok' \}/)
    const rollbackProfileMatch = body.match(/async function rollbackProfile\(\): Promise<boolean> \{([\s\S]*?)\n {2}\}/)
    const originalProfileMatch = body.match(/const originalProfile: [\s\S]*? \|\s*null =\s*\n\s*existingProfile\s*\n\s*\? \{([\s\S]*?)\}\s*\n\s*: null/)
    const rollbackAndReportMatch = body.match(/async function rollbackAndReport\([\s\S]*?\n {2}\}/)

    test('the roster update requests its own written row back via .select(), never relying on error alone', () => {
      assert.ok(rosterBlockMatch, 'could not locate the roster update + verification block')
      assert.match(rosterBlockMatch[1], /\.eq\('id', id\)\s*\n\s*\.select\('id, submits_weekly_report'\)/)
    })

    test('roster: exactly one row matching this id is success — rosterUpdated is set true, the value check passes, and execution reaches the profile step (or ok)', () => {
      assert.ok(rosterBlockMatch)
      assert.match(rosterBlockMatch[1], /const rosterRowCount = rosterUpdateRows\?\.length \?\? 0/)
      assert.match(rosterBlockMatch[1], /const rosterIntendedRowReturned = rosterRowCount === 1 && rosterUpdateRows!\[0\]\.id === id/)
      const rosterUpdatedTrueIndex = rosterBlockMatch[1].lastIndexOf('rosterUpdated = true')
      assert.ok(rosterUpdatedTrueIndex !== -1)
      assert.match(rosterBlockMatch[1].slice(rosterUpdatedTrueIndex), /const rosterValueVerified = rosterUpdateRows!\[0\]\.submits_weekly_report === updates\.submitsWeeklyReport/)
      // updates.submitsWeeklyReport (never a literal true/false) is compared,
      // so this same check covers both a true->false and a false->true request.
      assert.equal(/submits_weekly_report === (true|false)\b/.test(rosterBlockMatch[1]), false, 'must compare against the requested value, not a hardcoded boolean')
    })

    test('roster: zero rows returned means rosterUpdated stays false — rollbackAndReport is called, but rollbackRoster (a no-op when unchanged) is never given anything to undo', () => {
      assert.ok(rosterBlockMatch)
      const zeroRowBlockMatch = rosterBlockMatch[1].match(/if \(rosterRowCount === 0\) \{([\s\S]*?)\n {2}\}/)
      assert.ok(zeroRowBlockMatch, 'could not locate the zero-row branch')
      assert.match(zeroRowBlockMatch[1], /return rollbackAndReport\('roster_update_failed'\)/)
      assert.equal(/rosterUpdated\s*=\s*true/.test(zeroRowBlockMatch[1]), false, 'rosterUpdated must not be set true in the zero-row branch')
      // rosterUpdated = true must appear strictly AFTER this branch's own
      // rollbackAndReport call, so a zero-row result is never counted as
      // "changed" before compensation is even considered.
      const zeroRowBranchIndex = rosterBlockMatch[1].indexOf('if (rosterRowCount === 0)')
      const rosterUpdatedTrueIndex = rosterBlockMatch[1].indexOf('rosterUpdated = true')
      assert.ok(zeroRowBranchIndex !== -1 && rosterUpdatedTrueIndex !== -1 && zeroRowBranchIndex < rosterUpdatedTrueIndex)
    })

    test('roster: exactly one intended row returned but submits_weekly_report mismatched — rosterUpdated is set true BEFORE the value check, so rollbackRoster actually restores the original values', () => {
      assert.ok(rosterBlockMatch)
      const rosterUpdatedTrueIndex = rosterBlockMatch[1].lastIndexOf('rosterUpdated = true')
      const valueCheckIndex = rosterBlockMatch[1].indexOf('const rosterValueVerified')
      const valueFailureReturnIndex = rosterBlockMatch[1].indexOf("if (!rosterValueVerified) {")
      assert.ok(rosterUpdatedTrueIndex !== -1 && valueCheckIndex !== -1 && valueFailureReturnIndex !== -1)
      assert.ok(rosterUpdatedTrueIndex < valueCheckIndex, 'rosterUpdated = true must be set before the value check runs')
      const valueFailureBlockMatch = rosterBlockMatch[1].match(/if \(!rosterValueVerified\) \{([\s\S]*?)\n {2}\}/)
      assert.ok(valueFailureBlockMatch)
      assert.match(valueFailureBlockMatch[1], /return rollbackAndReport\('roster_update_failed'\)/)
    })

    test('roster: more than one returned row is treated as write evidence — rosterUpdated is set true, rollback is still attempted, and this is logged distinctly from a plain value mismatch', () => {
      assert.ok(rosterBlockMatch)
      const abnormalBlockMatch = rosterBlockMatch[1].match(/if \(!rosterIntendedRowReturned\) \{([\s\S]*?)\n {2}\}/)
      assert.ok(abnormalBlockMatch, 'could not locate the abnormal (2+ rows) branch')
      assert.match(abnormalBlockMatch[1], /rosterUpdated = true/)
      assert.match(abnormalBlockMatch[1], /ABNORMAL/)
      assert.match(abnormalBlockMatch[1], /duplicate id/i)
      assert.match(abnormalBlockMatch[1], /return rollbackAndReport\('roster_update_failed'\)/)
      assert.equal(/password|token|secret|api[_-]?key|EMPLOYEE_TEMP_PASSWORD/i.test(abnormalBlockMatch[1]), false)
    })

    test('the profile update requests its own written row back via .select(), never relying on error alone', () => {
      assert.ok(profileBlockMatch, 'could not locate the existingProfile update + verification block')
      assert.match(profileBlockMatch[1], /\.eq\('id', existingProfile\.id\)\s*\n\s*\.select\('id, submits_weekly_report'\)/)
    })

    test('profile: exactly one row matching existingProfile.id is success — profileUpdated is set true and the value check passes', () => {
      assert.ok(profileBlockMatch)
      assert.match(profileBlockMatch[1], /const profileRowCount = profileUpdateRows\?\.length \?\? 0/)
      assert.match(profileBlockMatch[1], /const profileIntendedRowReturned = profileRowCount === 1 && profileUpdateRows!\[0\]\.id === existingProfile\.id/)
      const profileUpdatedTrueIndex = profileBlockMatch[1].lastIndexOf('profileUpdated = true')
      assert.ok(profileUpdatedTrueIndex !== -1)
      assert.match(profileBlockMatch[1].slice(profileUpdatedTrueIndex), /const profileValueVerified = profileUpdateRows!\[0\]\.submits_weekly_report === updates\.submitsWeeklyReport/)
    })

    test('profile: zero rows returned means profileUpdated stays false — no profile rollback is attempted, but roster/Auth compensation (whichever already changed) still occurs', () => {
      assert.ok(profileBlockMatch)
      const zeroRowBlockMatch = profileBlockMatch[1].match(/if \(profileRowCount === 0\) \{([\s\S]*?)\n {4}\}/)
      assert.ok(zeroRowBlockMatch, 'could not locate the zero-row branch')
      assert.match(zeroRowBlockMatch[1], /return rollbackAndReport\('profile_update_failed'\)/)
      assert.equal(/profileUpdated\s*=\s*true/.test(zeroRowBlockMatch[1]), false, 'profileUpdated must not be set true in the zero-row branch')
    })

    test('profile: exactly one intended row returned but submits_weekly_report mismatched — profileUpdated is set true BEFORE the value check, so rollbackProfile actually runs', () => {
      assert.ok(profileBlockMatch)
      const profileUpdatedTrueIndex = profileBlockMatch[1].lastIndexOf('profileUpdated = true')
      const valueCheckIndex = profileBlockMatch[1].indexOf('const profileValueVerified')
      assert.ok(profileUpdatedTrueIndex !== -1 && valueCheckIndex !== -1)
      assert.ok(profileUpdatedTrueIndex < valueCheckIndex, 'profileUpdated = true must be set before the value check runs')
      const valueFailureBlockMatch = profileBlockMatch[1].match(/if \(!profileValueVerified\) \{([\s\S]*?)\n {4}\}/)
      assert.ok(valueFailureBlockMatch)
      assert.match(valueFailureBlockMatch[1], /return rollbackAndReport\('profile_update_failed'\)/)
    })

    test('profile: more than one returned row is treated as write evidence — profileUpdated is set true, and this is logged distinctly from a plain value mismatch', () => {
      assert.ok(profileBlockMatch)
      const abnormalBlockMatch = profileBlockMatch[1].match(/if \(!profileIntendedRowReturned\) \{([\s\S]*?)\n {4}\}/)
      assert.ok(abnormalBlockMatch, 'could not locate the abnormal (2+ rows) branch')
      assert.match(abnormalBlockMatch[1], /profileUpdated = true/)
      assert.match(abnormalBlockMatch[1], /ABNORMAL/)
      assert.match(abnormalBlockMatch[1], /duplicate id/i)
      assert.equal(/password|token|secret|api[_-]?key|EMPLOYEE_TEMP_PASSWORD/i.test(abnormalBlockMatch[1]), false)
    })

    test('originalProfile snapshot is captured from already-fetched data (existingProfile + originalRoster.emailNormalized) — no new query is introduced', () => {
      assert.ok(originalProfileMatch, 'could not locate the originalProfile snapshot')
      assert.match(originalProfileMatch[1], /fullName: existingProfile\.fullName/)
      assert.match(originalProfileMatch[1], /email: originalRoster\.emailNormalized/)
      assert.match(originalProfileMatch[1], /role: existingProfile\.role/)
      assert.match(originalProfileMatch[1], /submitsWeeklyReport: existingProfile\.submitsWeeklyReport/)
      // Captured once, from data already fetched by findProfileByEmail — no
      // additional .from('profiles') read is introduced for this purpose.
      const snapshotIndex = body.indexOf('const originalProfile:')
      const firstProfileWriteIndex = body.indexOf("from('profiles')\n      .update(")
      assert.ok(snapshotIndex !== -1 && firstProfileWriteIndex !== -1 && snapshotIndex < firstProfileWriteIndex)
    })

    test('rollbackProfile restores full_name, email, role, and submits_weekly_report from originalProfile, targets ONLY existingProfile.id, and is a no-op unless profileUpdated', () => {
      assert.ok(rollbackProfileMatch, 'could not locate rollbackProfile')
      assert.match(rollbackProfileMatch[1], /if \(!profileUpdated \|\| !existingProfile \|\| !originalProfile\) return true/)
      for (const field of ['full_name: originalProfile.fullName', 'email: originalProfile.email', 'role: originalProfile.role', 'submits_weekly_report: originalProfile.submitsWeeklyReport']) {
        assert.ok(rollbackProfileMatch[1].includes(field), `rollbackProfile must restore ${field}`)
      }
      assert.match(rollbackProfileMatch[1], /\.eq\('id', existingProfile\.id\)/)
      assert.equal(/\bid:/.test(rollbackProfileMatch[1].replace(/existingProfile\.id/g, '')), false, 'rollbackProfile must never write id itself')
    })

    test('rollbackProfile never changes auth_user_id, reports, or reports.manager_id — profiles has no auth_user_id column and this function never references either', () => {
      assert.ok(rollbackProfileMatch)
      assert.equal(rollbackProfileMatch[1].includes('auth_user_id'), false)
      assert.equal(rollbackProfileMatch[1].includes("from('reports')"), false)
      assert.equal(rollbackProfileMatch[1].includes('manager_id'), false)
    })

    test('rollback order is profile, then roster, then Auth — the reverse of the write order (Auth -> roster -> profile)', () => {
      assert.ok(rollbackAndReportMatch)
      const profileIndex = rollbackAndReportMatch[0].indexOf('rollbackProfile()')
      const rosterIndex = rollbackAndReportMatch[0].indexOf('rollbackRoster()')
      const authIndex = rollbackAndReportMatch[0].indexOf('rollbackAuthEmail()')
      assert.ok(profileIndex !== -1 && rosterIndex !== -1 && authIndex !== -1)
      assert.ok(profileIndex < rosterIndex && rosterIndex < authIndex, 'expected profile, then roster, then Auth compensation order')
    })

    test('a profile rollback failure participates in partial_failure exactly like roster/Auth rollback failures', () => {
      assert.ok(rollbackAndReportMatch)
      assert.match(rollbackAndReportMatch[0], /const anyRollbackFailed = profileRollback === false \|\| rosterRollback === false \|\| authRollback === false/)
    })

    test('partial_failure and successful-rollback reconciliation logging both include profileRollback alongside rosterRollback and authRollback', () => {
      assert.ok(rollbackAndReportMatch)
      assert.match(rollbackAndReportMatch[0], /\{ approvedEmployeeId: id, authUserId, profileRollback, rosterRollback, authRollback \}/)
      assert.match(rollbackAndReportMatch[0], /profileRollback,\s*\n\s*rosterRollback,\s*\n\s*authRollback,/)
    })

    test('rollbackAndReport never logs a password, token, temp password, API key, or any other secret — even with the new profile compensation added', () => {
      assert.ok(rollbackAndReportMatch)
      assert.equal(/password|token|secret|api[_-]?key|EMPLOYEE_TEMP_PASSWORD/i.test(rollbackAndReportMatch[0]), false)
    })
  })
})

describe('api/admin/users/update.ts ("Edit Employee") endpoint', () => {
  test('reads id, fullName, email, role, and submitsWeeklyReport from the body, and requires all five', () => {
    const bodyMatch = updateSrc.match(/const body = \(req\.body[\s\S]*?\n\s*\}/)
    assert.ok(bodyMatch)
    for (const field of ['id', 'fullName', 'email', 'role', 'submitsWeeklyReport']) {
      assert.ok(bodyMatch[0].includes(field), `expected the body destructure to reference ${field}`)
    }
    assert.match(updateSrc, /if \(!id \|\| !fullName \|\| !email \|\| !role \|\| submitsWeeklyReport === null\)/)
  })

  test('role is validated to be exactly \'manager\' or \'admin\' — never passed through unchecked', () => {
    assert.match(updateSrc, /body\.role === 'manager' \|\| body\.role === 'admin'/)
  })

  test('calls updateManagedEmployee with the acting admin\'s own userId from authenticateAdmin\'s result — never anything client-supplied — for the self-lockout check', () => {
    assert.match(updateSrc, /updateManagedEmployee\(id, \{ fullName, email, role, submitsWeeklyReport \}, auth\.userId\)/)
  })

  test('switch handles ok/not_found/invalid_domain/email_conflict/self_role_change_blocked, all as fixed sanitized messages', () => {
    assert.match(updateSrc, /case 'ok':\s*\n\s*return res\.status\(200\)\.json\(\{ status: 'ok' \}\)/)
    assert.match(updateSrc, /case 'not_found':/)
    assert.match(updateSrc, /case 'invalid_domain':/)
    assert.match(updateSrc, /case 'email_conflict':/)
    assert.match(updateSrc, /case 'self_role_change_blocked':\s*\n\s*return sendError\(res, 409, 'SELF_ROLE_CHANGE_BLOCKED',/)
  })

  test('never references SUPABASE_SECRET_KEY, service-role internals, or EMPLOYEE_TEMP_PASSWORD directly', () => {
    assert.equal(updateSrc.includes('SUPABASE_SECRET_KEY'), false)
    assert.equal(updateSrc.includes('getServiceClient'), false)
    assert.equal(updateSrc.includes('EMPLOYEE_TEMP_PASSWORD'), false)
  })
})

describe('Client service layer — updateManagedEmployee', () => {
  const clientSrc = readFileSync(path.join(dir, '..', '..', 'src', 'lib', 'adminUserManagementService.ts'), 'utf8')

  test('calls /api/admin/users/update with id, fullName, email, role, submitsWeeklyReport', () => {
    const fnMatch = clientSrc.match(/export async function updateManagedEmployee\([\s\S]*?\n\}/)
    assert.ok(fnMatch, 'could not locate the client updateManagedEmployee')
    assert.match(fnMatch[0], /fetch\('\/api\/admin\/users\/update'/)
    assert.match(fnMatch[0], /JSON\.stringify\(\{ id, fullName, email, role, submitsWeeklyReport \}\)/)
  })

  test('maps every server error code to a distinct client-side status, never collapsing them into one generic outcome', () => {
    const fnMatch = clientSrc.match(/const UPDATE_MANAGED_EMPLOYEE_ERROR_CODES[\s\S]*?\n\}/)
    assert.ok(fnMatch)
    for (const code of ['NOT_FOUND', 'INVALID_DOMAIN', 'EMAIL_CONFLICT', 'SELF_ROLE_CHANGE_BLOCKED']) {
      assert.ok(fnMatch[0].includes(code), `expected ${code} to be mapped`)
    }
  })
})

// inviteApprovedEmployee/InviteOutcome/InviteSource are now reached ONLY by
// the self-service Request Access flow — Admin User Management no longer
// sends invitation emails at all (see createEmployeeAccount above). This
// function itself is otherwise unchanged/untouched, so its existing
// behavior is still exactly as before; these tests confirm that, and that
// nothing in Admin User Management calls it anymore.
describe('inviteApprovedEmployee — untouched, now reached only by the self-service Request Access flow', () => {
  const fnMatch = serviceClientSrc.match(/export async function inviteApprovedEmployee\([\s\S]*?\n\}/)
  assert.ok(fnMatch, 'could not locate inviteApprovedEmployee')
  const body = fnMatch[0]

  test('still sets the marker when source is admin_invite (kept, unreachable in practice, rather than removed) — never for self_service', () => {
    const ifIndex = body.search(/if \(source === 'admin_invite'\) \{/)
    assert.ok(ifIndex !== -1, 'expected a source === \'admin_invite\' guard before setting app_metadata')
    const updateIndex = body.indexOf('auth.admin.updateUserById(')
    assert.ok(updateIndex !== -1 && updateIndex > ifIndex, 'updateUserById must be inside the admin_invite guard')
  })

  test('Admin User Management no longer calls inviteApprovedEmployee at all', () => {
    assert.equal(serviceClientSrc.includes('await inviteApprovedEmployee('), false)
  })

  test('request-access.ts (the self-service path) still passes self_service — the only remaining caller', () => {
    const requestAccessSrc = readFileSync(path.join(dir, '..', 'onboarding', 'request-access.ts'), 'utf8')
    assert.match(requestAccessSrc, /inviteApprovedEmployee\(employee\.email, ONBOARDING_REDIRECT_URL, 'self_service'\)/)
  })
})

describe('api/admin/users/invite.ts ("Add Manager") — Manager-only, no email sent, new statuses wired through', () => {
  test('calls addOrCreateManagerAccount, never addOrInviteManager or any redirectTo/ONBOARDING_REDIRECT_URL concept', () => {
    assert.match(inviteSrc, /addOrCreateManagerAccount\(fullName, email\)/)
    assert.equal(inviteSrc.includes('ONBOARDING_REDIRECT_URL'), false)
  })

  test('switch handles created/already_created/already_registered/invalid_domain/role_conflict/inactive, all as fixed sanitized messages', () => {
    assert.match(inviteSrc, /case 'created':\s*\n\s*return res\.status\(200\)\.json\(\{ status: 'created' \}\)/)
    assert.match(inviteSrc, /case 'already_created':/)
    assert.match(inviteSrc, /case 'role_conflict':\s*\n\s*return sendError\(res, 409, 'ROLE_CONFLICT',/)
    assert.match(inviteSrc, /case 'inactive':\s*\n\s*return sendError\(res, 409, 'INACTIVE',/)
  })
})

describe('api/admin/users/create-account.ts ("Create Account") — replaces Resend Invitation, role-agnostic, no email sent', () => {
  test('calls createAccountForExistingEmployee, never creates a roster row, never references redirectTo/ONBOARDING_REDIRECT_URL', () => {
    assert.match(createAccountSrc, /createAccountForExistingEmployee\(email\)/)
    assert.equal(createAccountSrc.includes('ONBOARDING_REDIRECT_URL'), false)
  })

  test('has no role_conflict case at all — an Admin roster entry can have its account created here', () => {
    assert.equal(createAccountSrc.includes('role_conflict'), false)
    assert.equal(createAccountSrc.includes('ROLE_CONFLICT'), false)
  })

  test('switch handles created/not_found/already_registered/already_created/inactive', () => {
    assert.match(createAccountSrc, /case 'created':\s*\n\s*return res\.status\(200\)\.json\(\{ status: 'created' \}\)/)
    assert.match(createAccountSrc, /case 'not_found':/)
    assert.match(createAccountSrc, /case 'already_created':/)
    assert.match(createAccountSrc, /case 'inactive':\s*\n\s*return sendError\(res, 409, 'INACTIVE',/)
  })
})

describe('Neither endpoint leaks raw Supabase/service-role error detail, a role, or the temporary password to the browser', () => {
  test('every sendError call inside the outcome switch uses a fixed string literal message, never an error-object property', () => {
    for (const [name, src] of [
      ['invite.ts', inviteSrc],
      ['create-account.ts', createAccountSrc],
    ] as const) {
      const switchMatch = src.match(/switch \(outcome\.status\) \{([\s\S]*?)\n\s*\}/)
      assert.ok(switchMatch, `${name}: could not locate the outcome-status switch`)
      const sendErrorCalls = switchMatch[1].match(/sendError\([^)]*\)/gs) ?? []
      assert.ok(sendErrorCalls.length > 0, `${name}: expected at least one sendError call inside the switch`)
      for (const call of sendErrorCalls) {
        assert.equal(/\.(message|details|hint|code)\b/.test(call), false, `${name}: sendError call looks like it forwards raw error detail: ${call}`)
      }
    }
  })

  test('neither endpoint ever imports or references SUPABASE_SECRET_KEY, service-role internals, or EMPLOYEE_TEMP_PASSWORD directly', () => {
    for (const src of [inviteSrc, createAccountSrc]) {
      assert.equal(src.includes('SUPABASE_SECRET_KEY'), false)
      assert.equal(src.includes('getServiceClient'), false)
      assert.equal(src.includes('EMPLOYEE_TEMP_PASSWORD'), false)
    }
  })
})

describe('Client service layer (src/lib/adminUserManagementService.ts) — create-account terminology, no leftover invite/resend concepts', () => {
  const clientSrc = readFileSync(path.join(dir, '..', '..', 'src', 'lib', 'adminUserManagementService.ts'), 'utf8')

  test('createManagerAccount calls /api/admin/users/invite; createAccountForExistingEmployee calls /api/admin/users/create-account', () => {
    assert.match(clientSrc, /export async function createManagerAccount\([\s\S]*?fetch\('\/api\/admin\/users\/invite'/)
    assert.match(clientSrc, /export async function createAccountForExistingEmployee\([\s\S]*?fetch\('\/api\/admin\/users\/create-account'/)
  })

  test('no leftover inviteManager/resendManagerInvite exports, and no ResendInviteOutcome/InviteManagerOutcome types with role_conflict on the resend side', () => {
    assert.equal(clientSrc.includes('export async function inviteManager'), false)
    assert.equal(clientSrc.includes('export async function resendManagerInvite'), false)
    assert.equal(/CreateAccountForExistingOutcome[\s\S]{0,300}role_conflict/.test(clientSrc), false)
  })

  test('ALREADY_CREATED and INACTIVE both map to their client-side statuses for the create-manager-account path', () => {
    assert.match(clientSrc, /ALREADY_CREATED:\s*'already_created'/)
    assert.match(clientSrc, /INACTIVE:\s*'inactive'/)
  })
})

describe('complete-profile.ts creates a profile with the approved roster role, including admin, and clears password_change_required', () => {
  const completeProfileSrc = readFileSync(path.join(dir, '..', 'onboarding', 'complete-profile.ts'), 'utf8')

  test('createProfileFromApprovedEmployee is called with the roster-looked-up employee, never a hardcoded or request-supplied role', () => {
    assert.match(completeProfileSrc, /createProfileFromApprovedEmployee\(userData\.user\.id, employee\)/)
    assert.equal(/role:\s*['"]admin['"]|role:\s*['"]manager['"]/.test(completeProfileSrc), false)
  })

  test('createProfileFromApprovedEmployee itself writes role from employee.portalRole (manager or admin), not a fixed value', () => {
    const fnMatch = serviceClientSrc.match(/export async function createProfileFromApprovedEmployee\([\s\S]*?\n\}/)
    assert.ok(fnMatch, 'could not locate createProfileFromApprovedEmployee')
    assert.match(fnMatch[0], /role:\s*employee\.portalRole/)
  })

  test('toApprovedEmployee accepts both manager and admin portal_role values — an admin roster row is never filtered out before reaching complete-profile', () => {
    const fnMatch = serviceClientSrc.match(/function toApprovedEmployee\([\s\S]*?\n\}/)
    assert.ok(fnMatch, 'could not locate toApprovedEmployee')
    assert.match(fnMatch[0], /row\.portal_role !== 'manager' && row\.portal_role !== 'admin'/)
  })

  test('createProfileFromApprovedEmployee copies submits_weekly_report verbatim from the roster employee — never hardcoded, never inferred from role', () => {
    const fnMatch = serviceClientSrc.match(/export async function createProfileFromApprovedEmployee\([\s\S]*?\n\}/)
    assert.ok(fnMatch, 'could not locate createProfileFromApprovedEmployee')
    assert.match(fnMatch[0], /submits_weekly_report: employee\.submitsWeeklyReport/)
  })

  test('calls clearPasswordChangeRequired in both the idempotent (already-found) and newly-created profile paths', () => {
    const occurrences = completeProfileSrc.match(/await clearPasswordChangeRequired\(userData\.user\.id\)/g) ?? []
    assert.equal(occurrences.length, 2, 'expected clearPasswordChangeRequired to be called on both the found and newly-created paths')
  })

  test('clearPasswordChangeRequired is called AFTER createProfileFromApprovedEmployee succeeds, never before or on failure', () => {
    const createIndex = completeProfileSrc.indexOf('const created = await createProfileFromApprovedEmployee(')
    const failureCheckIndex = completeProfileSrc.indexOf("if (!created) {")
    const clearIndex = completeProfileSrc.lastIndexOf('await clearPasswordChangeRequired(')
    assert.ok(createIndex !== -1 && failureCheckIndex !== -1 && clearIndex !== -1)
    assert.ok(createIndex < failureCheckIndex && failureCheckIndex < clearIndex)
  })
})

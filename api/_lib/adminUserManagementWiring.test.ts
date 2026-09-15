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

describe('Admin authorization — every Admin User Management endpoint authenticates before any privileged action', () => {
  for (const [name, src] of [
    ['list.ts', listSrc],
    ['invite.ts', inviteSrc],
    ['create-account.ts', createAccountSrc],
    ['set-active.ts', setActiveSrc],
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
        /await (listManagedUsers|addOrCreateManagerAccount|createAccountForExistingEmployee|setManagedUserActive)\(/,
      )
      assert.ok(authIndex !== -1 && privilegedCallIndex !== -1, `${name}: missing auth call or privileged call`)
      assert.ok(authIndex < privilegedCallIndex, `${name}: auth must be checked before any privileged action`)
    })
  }

  test('Manager denial is inherent: authenticateAdmin itself independently re-verifies role=admin and is_active on every call (see adminAuth.test.ts) — no endpoint here re-implements or bypasses that check', () => {
    for (const src of [listSrc, inviteSrc, createAccountSrc, setActiveSrc]) {
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

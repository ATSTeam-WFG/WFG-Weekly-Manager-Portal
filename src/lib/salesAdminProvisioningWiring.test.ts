// Run with: node --test src/lib/salesAdminProvisioningWiring.test.ts
//
// Source-inspection wiring tests for the new "Add Sales Admin" provisioning
// surface, same established pattern as salesAdminWiring.test.ts /
// salesRepManagementWiring.test.ts (no safe harness exists here for React
// components or serverless api/*.ts handlers that import the real
// Supabase clients). The pure decision logic
// (decideCreateSalesAdminAccountAction) is independently, directly
// unit-tested in salesAdminProvisioning.test.ts instead.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const dir = path.dirname(fileURLToPath(import.meta.url))
const inviteSalesAdminSrc = readFileSync(path.join(dir, '..', '..', 'api', 'admin', 'users', 'invite-sales-admin.ts'), 'utf8')
const supabaseServiceClientSrc = readFileSync(path.join(dir, '..', '..', 'api', '_lib', 'supabaseServiceClient.ts'), 'utf8')
const userManagementSrc = readFileSync(path.join(dir, '..', 'components', 'UserManagement.tsx'), 'utf8')
const salesAdminShellSrc = readFileSync(path.join(dir, '..', 'components', 'SalesAdminShell.tsx'), 'utf8')
const salesRepManagementSrc = readFileSync(path.join(dir, '..', 'components', 'SalesRepManagement.tsx'), 'utf8')
const adminUserManagementServiceSrc = readFileSync(path.join(dir, 'adminUserManagementService.ts'), 'utf8')

describe('api/admin/users/invite-sales-admin.ts — Admin-ONLY, never Sales-Admin-usable', () => {
  test('imports and calls authenticateAdmin', () => {
    assert.match(inviteSalesAdminSrc, /import \{ authenticateAdmin \} from '\.\.\/\.\.\/_lib\/adminAuth\.js'/)
    assert.match(inviteSalesAdminSrc, /await authenticateAdmin\(/)
  })

  test('never imports or calls authenticateAdminOrSalesAdmin — a Sales Admin must never create another Sales Admin', () => {
    assert.doesNotMatch(inviteSalesAdminSrc, /import \{[^}]*authenticateAdminOrSalesAdmin/)
    assert.doesNotMatch(inviteSalesAdminSrc, /await authenticateAdminOrSalesAdmin\(/)
  })

  test('never reads a role from the request body — only fullName/email are destructured', () => {
    assert.match(inviteSalesAdminSrc, /const body = \(req\.body \?\? \{\}\) as \{ fullName\?: unknown; email\?: unknown \}/)
    assert.doesNotMatch(inviteSalesAdminSrc, /body\.role/)
  })

  test('calls addOrCreateSalesAdminAccount, which hardcodes the role server-side', () => {
    assert.match(inviteSalesAdminSrc, /addOrCreateSalesAdminAccount\(fullName, email\)/)
  })
})

describe('api/_lib/supabaseServiceClient.ts — addOrCreateSalesAdminAccount hardcodes sales_admin', () => {
  test('the roster upsert hardcodes portal_role: \'sales_admin\', never a parameter', () => {
    assert.match(supabaseServiceClientSrc, /portal_role: 'sales_admin'/)
  })

  test('decideCreateSalesAdminAccountAction is imported from the dedicated, separate salesAdminProvisioning module', () => {
    assert.match(supabaseServiceClientSrc, /import \{ decideCreateSalesAdminAccountAction, type SalesAdminRosterSnapshot \} from '\.\/salesAdminProvisioning\.js'/)
  })
})

describe('src/lib/adminUserManagementService.ts — client never sends a role', () => {
  test('inviteSalesAdmin posts only fullName/email to invite-sales-admin', () => {
    assert.match(adminUserManagementServiceSrc, /fetch\('\/api\/admin\/users\/invite-sales-admin'/)
    assert.match(adminUserManagementServiceSrc, /body: JSON\.stringify\(\{ fullName, email \}\)/)
  })
})

describe('src/components/UserManagement.tsx — the only UI entry point, Admin-only surface', () => {
  test('renders a dedicated "+ Add Sales Admin" button, separate from "+ Add Manager"', () => {
    assert.match(userManagementSrc, /\+ Add Sales Admin/)
    assert.match(userManagementSrc, /\+ Add Manager/)
  })

  test('the Sales Admin modal has its own, separate state from the Add Manager modal', () => {
    assert.match(userManagementSrc, /isAddSalesAdminModalOpen/)
    assert.match(userManagementSrc, /handleCreateSalesAdminAccountSubmit/)
  })

  test('calls inviteSalesAdmin, not createManagerAccount, for the new modal\'s submit', () => {
    assert.match(userManagementSrc, /await inviteSalesAdmin\(trimmedName, trimmedEmail\)/)
  })
})

describe('the Sales Admin role\'s OWN screens never expose "Add Sales Admin" — UI-level defense in depth', () => {
  test('SalesAdminShell.tsx does not reference invite-sales-admin or inviteSalesAdmin', () => {
    assert.doesNotMatch(salesAdminShellSrc, /invite-sales-admin|inviteSalesAdmin/)
  })

  test('SalesRepManagement.tsx (the screen Sales Admin actually uses) does not reference invite-sales-admin or inviteSalesAdmin', () => {
    assert.doesNotMatch(salesRepManagementSrc, /invite-sales-admin|inviteSalesAdmin/)
  })
})

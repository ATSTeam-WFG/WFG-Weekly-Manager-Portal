// Run with: node --test src/lib/editEmployeeWiring.test.ts
//
// UserManagement.tsx/App.tsx depend on the real browser Supabase client, so
// they're not safe to import and execute directly here — this verifies the
// Edit Employee UI wiring via source inspection instead, the same
// established pattern used elsewhere in this project (see
// dualRoleRoutingWiring.test.ts, manualReminderFallbackWiring.test.ts). The
// underlying decision logic (decideUpdateEmployeeAction) is exhaustively,
// dynamically tested in api/_lib/adminUserManagement.test.ts; the privileged
// I/O layer (updateManagedEmployee) is covered via source inspection in
// api/_lib/adminUserManagementWiring.test.ts. This file covers only the
// client UI layer: stable-id row keys/targeting, and the self-lockout
// defense-in-depth control.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const dir = path.dirname(fileURLToPath(import.meta.url))
const userManagementSrc = readFileSync(path.join(dir, '..', 'components', 'UserManagement.tsx'), 'utf8')
const appSrc = readFileSync(path.join(dir, '..', 'App.tsx'), 'utf8')

describe('UserManagement.tsx rows and Edit Employee mutations key off the stable id, never email', () => {
  test('the list is keyed by user.id in both the editing and non-editing row branches — never user.email', () => {
    const keyMatches = userManagementSrc.match(/<li key=\{user\.(id|email)\}/g) ?? []
    assert.ok(keyMatches.length >= 2, 'expected at least two <li key={...}> row renders (editing and non-editing)')
    assert.ok(
      keyMatches.every((m) => m === '<li key={user.id}'),
      `every row key must be user.id, found: ${keyMatches.join(', ')}`,
    )
  })

  test('handleSaveEdit calls updateManagedEmployee with user.id as the target identifier', () => {
    const fnMatch = userManagementSrc.match(/const handleSaveEdit = async[\s\S]*?\n  \}/)
    assert.ok(fnMatch, 'could not locate handleSaveEdit')
    assert.match(fnMatch[0], /updateManagedEmployee\(user\.id, trimmedName, trimmedEmail, editRole, editSubmitsWeeklyReport\)/)
  })

  test('handleStartEdit pre-fills the edit form from the selected user\'s own current fields', () => {
    const fnMatch = userManagementSrc.match(/const handleStartEdit = \(user: ManagedUser\) => \{[\s\S]*?\n  \}/)
    assert.ok(fnMatch, 'could not locate handleStartEdit')
    assert.match(fnMatch[0], /setEditingId\(user\.id\)/)
    assert.match(fnMatch[0], /setEditFullName\(user\.fullName\)/)
    assert.match(fnMatch[0], /setEditEmail\(user\.email\)/)
    assert.match(fnMatch[0], /setEditRole\(user\.role\)/)
    assert.match(fnMatch[0], /setEditSubmitsWeeklyReport\(user\.submitsWeeklyReport\)/)
  })
})

describe('Edit action is available on every row, alongside the existing actions', () => {
  test('an Edit button exists, calling handleStartEdit, independent of role/status', () => {
    assert.match(userManagementSrc, /onClick=\{\(\) => handleStartEdit\(user\)\}/)
  })

  test('existing Create Account / Deactivate-Reactivate buttons and their email-based calls are untouched', () => {
    assert.match(userManagementSrc, /onClick=\{\(\) => handleCreateAccountForExisting\(user\)\}/)
    assert.match(userManagementSrc, /onClick=\{\(\) => handleToggleActive\(user\)\}/)
    const createAccountFnMatch = userManagementSrc.match(/const handleCreateAccountForExisting = async[\s\S]*?\n  \}/)
    const toggleActiveFnMatch = userManagementSrc.match(/const handleToggleActive = async[\s\S]*?\n  \}/)
    assert.ok(createAccountFnMatch && toggleActiveFnMatch)
    assert.match(createAccountFnMatch[0], /createAccountForExistingEmployee\(user\.email\)/)
    assert.match(toggleActiveFnMatch[0], /setUserActive\(user\.email, nextActive\)/)
  })
})

describe('Self-lockout defense in depth in the Edit form', () => {
  test('isEditingSelf compares the row being edited\'s email against the signed-in admin\'s own email — never anything else', () => {
    assert.match(
      userManagementSrc,
      /users\.find\(\(u\) => u\.id === editingId\)\?\.email\.trim\(\)\.toLowerCase\(\) === currentUserEmail\.trim\(\)\.toLowerCase\(\)/,
    )
  })

  test('the Portal Role select is disabled when editing your own row', () => {
    const selectMatch = userManagementSrc.match(/<select[\s\S]*?disabled=\{isEditingSelf\}[\s\S]*?<\/select>/)
    assert.ok(selectMatch, 'could not locate the role <select> with disabled={isEditingSelf}')
  })

  test('a visible note explains why the role field is disabled', () => {
    assert.match(userManagementSrc, /You cannot change your own role\./)
  })

  test('currentUserEmail is only ever used for this UI-side check — never sent to the server as part of the update request', () => {
    const saveEditFnMatch = userManagementSrc.match(/const handleSaveEdit = async[\s\S]*?\n  \}/)
    assert.ok(saveEditFnMatch)
    assert.equal(saveEditFnMatch[0].includes('currentUserEmail'), false)
  })
})

describe('App.tsx supplies the signed-in admin\'s own email to UserManagement', () => {
  test('UserManagement is rendered with currentUserEmail={userEmail}', () => {
    assert.match(appSrc, /<UserManagement onBack=\{\(\) => setUserManagementOpen\(false\)\} currentUserEmail=\{userEmail\} \/>/)
  })
})

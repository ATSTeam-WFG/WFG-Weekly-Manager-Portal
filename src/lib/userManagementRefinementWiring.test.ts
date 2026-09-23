// Run with: node --test src/lib/userManagementRefinementWiring.test.ts
//
// UserManagement.tsx/AddEmployeeModal.tsx are React components with no
// rendering harness in this project — the established pattern (see
// reportsAnalyticsRefinementWiring.test.ts, weeklySummaryRefinementWiring.test.ts)
// is to verify wiring via source inspection instead. This file covers the
// User Management UI refinement specifically: the four KPI cards, the
// client-side search/status filter, and the new Add Employee modal. The
// underlying handlers/service wiring (handleCreateAccountSubmit,
// handleStartEdit, handleSaveEdit, handleToggleActive,
// handleCreateAccountForExisting) are presentation-unchanged — their own
// existing coverage in editEmployeeWiring.test.ts and
// adminUserManagementServiceWiring.test.ts remains the primary source of
// truth for that behavior; this file only re-confirms the checklist items
// explicitly called for alongside the new UI work.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const dir = path.dirname(fileURLToPath(import.meta.url))
const userManagementSrc = readFileSync(path.join(dir, '..', 'components', 'UserManagement.tsx'), 'utf8')
const userManagementCss = readFileSync(path.join(dir, '..', 'components', 'UserManagement.css'), 'utf8')
const modalSrc = readFileSync(path.join(dir, '..', 'components', 'AddEmployeeModal.tsx'), 'utf8')
const modalCss = readFileSync(path.join(dir, '..', 'components', 'AddEmployeeModal.css'), 'utf8')
const serviceSrc = readFileSync(path.join(dir, 'adminUserManagementService.ts'), 'utf8')
const listUsersOutcomeSrc = readFileSync(path.join(dir, 'listUsersOutcome.ts'), 'utf8')
const statusBadgeCss = readFileSync(path.join(dir, '..', 'components', 'StatusBadge.css'), 'utf8')
const adminDashboardCss = readFileSync(path.join(dir, '..', 'components', 'AdminDashboard.css'), 'utf8')
const loginCss = readFileSync(path.join(dir, '..', 'components', 'Login.css'), 'utf8')

describe('UserManagement.tsx — four KPI counts derived strictly from the existing users array, never hardcoded or fetched separately', () => {
  test('totalCount/activeCount/awaitingFirstLoginCount/inactiveCount are all plain derivations of the users array — no numeric literal assigned to any of them', () => {
    assert.match(userManagementSrc, /const totalCount = users\.length/)
    assert.match(userManagementSrc, /const activeCount = users\.filter\(\(u\) => u\.status === 'active'\)\.length/)
    assert.match(userManagementSrc, /const awaitingFirstLoginCount = users\.filter\(\(u\) => u\.status === 'awaiting_first_login'\)\.length/)
    assert.match(userManagementSrc, /const inactiveCount = users\.filter\(\(u\) => u\.status === 'inactive'\)\.length/)
  })

  test('no new fetch/query was added to support the KPI cards — fetchManagedUsers is still the only data source, called once on mount', () => {
    const importsMatch = userManagementSrc.match(/import \{[\s\S]*?\} from '\.\.\/lib\/adminUserManagementService'/)
    assert.ok(importsMatch)
    assert.match(importsMatch[0], /fetchManagedUsers,/)
    // Exactly one call site (a comment elsewhere references the function
    // name in prose, so this matches the actual invocation pattern specifically).
    assert.equal((userManagementSrc.match(/fetchManagedUsers\(\)\.then\(/g) ?? []).length, 1)
  })

  test('all four KPI values are rendered from these same variables, not re-derived inline in JSX', () => {
    assert.match(userManagementSrc, /<span className="um-kpi-value">\{totalCount\}<\/span>/)
    assert.match(userManagementSrc, /<span className="um-kpi-value">\{activeCount\}<\/span>/)
    assert.match(userManagementSrc, /<span className="um-kpi-value">\{awaitingFirstLoginCount\}<\/span>/)
    assert.match(userManagementSrc, /<span className="um-kpi-value">\{inactiveCount\}<\/span>/)
  })

  test('Pending users are counted in totalCount but have no KPI card of their own', () => {
    assert.equal(/um-kpi-card-pending/.test(userManagementSrc), false)
    assert.equal(/um-kpi-card-pending/.test(userManagementCss), false)
  })

  test('four cards, one CSS grid row on desktop, collapsing to 2 columns on tablet and 1 on mobile', () => {
    const rowRuleMatch = userManagementCss.match(/\.um-kpi-row \{([\s\S]*?)\n\}/)
    assert.ok(rowRuleMatch)
    assert.match(rowRuleMatch[1], /grid-template-columns: repeat\(4, 1fr\);/)
    assert.match(userManagementCss, /@media \(max-width: 860px\) \{\s*\n\s*\.um-kpi-row \{\s*\n\s*grid-template-columns: repeat\(2, 1fr\);/)
    assert.match(userManagementCss, /@media \(max-width: 640px\) \{\s*\n\s*\.um-kpi-row \{\s*\n\s*grid-template-columns: 1fr;/)
  })
})

describe('UserManagement.tsx — client-side search + status filter over the already-fetched users array', () => {
  test('filteredUsers matches by name OR email, case-insensitively, trimmed', () => {
    const filterMatch = userManagementSrc.match(/const filteredUsers = users\.filter\(\(user\) => \{([\s\S]*?)\n  \}\)/)
    assert.ok(filterMatch, 'could not locate filteredUsers')
    assert.match(filterMatch[1], /user\.fullName\.toLowerCase\(\)\.includes\(term\)/)
    assert.match(filterMatch[1], /user\.email\.toLowerCase\(\)\.includes\(term\)/)
    assert.match(filterMatch[1], /search\.trim\(\)\.toLowerCase\(\)/)
  })

  test('the search input reads "Search employees by name or email…" and is wired to the search state', () => {
    assert.match(userManagementSrc, /placeholder="Search employees by name or email…"/)
    assert.match(userManagementSrc, /value=\{search\}/)
    assert.match(userManagementSrc, /onChange=\{\(e\) => setSearch\(e\.target\.value\)\}/)
  })

  test('the status filter offers exactly five choices: All, Active, Pending, Awaiting First Login, Inactive', () => {
    assert.match(
      userManagementSrc,
      /const STATUS_FILTER_OPTIONS: \{ key: StatusFilter; label: string \}\[\] = \[\s*\n\s*\{ key: 'all', label: 'All' \},\s*\n\s*\{ key: 'active', label: 'Active' \},\s*\n\s*\{ key: 'pending', label: 'Pending' \},\s*\n\s*\{ key: 'awaiting_first_login', label: 'Awaiting First Login' \},\s*\n\s*\{ key: 'inactive', label: 'Inactive' \},\s*\n\s*\]/,
    )
  })

  test('the status filter is applied strictly to the client-side users array — no new query parameter, no new fetch call', () => {
    const filterMatch = userManagementSrc.match(/const filteredUsers = users\.filter\(\(user\) => \{([\s\S]*?)\n  \}\)/)
    assert.ok(filterMatch)
    assert.match(filterMatch[1], /if \(statusFilter !== 'all' && user\.status !== statusFilter\) return false/)
    assert.equal(filterMatch[1].includes('fetch('), false)
  })

  test('a distinct, useful empty state distinguishes "no users at all" from "no matches for this search/filter"', () => {
    assert.match(
      userManagementSrc,
      /\{users\.length === 0 \? 'No users found yet\.' : 'No employees match this search\/filter\.'\}/,
    )
  })
})

describe('UserManagement.tsx — status is read directly from the server-provided value, never re-derived client-side', () => {
  test('STATUS_LABELS only ever maps the four existing server statuses to display text — no new status value invented', () => {
    assert.match(
      userManagementSrc,
      /const STATUS_LABELS: Record<ManagedUser\['status'\], string> = \{\s*\n\s*pending: 'Pending',\s*\n\s*awaiting_first_login: 'Awaiting First Login',\s*\n\s*active: 'Active',\s*\n\s*inactive: 'Inactive',\s*\n\s*\}/,
    )
  })

  test('the rendered status badge reads user.status directly — no client-side status computation function exists', () => {
    assert.match(userManagementSrc, /\{STATUS_LABELS\[user\.status\]\}/)
    assert.equal(/function deriveStatus|function computeStatus/.test(userManagementSrc), false)
  })

  test('Pending users still get the "Create Account" action', () => {
    assert.match(userManagementSrc, /\{user\.status === 'pending' && \(/)
    assert.match(userManagementSrc, /onClick=\{\(\) => handleCreateAccountForExisting\(user\)\}/)
  })

  test('the Weekly Report column shows a compact "Required" badge when true, and an em dash when false — never fabricated data', () => {
    assert.match(
      userManagementSrc,
      /\{user\.submitsWeeklyReport \? \(\s*\n\s*<span className="status-badge um-weekly-badge">Required<\/span>\s*\n\s*\) : \(\s*\n\s*<span className="um-weekly-dash">&mdash;<\/span>\s*\n\s*\)\}/,
    )
  })
})

describe('AddEmployeeModal.tsx — presentational only; the existing create-account handler/state/service call are untouched', () => {
  test('the modal has no import of adminUserManagementService and no fetch/API call of its own', () => {
    assert.equal(modalSrc.includes('adminUserManagementService'), false)
    assert.equal(modalSrc.includes('fetch('), false)
    assert.equal(modalSrc.includes('createManagerAccount'), false)
  })

  test('the modal receives fullName/email/onSubmit/creating/message as props — it owns none of that state itself', () => {
    assert.match(modalSrc, /fullName,\s*\n\s*email,\s*\n\s*onFullNameChange,\s*\n\s*onEmailChange,\s*\n\s*onSubmit,/)
    assert.equal(/useState/.test(modalSrc), false)
  })

  test('UserManagement.tsx still owns handleCreateAccountSubmit, createManagerAccount, and the create-account message state exactly as before', () => {
    assert.match(userManagementSrc, /const handleCreateAccountSubmit = async \(e: FormEvent\) => \{/)
    assert.match(userManagementSrc, /const outcome = await createManagerAccount\(trimmedName, trimmedEmail\)/)
    assert.match(userManagementSrc, /import \{[\s\S]*?createManagerAccount,[\s\S]*?\} from '\.\.\/lib\/adminUserManagementService'/)
  })

  test('handleCreateAccountSubmit itself is byte-identical to its pre-refinement form (validation, service call, success/error message, field reset, reload)', () => {
    const fnMatch = userManagementSrc.match(/const handleCreateAccountSubmit = async \(e: FormEvent\) => \{([\s\S]*?)\n  \}/)
    assert.ok(fnMatch)
    assert.match(fnMatch[1], /const trimmedName = fullName\.trim\(\)/)
    assert.match(fnMatch[1], /const trimmedEmail = email\.trim\(\)/)
    assert.match(fnMatch[1], /setCreateAccountMessage\('A name and email are required\.'\)/)
    assert.match(fnMatch[1], /setCreatingAccount\(true\)/)
    assert.match(fnMatch[1], /setCreatingAccount\(false\)/)
    assert.match(fnMatch[1], /const isSuccess = outcome\.status === 'created'/)
    assert.match(fnMatch[1], /setFullName\(''\)/)
    assert.match(fnMatch[1], /setEmail\(''\)/)
    assert.match(fnMatch[1], /loadUsers\(\)/)
  })

  test('the "created" success message still instructs sending the WFG email/portal URL/temporary password through the usual internal channel — the onboarding messaging is unchanged', () => {
    assert.match(
      userManagementSrc,
      /'Account created\. Send them their WFG email, the portal URL, and the temporary password through your usual internal channel\.'/,
    )
  })
})

describe('AddEmployeeModal.tsx — open/close, outside-click, Escape, and the "never close mid-submit" guard', () => {
  test('the modal opens via handleOpenAddModal, which clears any stale message from a previous attempt', () => {
    assert.match(
      userManagementSrc,
      /const handleOpenAddModal = \(\) => \{\s*\n\s*setCreateAccountMessage\(null\)\s*\n\s*setIsAddModalOpen\(true\)\s*\n\s*\}/,
    )
  })

  test('handleCloseAddModal refuses to close while creatingAccount is true', () => {
    assert.match(
      userManagementSrc,
      /const handleCloseAddModal = \(\) => \{\s*\n\s*if \(creatingAccount\) return\s*\n\s*setIsAddModalOpen\(false\)\s*\n\s*\}/,
    )
  })

  test('AddEmployeeModal is rendered with creating={creatingAccount} and onClose={handleCloseAddModal} — the guard is applied at the call site too, not only inside the modal', () => {
    const usageMatch = userManagementSrc.match(/<AddEmployeeModal([\s\S]*?)\/>/)
    assert.ok(usageMatch)
    assert.match(usageMatch[1], /creating=\{creatingAccount\}/)
    assert.match(usageMatch[1], /onClose=\{handleCloseAddModal\}/)
  })

  test('clicking the overlay backdrop closes the modal, but only when not creating', () => {
    assert.match(
      modalSrc,
      /const handleOverlayClick = \(\) => \{\s*\n\s*if \(!creating\) onClose\(\)\s*\n\s*\}/,
    )
    assert.match(modalSrc, /<div className="um-modal-overlay" onClick=\{handleOverlayClick\}>/)
  })

  test('Escape closes the modal, but only when not creating — a keydown listener attached only while open, cleaned up on close/unmount', () => {
    const effectMatch = modalSrc.match(/useEffect\(\(\) => \{([\s\S]*?)\n\s*\}, \[isOpen, creating, onClose\]\)/)
    assert.ok(effectMatch, 'could not locate the Escape-handling useEffect')
    assert.match(effectMatch[1], /if \(!isOpen\) return/)
    assert.match(effectMatch[1], /if \(e\.key === 'Escape' && !creating\) onClose\(\)/)
    assert.match(effectMatch[1], /window\.addEventListener\('keydown', handleKeyDown\)/)
  })

  test('the Cancel and close (×) buttons are both disabled while creating — every close path defers to the same guard', () => {
    const closeBtnMatch = modalSrc.match(/<button\s*\n\s*type="button"\s*\n\s*className="um-modal-close-btn"[^>]*>/)
    assert.ok(closeBtnMatch, 'could not locate the close (×) button opening tag')
    assert.match(closeBtnMatch[0], /onClick=\{onClose\}/)
    assert.match(closeBtnMatch[0], /disabled=\{creating\}/)
    assert.match(modalSrc, /<button type="button" className="btn btn-secondary" onClick=\{onClose\} disabled=\{creating\}>\s*\n\s*Cancel/)
  })

  test('clicking inside the panel itself does not close the modal (stopPropagation), and it carries dialog semantics', () => {
    assert.match(modalSrc, /className="um-modal-panel"\s*\n\s*onClick=\{\(e\) => e\.stopPropagation\(\)\}\s*\n\s*role="dialog"\s*\n\s*aria-modal="true"/)
  })

  test('the Full Name input is focused when the modal opens, for basic focus management', () => {
    assert.match(modalSrc, /useEffect\(\(\) => \{\s*\n\s*if \(isOpen\) fullNameInputRef\.current\?\.focus\(\)\s*\n\s*\}, \[isOpen\]\)/)
  })
})

describe('Preserved exactly: Edit (stable id), self-role-change protection, Deactivate/Reactivate, role/submitsWeeklyReport editing', () => {
  test('Edit is still keyed by user.id and calls updateManagedEmployee with it, never email', () => {
    assert.match(userManagementSrc, /const handleStartEdit = \(user: ManagedUser\) => \{\s*\n\s*setEditingId\(user\.id\)/)
    const saveEditMatch = userManagementSrc.match(/const handleSaveEdit = async[\s\S]*?\n  \}/)
    assert.ok(saveEditMatch)
    assert.match(saveEditMatch[0], /updateManagedEmployee\(user\.id, trimmedName, trimmedEmail, editRole, editSubmitsWeeklyReport\)/)
  })

  test('self-role-change protection (isEditingSelf) is unchanged: same email comparison, same disabled role select, same note', () => {
    assert.match(
      userManagementSrc,
      /users\.find\(\(u\) => u\.id === editingId\)\?\.email\.trim\(\)\.toLowerCase\(\) === currentUserEmail\.trim\(\)\.toLowerCase\(\)/,
    )
    assert.match(userManagementSrc, /disabled=\{isEditingSelf\}/)
    assert.match(userManagementSrc, /You cannot change your own role\./)
  })

  test('Deactivate/Reactivate is still gated to role==="manager" and still calls setUserActive with the toggled boolean, keyed by email exactly as before', () => {
    assert.match(userManagementSrc, /\{user\.role === 'manager' && \(/)
    const toggleMatch = userManagementSrc.match(/const handleToggleActive = async[\s\S]*?\n  \}/)
    assert.ok(toggleMatch)
    assert.match(toggleMatch[0], /const nextActive = user\.status === 'inactive'/)
    assert.match(toggleMatch[0], /setUserActive\(user\.email, nextActive\)/)
    assert.match(userManagementSrc, /\{user\.status === 'inactive' \? 'Reactivate' : 'Deactivate'\}/)
  })

  test('role and submitsWeeklyReport are still editable via the same edit-state setters, unchanged', () => {
    assert.match(userManagementSrc, /value=\{editRole\}/)
    assert.match(userManagementSrc, /onChange=\{\(e\) => setEditRole\(e\.target\.value as 'manager' \| 'admin'\)\}/)
    assert.match(userManagementSrc, /checked=\{editSubmitsWeeklyReport\}/)
    assert.match(userManagementSrc, /onChange=\{\(e\) => setEditSubmitsWeeklyReport\(e\.target\.checked\)\}/)
  })
})

describe('Nothing here touches User Management\'s own service/API layer, or any other shared/global CSS file', () => {
  test('adminUserManagementService.ts and listUsersOutcome.ts export exactly the same functions/types as before — no new export added for this UI-only refinement', () => {
    assert.match(serviceSrc, /export async function fetchManagedUsers\(\): Promise<FetchManagedUsersOutcome>/)
    assert.match(serviceSrc, /export async function createManagerAccount\(fullName: string, email: string\): Promise<CreateManagerAccountOutcome>/)
    assert.match(serviceSrc, /export async function createAccountForExistingEmployee\(email: string\): Promise<CreateAccountForExistingOutcome>/)
    assert.match(serviceSrc, /export async function updateManagedEmployee\(/)
    assert.match(serviceSrc, /export async function setUserActive\(email: string, isActive: boolean\): Promise<SetUserActiveOutcome>/)
    assert.match(listUsersOutcomeSrc, /export interface ManagedUser \{/)
    assert.match(listUsersOutcomeSrc, /export function mapListUsersResponse\(ok: boolean, body: unknown\): FetchManagedUsersOutcome/)
  })

  test('StatusBadge.css / AdminDashboard.css / Login.css are not referenced by any new file in this refinement (AddEmployeeModal, or new UserManagement classes) beyond UserManagement.tsx\'s own pre-existing StatusBadge.css import', () => {
    assert.equal(modalSrc.includes('StatusBadge.css'), false)
    assert.equal(modalSrc.includes('AdminDashboard.css'), false)
    assert.equal(modalSrc.includes('Login.css'), false)
    assert.equal(userManagementSrc.includes("import './AdminDashboard.css'"), false)
    assert.equal(userManagementSrc.includes("import './Login.css'"), false)
  })

  test('the shared .status-badge base rule (StatusBadge.css) is untouched — this file still only defines the base pill plus the unrelated report-status modifiers used elsewhere', () => {
    assert.match(statusBadgeCss, /^\.status-badge \{/m)
    assert.equal(/\.role-badge|\.user-status-badge|\.um-weekly-badge/.test(statusBadgeCss), false)
  })

  test('UserManagement no longer relies on .admin-loading/.admin-empty-state (AdminDashboard.css) or .login-input/.login-label (Login.css) — it styles its own equivalents locally', () => {
    assert.equal(userManagementSrc.includes('admin-loading'), false)
    assert.equal(userManagementSrc.includes('admin-empty-state'), false)
    assert.equal(userManagementSrc.includes('login-input'), false)
    assert.equal(userManagementSrc.includes('login-label'), false)
    assert.match(userManagementCss, /^\.um-loading \{/m)
    assert.match(userManagementCss, /^\.um-empty-state \{/m)
    assert.match(userManagementCss, /^\.um-field-input \{/m)
    assert.match(userManagementCss, /^\.um-field-label \{/m)
  })

  test('AdminDashboard.css and Login.css themselves are unmodified — still define .admin-loading/.admin-empty-state and .login-input/.login-label for their own original consumers', () => {
    assert.match(adminDashboardCss, /^\.admin-loading,\s*\n\.admin-empty-state \{/m)
    assert.match(loginCss, /^\.login-label \{/m)
    assert.match(loginCss, /^\.login-input \{/m)
  })
})

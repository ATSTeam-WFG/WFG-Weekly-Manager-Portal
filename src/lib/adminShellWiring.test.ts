// Run with: node --test src/lib/adminShellWiring.test.ts
//
// App.tsx/AdminShell.tsx/AdminSidebar.tsx are React components with no
// rendering harness in this project — the established pattern (see
// dualRoleRoutingWiring.test.ts, userManagementRefinementWiring.test.ts) is
// to verify wiring via source inspection instead.
//
// Feature this covers: Step 1 of the Admin Dashboard + Navigation Shell
// refinement — a shared AdminShell/AdminSidebar wrapping the four admin
// destinations (Admin Dashboard, User Management, Reports & Analytics,
// Weekly Summary), reusing App.tsx's existing navigation state
// (weeklySummaryOpen/reportsAnalyticsOpen/userManagementOpen) rather than
// introducing routing or a second navigation-state model. AdminDashboard's
// own content/metrics are untouched in this step.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const dir = path.dirname(fileURLToPath(import.meta.url))
const appSrc = readFileSync(path.join(dir, '..', 'App.tsx'), 'utf8')
const shellSrc = readFileSync(path.join(dir, '..', 'components', 'AdminShell.tsx'), 'utf8')
const shellCss = readFileSync(path.join(dir, '..', 'components', 'AdminShell.css'), 'utf8')
const sidebarSrc = readFileSync(path.join(dir, '..', 'components', 'AdminSidebar.tsx'), 'utf8')
const sidebarCss = readFileSync(path.join(dir, '..', 'components', 'AdminSidebar.css'), 'utf8')
const headerSrc = readFileSync(path.join(dir, '..', 'components', 'Header.tsx'), 'utf8')
const adminDashboardSrc = readFileSync(path.join(dir, '..', 'components', 'AdminDashboard.tsx'), 'utf8')

// Originally "exactly four destinations" — the Leadership Report phase
// (see leadershipReportWiring.test.ts, its own dedicated coverage) added a
// 5th, restructuring the flat `items` array into grouped `groups` with
// dividers. This describe block's own intent (a fixed, fully-enumerated set
// of destinations, no stray extras like a manager-report/my-report item)
// still holds — just against the current count and structure.
describe('AdminSidebar.tsx — exactly five destinations, no more, no fewer', () => {
  test('AdminDestination is exactly the five-value union (not merely a superset — checked with an end anchor)', () => {
    assert.match(
      sidebarSrc,
      /export type AdminDestination = 'dashboard' \| 'user-management' \| 'reports-analytics' \| 'weekly-summary' \| 'leadership-report'\s*\n/,
    )
  })

  test('the rendered groups array has exactly five entries total across its groups, one per destination, each with its own label', () => {
    const groupsMatch = sidebarSrc.match(/const groups: \{[\s\S]*?\}\[\]\[\] = \[([\s\S]*?)\n  \]\s*\n/)
    assert.ok(groupsMatch, 'could not locate the groups array')
    const body = groupsMatch[1]
    assert.match(body, /key: 'dashboard', label: 'Admin Dashboard'/)
    assert.match(body, /key: 'weekly-summary', label: 'Weekly Summary'/)
    assert.match(body, /key: 'leadership-report', label: 'Leadership Report'/)
    assert.match(body, /key: 'user-management', label: 'User Management'/)
    assert.match(body, /key: 'reports-analytics', label: 'Reports & Analytics'/)
    // Exactly five — no sixth entry (e.g. a manager-report or my-report item).
    assert.equal((body.match(/key: '/g) ?? []).length, 5)
  })

  test('the active item gets aria-current="page" and the -active modifier class; inactive items get neither', () => {
    assert.match(
      sidebarSrc,
      /className=\{`admin-sidebar-item \$\{current === item\.key \? 'admin-sidebar-item-active' : ''\}`\}/,
    )
    assert.match(sidebarSrc, /aria-current=\{current === item\.key \? 'page' : undefined\}/)
  })

  test('icons are simple inline SVGs (no icon package import) — the Users icon is explicitly the same glyph already used elsewhere for people/manager counts, not a new invention', () => {
    assert.equal(/from ['"](react-icons|@heroicons|lucide-react|@fortawesome)/.test(sidebarSrc), false)
    assert.match(sidebarSrc, /function UsersIcon\(\)/)
    assert.match(sidebarSrc, /<circle cx="9" cy="8" r="3" \/>/)
  })

  test('active-state CSS matches the approved direction: subtle terracotta background, terracotta left accent, stronger (bold) text', () => {
    const activeRuleMatch = sidebarCss.match(/\.admin-sidebar-item-active,\s*\n\.admin-sidebar-item-active:hover \{([\s\S]*?)\n\}/)
    assert.ok(activeRuleMatch, 'could not locate the active sidebar item rule')
    assert.match(activeRuleMatch[1], /background: rgba\(183, 101, 74,/)
    assert.match(activeRuleMatch[1], /border-left-color: var\(--terracotta\);/)
    assert.match(activeRuleMatch[1], /color: var\(--terracotta\);/)
    assert.match(activeRuleMatch[1], /font-weight: 700;/)
  })

  test('inactive items are neutral (no background) with dark espresso text and a subtle hover', () => {
    const baseRuleMatch = sidebarCss.match(/\.admin-sidebar-item \{([\s\S]*?)\n\}/)
    assert.ok(baseRuleMatch)
    assert.match(baseRuleMatch[1], /color: var\(--espresso\);/)
    assert.equal(/background: (?!none)/.test(baseRuleMatch[1]), false)
    const hoverRuleMatch = sidebarCss.match(/\.admin-sidebar-item:hover \{([\s\S]*?)\n\}/)
    assert.ok(hoverRuleMatch)
    assert.match(hoverRuleMatch[1], /background: var\(--warm-cream\);/)
  })
})

describe('App.tsx — current destination is derived from existing state, never a new state variable', () => {
  // Extended by the Leadership Report phase to also resolve
  // leadershipReportOpen — still a plain derived const, still no new
  // navigation-state model (see leadershipReportWiring.test.ts for that
  // phase's own dedicated coverage of the extension itself).
  test('currentAdminDestination is a plain derived const, not a useState — reads the same booleans (now including leadershipReportOpen)', () => {
    assert.match(
      appSrc,
      /const currentAdminDestination: AdminDestination = userManagementOpen\s*\n\s*\? 'user-management'\s*\n\s*: reportsAnalyticsOpen\s*\n\s*\? 'reports-analytics'\s*\n\s*: leadershipReportOpen\s*\n\s*\? 'leadership-report'\s*\n\s*: weeklySummaryOpen\s*\n\s*\? 'weekly-summary'\s*\n\s*: 'dashboard'/,
    )
    assert.equal(/useState<AdminDestination>/.test(appSrc), false)
  })

  test('no new navigation-state variable, router, or URL manipulation was introduced', () => {
    assert.equal(/from ['"]react-router/.test(appSrc), false)
    assert.equal(appSrc.includes('window.history.pushState'), false)
    assert.equal(appSrc.includes('useNavigate'), false)
    // The only pre-existing history call in this file is the auth-link-error
    // query-string cleanup, untouched — never a route push.
    assert.match(appSrc, /window\.history\.replaceState\(null, '', window\.location\.pathname\)/)
  })

  test('the four existing booleans (weeklySummaryOpen/reportsAnalyticsOpen/userManagementOpen + myReportOpen) are still the same useState declarations as before — none renamed, none removed, none added', () => {
    assert.match(appSrc, /const \[weeklySummaryOpen, setWeeklySummaryOpen\] = useState\(false\)/)
    assert.match(appSrc, /const \[reportsAnalyticsOpen, setReportsAnalyticsOpen\] = useState\(false\)/)
    assert.match(appSrc, /const \[userManagementOpen, setUserManagementOpen\] = useState\(false\)/)
    assert.match(appSrc, /const \[myReportOpen, setMyReportOpen\] = useState\(false\)/)
  })
})

describe('App.tsx — navigation handlers call the existing setters and reset the other two flags for mutual exclusivity', () => {
  test('each handler is a small function that sets all three flags explicitly, deriving mutual exclusivity from the SAME setters that already existed', () => {
    const dashboardFn = appSrc.match(/const handleNavigateToDashboard = \(\) => \{([\s\S]*?)\n  \}/)
    const userMgmtFn = appSrc.match(/const handleNavigateToUserManagement = \(\) => \{([\s\S]*?)\n  \}/)
    const raFn = appSrc.match(/const handleNavigateToReportsAnalytics = \(\) => \{([\s\S]*?)\n  \}/)
    const wsFn = appSrc.match(/const handleNavigateToWeeklySummary = \(\) => \{([\s\S]*?)\n  \}/)
    assert.ok(dashboardFn && userMgmtFn && raFn && wsFn, 'could not locate all four navigation handlers')

    assert.match(dashboardFn[1], /setWeeklySummaryOpen\(false\)/)
    assert.match(dashboardFn[1], /setReportsAnalyticsOpen\(false\)/)
    assert.match(dashboardFn[1], /setUserManagementOpen\(false\)/)

    assert.match(userMgmtFn[1], /setWeeklySummaryOpen\(false\)/)
    assert.match(userMgmtFn[1], /setReportsAnalyticsOpen\(false\)/)
    assert.match(userMgmtFn[1], /setUserManagementOpen\(true\)/)

    assert.match(raFn[1], /setWeeklySummaryOpen\(false\)/)
    assert.match(raFn[1], /setReportsAnalyticsOpen\(true\)/)
    assert.match(raFn[1], /setUserManagementOpen\(false\)/)

    assert.match(wsFn[1], /setWeeklySummaryOpen\(true\)/)
    assert.match(wsFn[1], /setReportsAnalyticsOpen\(false\)/)
    assert.match(wsFn[1], /setUserManagementOpen\(false\)/)
  })

  test('AdminShell is rendered with these four handlers wired to its four onNavigate* props', () => {
    const shellUsageMatch = appSrc.match(/<AdminShell\s*\n([\s\S]*?)\n\s*>/)
    assert.ok(shellUsageMatch, 'could not locate <AdminShell> usage in App.tsx')
    assert.match(shellUsageMatch[1], /current=\{currentAdminDestination\}/)
    assert.match(shellUsageMatch[1], /onNavigateDashboard=\{handleNavigateToDashboard\}/)
    assert.match(shellUsageMatch[1], /onNavigateUserManagement=\{handleNavigateToUserManagement\}/)
    assert.match(shellUsageMatch[1], /onNavigateReportsAnalytics=\{handleNavigateToReportsAnalytics\}/)
    assert.match(shellUsageMatch[1], /onNavigateWeeklySummary=\{handleNavigateToWeeklySummary\}/)
  })
})

describe('App.tsx — ManagerReportView and My Weekly Report remain OUTSIDE the sidebar, exactly as before', () => {
  test('ManagerReportView is rendered as the sibling branch BEFORE AdminShell, not inside it — selectedManager gates it, not any sidebar destination', () => {
    const branchMatch = appSrc.match(/selectedManager \? \(([\s\S]*?)\n\s*\) : \(\s*\n\s*<AdminShell/)
    assert.ok(branchMatch, 'could not locate the selectedManager ? ManagerReportView : <AdminShell> branching')
    assert.match(branchMatch[1], /<ManagerReportView/)
  })

  test('AdminShell itself never imports or renders ManagerReportView (a comment in AdminSidebar.tsx explains why it is excluded from the destination union, but neither file imports or renders it)', () => {
    assert.equal(/from ['"]\.\/ManagerReportView['"]/.test(shellSrc), false)
    assert.equal(/<ManagerReportView/.test(shellSrc), false)
    assert.equal(/from ['"]\.\/ManagerReportView['"]/.test(sidebarSrc), false)
    assert.equal(/<ManagerReportView/.test(sidebarSrc), false)
  })

  test('the isAdmin && !myReportOpen top-level split is unchanged — My Weekly Report still routes to the entirely separate Manager-facing branch, never through AdminShell', () => {
    assert.match(appSrc, /\{isAdmin && !myReportOpen \? \(/)
    assert.equal(shellSrc.includes('myReportOpen'), false)
    assert.equal(sidebarSrc.includes('myReportOpen'), false)
  })

  test('the "Back to Admin Dashboard" button for My Weekly Report is untouched', () => {
    assert.match(
      appSrc,
      /\{isAdmin && myReportOpen && \(\s*\n\s*<button type="button" className="link-btn back-link" onClick=\{\(\) => setMyReportOpen\(false\)\}>/,
    )
  })
})

describe('App.tsx — the four destination components still render with their exact same props', () => {
  test('WeeklySummary, ReportsAnalytics, UserManagement, and AdminDashboard are still rendered with the same props as before, now inside AdminShell\'s children', () => {
    const childrenMatch = appSrc.match(/<AdminShell[\s\S]*?>\s*\n([\s\S]*?)\n\s*<\/AdminShell>/)
    assert.ok(childrenMatch, 'could not locate AdminShell\'s children block')
    const body = childrenMatch[1]
    // WeeklySummary gained its own independent week-nav props in a later
    // phase (weeklySummaryWeek/weeklySummaryWeekOffset, no longer
    // adminWeek/adminWeekOffset) — see weeklySummaryWeekNavWiring.test.ts
    // for that change's own dedicated coverage; this check only needs to
    // confirm it's still rendered inside AdminShell's children at all.
    assert.match(body, /<WeeklySummary\s*\n\s*week=\{weeklySummaryWeek\}/)
    assert.match(body, /<ReportsAnalytics onBack=\{\(\) => setReportsAnalyticsOpen\(false\)\} \/>/)
    assert.match(body, /<UserManagement onBack=\{\(\) => setUserManagementOpen\(false\)\} currentUserEmail=\{userEmail\} \/>/)
    assert.match(body, /<AdminDashboard\s*\n\s*week=\{adminWeek\}/)
    assert.match(body, /onSelectManager=\{setSelectedManager\}/)
    assert.match(body, /onOpenMyReport=\{isSubmitter \? \(\) => setMyReportOpen\(true\) : undefined\}/)
  })

  test('the existing individual Back links/handlers on each destination (onBack) are untouched — Step 1 does not remove them', () => {
    assert.match(appSrc, /onBack=\{\(\) => setWeeklySummaryOpen\(false\)\}/)
    assert.match(appSrc, /onBack=\{\(\) => setReportsAnalyticsOpen\(false\)\}/)
    assert.match(appSrc, /onBack=\{\(\) => setUserManagementOpen\(false\)\}/)
  })

  test('AdminDashboard.tsx\'s own content/metrics/list logic is out of scope for this shell test file — Step 2 (adminDashboardRefinementWiring.test.ts) owns that coverage; this file only confirms the shell still renders it with the props it still needs', () => {
    assert.match(adminDashboardSrc, /interface AdminDashboardProps \{/)
    assert.match(adminDashboardSrc, /const total = managers\.length/)
    assert.match(adminDashboardSrc, /const pendingReminderTargets = getReminderTargets\(managers\)/)
  })
})

describe('AdminShell.tsx — presentational only; App.tsx remains the sole owner of navigation state', () => {
  test('AdminShell owns only the mobile off-canvas open/close boolean — no other useState', () => {
    const useStateMatches = shellSrc.match(/useState\(/g) ?? []
    assert.equal(useStateMatches.length, 1)
    assert.match(shellSrc, /const \[isMobileNavOpen, setIsMobileNavOpen\] = useState\(false\)/)
  })

  test('AdminShell never imports adminService/reminderService/reportsService or any data-fetching module', () => {
    assert.equal(/from ['"]\.\.\/lib\//.test(shellSrc), false)
    assert.equal(/from ['"]\.\.\/lib\//.test(sidebarSrc), false)
  })

  test('children (the currently-selected destination element) are rendered as-is, not cloned or wrapped further', () => {
    assert.match(shellSrc, /<div className="admin-shell-content">\{children\}<\/div>/)
  })
})

describe('AdminShell — mobile menu open/close behavior', () => {
  test('the menu button opens the mobile nav; the scrim and every navigation click close it', () => {
    assert.match(shellSrc, /onClick=\{\(\) => setIsMobileNavOpen\(true\)\}/)
    assert.match(shellSrc, /className="admin-shell-scrim" onClick=\{\(\) => setIsMobileNavOpen\(false\)\}/)
    assert.match(
      shellSrc,
      /const handleNavigate = \(action: \(\) => void\) => \{\s*\n\s*action\(\)\s*\n\s*setIsMobileNavOpen\(false\)\s*\n\s*\}/,
    )
  })

  test('all four AdminSidebar callbacks are wrapped through handleNavigate, so choosing any destination on mobile also closes the panel', () => {
    assert.match(shellSrc, /onNavigateDashboard=\{\(\) => handleNavigate\(onNavigateDashboard\)\}/)
    assert.match(shellSrc, /onNavigateUserManagement=\{\(\) => handleNavigate\(onNavigateUserManagement\)\}/)
    assert.match(shellSrc, /onNavigateReportsAnalytics=\{\(\) => handleNavigate\(onNavigateReportsAnalytics\)\}/)
    assert.match(shellSrc, /onNavigateWeeklySummary=\{\(\) => handleNavigate\(onNavigateWeeklySummary\)\}/)
  })

  test('the sidebar wrap is off-canvas (hidden via transform) below the 860px breakpoint, and the menu button is desktop-hidden by default', () => {
    assert.match(shellCss, /\.admin-shell-menu-btn \{\s*\n\s*display: none;\s*\n\}/)
    const mobileBlockMatch = shellCss.match(/@media \(max-width: 860px\) \{([\s\S]*)\n\}\s*$/)
    assert.ok(mobileBlockMatch)
    assert.match(mobileBlockMatch[1], /\.admin-shell-menu-btn \{\s*\n\s*display: inline-flex;/)
    assert.match(mobileBlockMatch[1], /transform: translateX\(-100%\);/)
    assert.match(mobileBlockMatch[1], /\.admin-shell-sidebar-wrap-open \{\s*\n\s*transform: translateX\(0\);\s*\n\s*\}/)
  })
})

describe('Nothing in Step 1 touches the protected files or shared classes', () => {
  test('AdminShell never replaces or imports Header — the two are separate, independently-editable siblings in App.tsx (Header itself was later authorized for a separate, presentation-only refinement — see headerRefinementWiring coverage)', () => {
    assert.equal(shellSrc.includes('Header'), false)
    assert.match(headerSrc, /<header className="header">/)
    assert.match(headerSrc, /<span className="header-title">Weekly Manager Report<\/span>/)
  })

  test('the shared classes AdminDashboard/ReportsAnalytics both rely on are never redefined by the new shell files', () => {
    for (const css of [shellCss, sidebarCss]) {
      assert.equal(/^\.admin-dashboard\s*\{/m.test(css), false)
      assert.equal(/^\.admin-loading\s*\{/m.test(css), false)
      assert.equal(/^\.admin-empty-state\s*\{/m.test(css), false)
      assert.equal(/^\.week-nav-btn\s*\{/m.test(css), false)
      assert.equal(/^\.week-selector-label\s*\{/m.test(css), false)
    }
  })

  test('AdminDashboard.tsx\'s filter logic still exists — its exact presentation (root class, KPI/table markup) is Step 2\'s own scope, covered in adminDashboardRefinementWiring.test.ts', () => {
    assert.match(adminDashboardSrc, /const FILTERS: \{ key: FilterKey; label: string \}\[\] = \[/)
    assert.match(adminDashboardSrc, /label: 'Pending' \}/)
  })
})

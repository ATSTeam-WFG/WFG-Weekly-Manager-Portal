// Run with: node --test src/lib/adminDashboardRefinementWiring.test.ts
//
// AdminDashboard.tsx is a React component with no rendering harness in this
// project — the established pattern (see adminShellWiring.test.ts,
// userManagementRefinementWiring.test.ts) is to verify wiring via source
// inspection instead.
//
// Feature this covers: Step 2 of the Admin Dashboard + Navigation Shell
// refinement — the wider, cleaner Admin Dashboard content (header, week
// selector, 5 KPI cards, deadline strip, manager table) that fits inside
// the Step 1 AdminShell. All calculations, data loading, filter logic, and
// reminder behavior are byte-identical in substance to before this step —
// only presentation (markup/classes) changed.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const dir = path.dirname(fileURLToPath(import.meta.url))
const dashboardSrc = readFileSync(path.join(dir, '..', 'components', 'AdminDashboard.tsx'), 'utf8')
const dashboardCss = readFileSync(path.join(dir, '..', 'components', 'AdminDashboard.css'), 'utf8')
const appSrc = readFileSync(path.join(dir, '..', 'App.tsx'), 'utf8')
const reportsAnalyticsSrc = readFileSync(path.join(dir, '..', 'components', 'ReportsAnalytics.tsx'), 'utf8')

describe('AdminDashboard.tsx — exactly five KPI cards, all from the same existing calculations', () => {
  test('five cards exist: Total Managers, Submitted, Draft, Not Started, Completion — no Pending card', () => {
    const rowMatch = dashboardSrc.match(/<div className="adp-kpi-row">([\s\S]*?)\n {10}<\/div>\n\n {10}<div className="adp-deadline-strip">/)
    assert.ok(rowMatch, 'could not locate the KPI row')
    const body = rowMatch[1]
    assert.match(body, /<div className="adp-kpi-card adp-kpi-card-total">/)
    assert.match(body, /<div className="adp-kpi-card adp-kpi-card-submitted">/)
    assert.match(body, /<div className="adp-kpi-card adp-kpi-card-draft">/)
    assert.match(body, /<div className="adp-kpi-card adp-kpi-card-not-started">/)
    assert.match(body, /<div className="adp-kpi-card adp-kpi-card-completion">/)
    assert.equal((body.match(/adp-kpi-card adp-kpi-card-/g) ?? []).length, 5)
    assert.equal(body.includes('adp-kpi-card-pending'), false)
  })

  test('the five values read total/submitted/draft/notStarted/completionPct directly — the exact same existing calculations, untouched', () => {
    assert.match(dashboardSrc, /const total = managers\.length/)
    assert.match(dashboardSrc, /const submitted = managers\.filter\(\(m\) => m\.status === 'submitted'\)\.length/)
    assert.match(dashboardSrc, /const draft = managers\.filter\(\(m\) => m\.status === 'draft'\)\.length/)
    assert.match(dashboardSrc, /const notStarted = managers\.filter\(\(m\) => m\.status === 'not_started'\)\.length/)
    assert.match(dashboardSrc, /const completionPct = total > 0 \? Math\.round\(\(submitted \/ total\) \* 100\) : 0/)
    assert.match(dashboardSrc, /<span className="adp-kpi-value">\{total\}<\/span>/)
    assert.match(dashboardSrc, /<span className="adp-kpi-value">\{submitted\}<\/span>/)
    assert.match(dashboardSrc, /<span className="adp-kpi-value">\{draft\}<\/span>/)
    assert.match(dashboardSrc, /<span className="adp-kpi-value">\{notStarted\}<\/span>/)
    assert.match(dashboardSrc, /<span className="adp-kpi-value">\{completionPct\}%<\/span>/)
  })

  test('five cards is one desktop row (repeat(5, 1fr)), wrapping at narrower widths', () => {
    const rowRuleMatch = dashboardCss.match(/\.adp-kpi-row \{([\s\S]*?)\n\}/)
    assert.ok(rowRuleMatch)
    assert.match(rowRuleMatch[1], /grid-template-columns: repeat\(5, 1fr\);/)
    assert.match(dashboardCss, /@media \(max-width: 1024px\) \{\s*\n\s*\.adp-kpi-row \{\s*\n\s*grid-template-columns: repeat\(3, 1fr\);/)
    assert.match(dashboardCss, /@media \(max-width: 640px\) \{\s*\n\s*\.adp-kpi-row \{\s*\n\s*grid-template-columns: repeat\(2, 1fr\);/)
  })
})

describe('Pending: KPI card removed, but every other Pending-driven behavior remains completely intact', () => {
  test('pendingReminderTargets is still computed via the single canonical getReminderTargets(managers) — no second implementation, no reinterpretation as a report status', () => {
    assert.match(dashboardSrc, /import \{ getReminderTargets, type ReminderTarget \} from '\.\.\/lib\/reminderService'/)
    assert.match(dashboardSrc, /const pendingReminderTargets = getReminderTargets\(managers\)/)
    assert.match(dashboardSrc, /const needsAttention = pendingReminderTargets\.length/)
  })

  test('the Pending filter chip (All/Submitted/Draft/Not Started/Pending) is still one of exactly five FILTERS, with the exact same matchesFilter logic', () => {
    assert.match(
      dashboardSrc,
      /const FILTERS: \{ key: FilterKey; label: string \}\[\] = \[\s*\n\s*\{ key: 'all', label: 'All' \},\s*\n\s*\{ key: 'submitted', label: 'Submitted' \},\s*\n\s*\{ key: 'draft', label: 'Draft' \},\s*\n\s*\{ key: 'not_started', label: 'Not Started' \},\s*\n\s*\{ key: 'needs_attention', label: 'Pending' \},\s*\n\s*\]/,
    )
    assert.match(dashboardSrc, /function matchesFilter\(manager: ManagerSummary, filter: FilterKey\): boolean \{/)
    assert.match(dashboardSrc, /if \(filter === 'needs_attention'\) return manager\.status !== 'submitted'/)
  })

  test('Prepare Reminders still reads needsAttention/pendingReminderTargets unchanged and opens the same ReminderPanel', () => {
    assert.match(dashboardSrc, /\{needsAttention > 0 && \(/)
    assert.match(dashboardSrc, /Prepare Reminders \(\{needsAttention\}\)/)
    assert.match(dashboardSrc, /onClick=\{\(\) => setReminderTarget\(pendingReminderTargets\)\}/)
  })

  test('per-manager reminder eligibility/action is unchanged: the Remind button still only shows for a non-submitted manager, and still calls getReminderTargets([manager])', () => {
    assert.match(dashboardSrc, /setReminderTarget\(getReminderTargets\(\[manager\]\)\)/)
  })
})

describe('AdminDashboard.tsx — manager table preserves onSelectManager, submission data, and existing status/timestamp logic', () => {
  test('clicking or activating a row still calls onSelectManager(manager) — click and Enter/Space keyboard access both preserved', () => {
    assert.match(dashboardSrc, /onClick=\{\(\) => onSelectManager\(manager\)\}/)
    assert.match(dashboardSrc, /if \(e\.key === 'Enter' \|\| e\.key === ' '\) onSelectManager\(manager\)/)
  })

  test('the Submitted column uses the real submittedAt/submissionSource fields — no fabricated timestamp — and shows an em dash when not applicable', () => {
    assert.match(dashboardSrc, /manager\.submittedAt \? formatSubmittedAt\(manager\.submittedAt\) : '—'/)
    assert.match(dashboardSrc, /getSubmissionSourceLabel\(manager\)/)
    assert.match(dashboardSrc, /<span className="adp-dash">—<\/span>/)
  })

  test('getSubmissionSourceLabel and formatSubmittedAt are unchanged pure functions of ManagerSummary', () => {
    assert.match(
      dashboardSrc,
      /function getSubmissionSourceLabel\(manager: ManagerSummary\): string \| null \{\s*\n\s*if \(manager\.status !== 'submitted' \|\| !manager\.submissionSource\) return null\s*\n\s*return manager\.submissionSource === 'automatic' \? 'Submitted automatically' : 'Submitted manually'/,
    )
    assert.match(
      dashboardSrc,
      /function formatSubmittedAt\(iso: string\) \{\s*\n\s*return new Date\(iso\)\.toLocaleString\('en-US', \{/,
    )
  })

  test('Submission Status still uses the existing shared StatusBadge component with the server-provided status — no client-side status re-derivation', () => {
    assert.match(dashboardSrc, /import StatusBadge from '\.\/StatusBadge'/)
    assert.match(dashboardSrc, /<StatusBadge status=\{manager\.status\} \/>/)
  })

  test('Report column preserves the existing View/View Report wording exactly', () => {
    assert.match(dashboardSrc, /\{manager\.status === 'submitted' \? 'View Report' : 'View'\} &rarr;/)
  })

  test('no kebab/three-dot Actions menu was added', () => {
    assert.equal(/kebab|three-dot|⋮|•••|Actions menu/i.test(dashboardSrc), false)
  })
})

describe('AdminDashboard.tsx — week navigation and Friday deadline calculations are untouched', () => {
  test('onPreviousWeek/onNextWeek and the current-week disabled guard are wired exactly as before', () => {
    assert.match(dashboardSrc, /onClick=\{onPreviousWeek\}/)
    assert.match(dashboardSrc, /onClick=\{onNextWeek\}/)
    assert.match(dashboardSrc, /disabled=\{isCurrentWeek\}/)
    assert.match(dashboardSrc, /\{isCurrentWeek && <span className="week-current-badge">Current<\/span>\}/)
  })

  test('isPastEasternCutoff(15, 0) and getDaysUntilDeadline are still the only deadline calculations, unchanged', () => {
    assert.match(dashboardSrc, /import \{ isPastEasternCutoff \} from '\.\.\/utils\/easternTime'/)
    assert.match(dashboardSrc, /const isPastDeadline = isPastEasternCutoff\(15, 0\)/)
    assert.match(dashboardSrc, /const daysLeft = getDaysUntilDeadline\(week\.fridayDate\)/)
    assert.match(dashboardSrc, /const isDueToday = !isPastDeadline && daysLeft <= 0/)
  })

  test('the deadline strip still renders the same three pieces of information: deadline label, and the same passed/due-today/days-remaining ternary', () => {
    assert.match(dashboardSrc, /Due \{week\.deadlineLabel\}/)
    assert.match(
      dashboardSrc,
      /\{isPastDeadline \? 'Deadline passed' : isDueToday \? 'Due today' : `\$\{daysLeft\} day\$\{daysLeft === 1 \? '' : 's'\} remaining`\}/,
    )
  })

  test('ReminderPanel still receives the same isPastDeadline value, unchanged', () => {
    assert.match(dashboardSrc, /<ReminderPanel\s*\n\s*managers=\{reminderTarget\}\s*\n\s*week=\{week\}\s*\n\s*isPastDeadline=\{isPastDeadline\}/)
  })
})

describe('AdminDashboard.tsx — the three redundant navigation buttons are removed; My Weekly Report is preserved', () => {
  test('User Management / Reports & Analytics / Weekly Summary buttons no longer exist in AdminDashboard.tsx', () => {
    assert.equal(dashboardSrc.includes('user-management-btn'), false)
    assert.equal(dashboardSrc.includes('reports-analytics-btn'), false)
    assert.equal(dashboardSrc.includes('weekly-summary-btn'), false)
    assert.equal(/>\s*User Management\s*</.test(dashboardSrc), false)
    assert.equal(/>\s*Reports &amp; Analytics\s*</.test(dashboardSrc), false)
    assert.equal(/>\s*Weekly Summary\s*</.test(dashboardSrc), false)
  })

  test('the corresponding onOpenWeeklySummary/onOpenReportsAnalytics/onOpenUserManagement props were removed from AdminDashboardProps — navigation for these now lives entirely in AdminSidebar/AdminShell', () => {
    assert.equal(dashboardSrc.includes('onOpenWeeklySummary'), false)
    assert.equal(dashboardSrc.includes('onOpenReportsAnalytics'), false)
    assert.equal(dashboardSrc.includes('onOpenUserManagement'), false)
  })

  test('App.tsx no longer passes those three removed props to <AdminDashboard> — but still passes the props it still needs', () => {
    const usageMatch = appSrc.match(/<AdminDashboard\s*\n([\s\S]*?)\/>/)
    assert.ok(usageMatch)
    assert.equal(usageMatch[1].includes('onOpenWeeklySummary'), false)
    assert.equal(usageMatch[1].includes('onOpenReportsAnalytics'), false)
    assert.equal(usageMatch[1].includes('onOpenUserManagement'), false)
    assert.match(usageMatch[1], /week=\{adminWeek\}/)
    assert.match(usageMatch[1], /onSelectManager=\{setSelectedManager\}/)
    assert.match(usageMatch[1], /onOpenMyReport=\{isSubmitter \? \(\) => setMyReportOpen\(true\) : undefined\}/)
  })

  test('the sidebar itself (AdminSidebar.tsx, from Step 1) is untouched and still offers exactly these four destinations — removing the Dashboard buttons does not remove the actual navigation capability', () => {
    const sidebarSrc = readFileSync(path.join(dir, '..', 'components', 'AdminSidebar.tsx'), 'utf8')
    assert.match(sidebarSrc, /key: 'user-management', label: 'User Management'/)
    assert.match(sidebarSrc, /key: 'reports-analytics', label: 'Reports & Analytics'/)
    assert.match(sidebarSrc, /key: 'weekly-summary', label: 'Weekly Summary'/)
  })

  test('My Weekly Report button is preserved exactly — still optional, still gated by onOpenMyReport, still not one of the sidebar destinations', () => {
    assert.match(dashboardSrc, /onOpenMyReport\?: \(\) => void/)
    assert.match(dashboardSrc, /\{onOpenMyReport && \(/)
    assert.match(dashboardSrc, /className="btn btn-secondary my-report-btn" onClick=\{onOpenMyReport\}/)
    assert.match(dashboardSrc, />\s*My Weekly Report\s*</)
  })
})

describe('AdminDashboard.tsx uses its own dedicated root class — .admin-dashboard (Reports & Analytics\' dependency) is never modified in place', () => {
  test('the redesigned page root is .admin-dashboard-page, not .admin-dashboard', () => {
    assert.match(dashboardSrc, /<div className="admin-dashboard-page">/)
    assert.equal(/<div className="admin-dashboard">/.test(dashboardSrc), false)
  })

  test('.admin-dashboard\'s own rule in AdminDashboard.css is untouched — same max-width/margin/padding Reports & Analytics still inherits', () => {
    assert.match(
      dashboardCss,
      /^\.admin-dashboard \{\s*\n\s*max-width: 760px;\s*\n\s*margin: 0 auto;\s*\n\s*padding: 40px 24px 80px;\s*\n\}/m,
    )
  })

  test('.week-nav-btn / .week-selector-label / .week-current-badge / .admin-loading,.admin-empty-state rules are all still present, byte-identical in declarations, in AdminDashboard.css — Reports & Analytics (and Weekly Summary/ManagerReportsTable for the loading/empty ones) still depend on them', () => {
    assert.match(dashboardCss, /^\.week-nav-btn \{\s*\n\s*display: inline-flex;\s*\n\s*align-items: center;\s*\n\s*justify-content: center;\s*\n\s*width: 28px;\s*\n\s*height: 28px;/m)
    assert.match(dashboardCss, /^\.week-selector-label \{\s*\n\s*display: inline-flex;\s*\n\s*align-items: center;\s*\n\s*gap: 8px;\s*\n\s*font-size: 14px;\s*\n\s*color: var\(--muted-gray\);\s*\n\s*white-space: nowrap;\s*\n\}/m)
    assert.match(dashboardCss, /^\.week-current-badge \{/m)
    assert.match(
      dashboardCss,
      /^\.admin-loading,\s*\n\.admin-empty-state \{\s*\n\s*text-align: center;\s*\n\s*color: var\(--muted-gray\);\s*\n\s*font-size: 14px;\s*\n\s*padding: 40px 0;\s*\n\}/m,
    )
  })

  test('Reports & Analytics itself is untouched — still composes admin-dashboard + reports-analytics-page, still uses .week-nav-btn/.week-selector-label/.admin-loading/.admin-empty-state', () => {
    assert.match(reportsAnalyticsSrc, /className="admin-dashboard reports-analytics-page"/)
    assert.match(reportsAnalyticsSrc, /className="week-nav-btn no-print"/)
    assert.match(reportsAnalyticsSrc, /className="week-selector-label"/)
  })

  test('the new adp-* classes never redefine the protected shared selectors', () => {
    assert.equal(/^\.admin-dashboard-page \{[\s\S]{0,20}\.admin-dashboard\s/m.test(dashboardCss), false)
    // The new KPI/table/top-row rules are all distinctly adp-prefixed.
    assert.match(dashboardCss, /^\.adp-top-row \{/m)
    assert.match(dashboardCss, /^\.adp-kpi-row \{/m)
    assert.match(dashboardCss, /^\.adp-table \{/m)
  })
})

describe('AdminDashboard.tsx — data loading is unchanged', () => {
  test('fetchManagersForWeek is still the only data source, called once per week change, via the same useEffect dependency', () => {
    assert.match(dashboardSrc, /import \{ fetchManagersForWeek, type ManagerSummary \} from '\.\.\/lib\/adminService'/)
    assert.match(dashboardSrc, /fetchManagersForWeek\(supabase, week\.weekStartDate\)/)
    assert.match(dashboardSrc, /\}, \[week\.weekStartDate\]\)/)
  })
})

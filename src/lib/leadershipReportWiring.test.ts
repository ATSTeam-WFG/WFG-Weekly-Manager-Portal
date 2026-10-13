// Run with: node --test src/lib/leadershipReportWiring.test.ts
//
// Leadership Report — sidebar/App.tsx navigation wiring, AdminShell
// pass-through, and the thin top-level shell (LeadershipReport.tsx: title +
// Current/History switch). Component-specific behavior lives in its own
// file per component (see leadershipReportGateWiring.test.ts,
// leadershipReportCurrentWiring.test.ts, leadershipReportHistoryWiring.
// test.ts, leadershipReportDraftPersistenceWiring.test.ts).
//
// These components have no rendering harness in this project — the
// established pattern (see weeklySummaryAtsFormatWiring.test.ts,
// atsReportPrintLayoutWiring.test.ts) is to verify wiring via source
// inspection instead.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const dir = path.dirname(fileURLToPath(import.meta.url))
const appSrc = readFileSync(path.join(dir, '..', 'App.tsx'), 'utf8')
const sidebarSrc = readFileSync(path.join(dir, '..', 'components', 'AdminSidebar.tsx'), 'utf8')
const sidebarCss = readFileSync(path.join(dir, '..', 'components', 'AdminSidebar.css'), 'utf8')
const shellSrc = readFileSync(path.join(dir, '..', 'components', 'AdminShell.tsx'), 'utf8')
const lrSrc = readFileSync(path.join(dir, '..', 'components', 'LeadershipReport.tsx'), 'utf8')
const curSrc = readFileSync(path.join(dir, '..', 'components', 'LeadershipReportCurrent.tsx'), 'utf8')
const histSrc = readFileSync(path.join(dir, '..', 'components', 'LeadershipReportHistory.tsx'), 'utf8')
const weeklySummarySrc = readFileSync(path.join(dir, '..', 'components', 'WeeklySummary.tsx'), 'utf8')
const reportsAnalyticsSrc = readFileSync(path.join(dir, '..', 'components', 'ReportsAnalytics.tsx'), 'utf8')
const userManagementSrc = readFileSync(path.join(dir, '..', 'components', 'UserManagement.tsx'), 'utf8')
const printCss = readFileSync(path.join(dir, '..', 'print.css'), 'utf8')

describe('AdminSidebar — exact approved order/grouping with real dividers', () => {
  test('AdminDestination includes leadership-report as one of the destinations (the Video Creation phase later added a 6th, video-creation — see its own coverage in videoCreationWiring.test.ts)', () => {
    assert.match(sidebarSrc, /\| 'leadership-report'/)
  })

  test('groups render in the exact approved order: [Admin Dashboard], [Weekly Summary, Leadership Report, Video Creation], [User Management, Reports & Analytics]', () => {
    const groupsMatch = sidebarSrc.match(/const groups: [\s\S]*?\] = \[([\s\S]*?)\]\s*\n\n\s*return/)
    assert.ok(groupsMatch, 'could not locate the groups array')
    const groupsBody = groupsMatch[1]
    const order = [...groupsBody.matchAll(/key: '([a-z-]+)'/g)].map((m) => m[1])
    assert.deepEqual(order, ['dashboard', 'weekly-summary', 'leadership-report', 'video-creation', 'user-management', 'reports-analytics'])
  })

  test('a real divider (not a spacer/margin hack) renders between each group, never before the first', () => {
    assert.match(sidebarSrc, /\{groupIndex > 0 && <div className="admin-sidebar-divider" role="separator" \/>\}/)
    assert.match(sidebarCss, /\.admin-sidebar-divider \{\s*\n\s*height: 1px;/)
  })

  test('Leadership Report has its own distinct icon — not a duplicate of DocumentIcon (Weekly Summary already uses that one)', () => {
    assert.match(sidebarSrc, /function LeadershipReportIcon\(\)/)
    assert.match(sidebarSrc, /icon: <LeadershipReportIcon \/>/)
  })

  test('the sidebar remains presentational only — no new navigation-state model, still calling whichever handler App.tsx supplies', () => {
    assert.match(sidebarSrc, /onNavigateLeadershipReport: \(\) => void/)
    assert.equal(/useState/.test(sidebarSrc), false, 'AdminSidebar must not introduce its own navigation state')
  })
})

describe('App.tsx — Leadership Report navigation, independent of every other destination', () => {
  test('leadershipReportOpen and an independent leadershipReportWeekOffset are new, separate state — never reusing adminWeekOffset', () => {
    assert.match(appSrc, /const \[leadershipReportOpen, setLeadershipReportOpen\] = useState\(false\)/)
    assert.match(appSrc, /const \[leadershipReportWeekOffset, setLeadershipReportWeekOffset\] = useState\(0\)/)
    assert.match(appSrc, /const leadershipReportWeek = getReportingWeekByOffset\(leadershipReportWeekOffset\)/)
  })

  test('currentAdminDestination resolves leadership-report from leadershipReportOpen, still mutually exclusive with every other destination', () => {
    assert.match(appSrc, /leadershipReportOpen\s*\n\s*\? 'leadership-report'/)
  })

  test('every navigation handler resets leadershipReportOpen to false — mutual exclusivity is preserved for all 5 destinations, not just the original 4', () => {
    const handlerNames = ['handleNavigateToDashboard', 'handleNavigateToUserManagement', 'handleNavigateToReportsAnalytics', 'handleNavigateToWeeklySummary']
    for (const name of handlerNames) {
      const match = appSrc.match(new RegExp(`const ${name} = \\(\\) => \\{([\\s\\S]*?)\\n  \\}`))
      assert.ok(match, `could not locate ${name}`)
      assert.match(match[1], /setLeadershipReportOpen\(false\)/, `${name} must reset leadershipReportOpen`)
    }
  })

  test('handleNavigateToLeadershipReport resets every other destination flag and sets only its own to true', () => {
    const match = appSrc.match(/const handleNavigateToLeadershipReport = \(\) => \{([\s\S]*?)\n  \}/)
    assert.ok(match, 'could not locate handleNavigateToLeadershipReport')
    assert.match(match[1], /setWeeklySummaryOpen\(false\)/)
    assert.match(match[1], /setReportsAnalyticsOpen\(false\)/)
    assert.match(match[1], /setUserManagementOpen\(false\)/)
    assert.match(match[1], /setLeadershipReportOpen\(true\)/)
  })

  test('future-week navigation is disabled the same way Admin Dashboard already does it — Math.min(0, offset + 1)', () => {
    assert.match(appSrc, /onNextWeek=\{\(\) => setLeadershipReportWeekOffset\(\(offset\) => Math\.min\(0, offset \+ 1\)\)\}/)
    assert.match(appSrc, /onPreviousWeek=\{\(\) => setLeadershipReportWeekOffset\(\(offset\) => offset - 1\)\}/)
  })

  test('isCurrentWeek is derived (leadershipReportWeekOffset === 0), never a separate state variable', () => {
    assert.match(appSrc, /isCurrentWeek=\{leadershipReportWeekOffset === 0\}/)
  })

  test('<LeadershipReportGate> is rendered inside the same AdminShell branch as every other destination, with no onBack prop', () => {
    // The gate owns its own lock/unlock state and renders the real
    // <LeadershipReport> itself once unlocked — see
    // leadershipReportGateWiring.test.ts for that component's own wiring.
    const branchIndex = appSrc.indexOf('leadershipReportOpen ? (')
    const gateIndex = appSrc.indexOf('<LeadershipReportGate', branchIndex)
    const nextBranchIndex = appSrc.indexOf(') : ', branchIndex)
    assert.ok(branchIndex !== -1 && gateIndex !== -1 && gateIndex < nextBranchIndex)
    const usageMatch = appSrc.match(/<LeadershipReportGate\s*\n([\s\S]*?)\/>/)
    assert.ok(usageMatch)
    assert.match(usageMatch[1], /week=\{leadershipReportWeek\}/)
    assert.equal(usageMatch[1].includes('onBack'), false)
  })

  test('AdminShell receives onNavigateLeadershipReport, alongside the four original handlers, unchanged', () => {
    assert.match(appSrc, /<AdminShell\s*\n([\s\S]*?)>/)
    const shellUsage = appSrc.match(/<AdminShell\s*\n([\s\S]*?)>/)
    assert.ok(shellUsage)
    assert.match(shellUsage[1], /onNavigateDashboard=\{handleNavigateToDashboard\}/)
    assert.match(shellUsage[1], /onNavigateUserManagement=\{handleNavigateToUserManagement\}/)
    assert.match(shellUsage[1], /onNavigateReportsAnalytics=\{handleNavigateToReportsAnalytics\}/)
    assert.match(shellUsage[1], /onNavigateWeeklySummary=\{handleNavigateToWeeklySummary\}/)
    assert.match(shellUsage[1], /onNavigateLeadershipReport=\{handleNavigateToLeadershipReport\}/)
  })
})

describe('AdminShell — pure pass-through, no new state or logic of its own', () => {
  test('forwards onNavigateLeadershipReport to AdminSidebar, wrapped in the same handleNavigate (closes mobile nav) as every other destination', () => {
    assert.match(shellSrc, /onNavigateLeadershipReport: \(\) => void/)
    assert.match(shellSrc, /onNavigateLeadershipReport=\{\(\) => handleNavigate\(onNavigateLeadershipReport\)\}/)
  })

  test('AdminShell still owns no navigation state of its own — only isMobileNavOpen (UI-only)', () => {
    const useStateCalls = [...shellSrc.matchAll(/useState\(/g)]
    assert.equal(useStateCalls.length, 1, 'AdminShell should have exactly one useState (isMobileNavOpen)')
  })
})

describe('LeadershipReport.tsx has no "Back to Admin Dashboard" link — the one intentional exception, since the persistent sidebar already provides navigation', () => {
  test('no back-link button exists in LeadershipReport.tsx or its sub-components (the phrase may only appear in an explanatory comment about its removal, never in rendered JSX)', () => {
    for (const src of [lrSrc, curSrc, histSrc]) {
      assert.equal(src.includes('className="link-btn back-link"'), false)
      assert.equal(/>\s*&larr;\s*Back to Admin Dashboard\s*</.test(src), false)
    }
  })

  test('every other admin destination keeps its own back-link, unchanged — Weekly Summary, Reports & Analytics, User Management', () => {
    assert.match(weeklySummarySrc, /<button type="button" className="link-btn back-link no-print" onClick=\{onBack\}>/)
    assert.match(reportsAnalyticsSrc, /<button type="button" className="link-btn back-link no-print" onClick=\{onBack\}>/)
    assert.match(userManagementSrc, /<button type="button" className="link-btn back-link" onClick=\{onBack\}>/)
  })
})

describe('LeadershipReport.tsx — thin shell: title + Current/History switch only', () => {
  test('the page title and subtitle match exactly what was approved', () => {
    assert.match(lrSrc, /<h1>Leadership Report<\/h1>/)
    assert.match(lrSrc, /<p className="lr-header-subtitle">Review the Present Week Summary source and prepare the final leadership report\.<\/p>/)
  })

  test('view defaults to Current, and the switch offers exactly Current/History', () => {
    assert.match(lrSrc, /const \[view, setView\] = useState<TopView>\('current'\)/)
    assert.match(lrSrc, />\s*Current\s*</)
    assert.match(lrSrc, />\s*History\s*</)
  })

  test('this file holds no Leadership Report data/fetch logic of its own — it delegates entirely to LeadershipReportCurrent/LeadershipReportHistory', () => {
    assert.equal(/from ['"]\.\.\/lib\/leadershipReportDraftService['"]/.test(lrSrc), false)
    assert.match(lrSrc, /import LeadershipReportCurrent from '\.\/LeadershipReportCurrent'/)
    assert.match(lrSrc, /import LeadershipReportHistory from '\.\/LeadershipReportHistory'/)
  })

  test('switching to History is gated when the Current tab reports unsaved edits — a clean switch happens immediately, a dirty one is deferred until confirmed', () => {
    assert.match(lrSrc, /const \[currentIsDirty, setCurrentIsDirty\] = useState\(false\)/)
    assert.match(lrSrc, /const \[historySwitchPending, setHistorySwitchPending\] = useState\(false\)/)
    assert.match(lrSrc, /const handleSwitchToHistory = \(\) => \{\s*\n\s*if \(!currentIsDirty\) \{\s*\n\s*switchToHistory\(\)\s*\n\s*return\s*\n\s*\}\s*\n\s*setHistorySwitchPending\(true\)\s*\n\s*\}/)
    assert.match(lrSrc, /onClick=\{handleSwitchToHistory\}/)
  })

  test('window.confirm() is NOT used for this guard — confirmed unreliable in the actual preview environment (silently resolves to false with no visible UI), so a custom ConfirmDialog is used instead', () => {
    // The bare substring appears in this file's own explanatory comments
    // (documenting why it's NOT used) — stripped here (// line comments,
    // the only comment style used in this file) so those can't produce a
    // false positive.
    const codeOnly = lrSrc
      .split('\n')
      .map((line) => line.replace(/\/\/.*$/, ''))
      .join('\n')
    assert.equal(/window\.confirm/.test(codeOnly), false)
    assert.match(lrSrc, /import ConfirmDialog from '\.\/ConfirmDialog'/)
  })

  test('BRANCH 1 (confirm/Continue): the rendered dialog\'s onConfirm handler actually calls switchToHistory() — this is the "confirm returns true -> navigation proceeds" path', () => {
    const dialogStart = lrSrc.indexOf('{historySwitchPending && (')
    const dialogEnd = lrSrc.indexOf('<div className="lr-header">', dialogStart)
    assert.ok(dialogStart !== -1 && dialogEnd !== -1 && dialogStart < dialogEnd, 'could not locate the rendered <ConfirmDialog> block for historySwitchPending')
    const dialogJsx = lrSrc.slice(dialogStart, dialogEnd)
    assert.match(dialogJsx, /onConfirm=\{\(\) => \{\s*\n\s*setHistorySwitchPending\(false\)\s*\n\s*switchToHistory\(\)\s*\n\s*\}\}/)
  })

  test('BRANCH 2 (cancel): the rendered dialog\'s onCancel handler only clears the pending flag — it never calls switchToHistory, so the view genuinely stays on Current', () => {
    const dialogStart = lrSrc.indexOf('{historySwitchPending && (')
    const dialogEnd = lrSrc.indexOf('<div className="lr-header">', dialogStart)
    const dialogJsx = lrSrc.slice(dialogStart, dialogEnd)
    const onCancelMatch = dialogJsx.match(/onCancel=\{([^}]*)\}/)
    assert.ok(onCancelMatch)
    assert.equal(onCancelMatch[1].trim(), '() => setHistorySwitchPending(false)')
    assert.equal(/switchToHistory|setView/.test(onCancelMatch[1]), false, 'onCancel must never switch the view')
  })

  test('returning to Current is never gated — History has no unsaved state of its own to lose', () => {
    const currentTabMatch = lrSrc.match(/role="tab"\s*\n\s*aria-selected=\{view === 'current'\}[\s\S]*?onClick=\{([^}]*)\}/)
    assert.ok(currentTabMatch)
    assert.equal(currentTabMatch[1].trim(), "() => setView('current')")
  })

  test('Current is passed a dirty-change handler that both tracks it locally (for the History-switch guard) and relays it further up to App.tsx', () => {
    assert.match(lrSrc, /onDirtyChange=\{handleCurrentDirtyChange\}/)
    assert.match(lrSrc, /const handleCurrentDirtyChange = \(isDirty: boolean\) => \{\s*\n\s*setCurrentIsDirty\(isDirty\)\s*\n\s*onDirtyChange\(isDirty\)\s*\n\s*\}/)
  })

  test('switching to History explicitly reports not-dirty upward — History has no unsaved state of its own', () => {
    const switchFnMatch = lrSrc.match(/const switchToHistory = \(\) => \{([\s\S]*?)\n  \}/)
    assert.ok(switchFnMatch)
    assert.match(switchFnMatch[1], /onDirtyChange\(false\)/)
  })
})

describe('Frozen features remain byte-for-byte unaffected', () => {
  test('WeeklySummary.tsx is not imported by, and does not import, anything from Leadership Report', () => {
    assert.equal(/from ['"]\.\/LeadershipReport['"]/.test(weeklySummarySrc), false)
    for (const src of [lrSrc, curSrc, histSrc]) {
      assert.equal(/from ['"]\.\/WeeklySummary['"]/.test(src), false)
    }
  })

  test('print.css: the pre-existing Executive-Analysis-only isolation rule is untouched by the later Leadership Report Print/Download phase (see leadershipReportPrintWiring.test.ts for that phase\'s own coverage)', () => {
    assert.match(
      printCss,
      /body\.print-executive-analysis-only \.reports-analytics-page > \*:not\(\.print-header\):not\(\.executive-summary-section\),\s*\n\s*body\.print-executive-analysis-only \.weekly-summary > \*:not\(\.print-header\):not\(\.executive-summary-section\)/,
    )
  })
})

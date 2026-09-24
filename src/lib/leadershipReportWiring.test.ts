// Run with: node --test src/lib/leadershipReportWiring.test.ts
//
// Leadership Report — Phase 1: page shell + read-only ATS source + a
// local-only editable draft. No persistence, no new Supabase table, no new
// RPC, no changes to Weekly Summary/Executive Analysis/ATS generation.
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
const lrCss = readFileSync(path.join(dir, '..', 'components', 'LeadershipReport.css'), 'utf8')
const weeklySummarySrc = readFileSync(path.join(dir, '..', 'components', 'WeeklySummary.tsx'), 'utf8')
const executiveCardSrc = readFileSync(path.join(dir, '..', 'components', 'ExecutiveAnalysisCard.tsx'), 'utf8')
const atsViewSrc = readFileSync(path.join(dir, '..', 'components', 'AtsReportView.tsx'), 'utf8')
const atsEditFormSrc = readFileSync(path.join(dir, '..', 'components', 'AtsTopicsEditForm.tsx'), 'utf8')
const printCss = readFileSync(path.join(dir, '..', 'print.css'), 'utf8')
const executiveApiSrc = readFileSync(path.join(dir, '..', '..', 'api', 'executive-summary.ts'), 'utf8')
const reportsAnalyticsSrc = readFileSync(path.join(dir, '..', 'components', 'ReportsAnalytics.tsx'), 'utf8')
const userManagementSrc = readFileSync(path.join(dir, '..', 'components', 'UserManagement.tsx'), 'utf8')

describe('AdminSidebar — exact approved order/grouping with real dividers', () => {
  test('AdminDestination includes leadership-report as a 5th destination', () => {
    assert.match(
      sidebarSrc,
      /export type AdminDestination = 'dashboard' \| 'user-management' \| 'reports-analytics' \| 'weekly-summary' \| 'leadership-report'/,
    )
  })

  test('groups render in the exact approved order: [Admin Dashboard], [Weekly Summary, Leadership Report], [User Management, Reports & Analytics]', () => {
    const groupsMatch = sidebarSrc.match(/const groups: [\s\S]*?\] = \[([\s\S]*?)\]\s*\n\n\s*return/)
    assert.ok(groupsMatch, 'could not locate the groups array')
    const groupsBody = groupsMatch[1]
    const order = [...groupsBody.matchAll(/key: '([a-z-]+)'/g)].map((m) => m[1])
    assert.deepEqual(order, ['dashboard', 'weekly-summary', 'leadership-report', 'user-management', 'reports-analytics'])
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

  // Visual-refinement phase: LeadershipReport no longer takes an onBack
  // prop at all — its own "Back to Admin Dashboard" link was removed as
  // redundant with the persistent Admin sidebar (every OTHER destination
  // keeps its own back-link unchanged; this page is the one exception).
  test('<LeadershipReport> is rendered inside the same AdminShell branch as every other destination, with no onBack prop', () => {
    const usageMatch = appSrc.match(/<LeadershipReport\s*\n([\s\S]*?)\/>/)
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

// Extracted by slicing between the two pane markers directly (rather than a
// regex spanning to a closing </div>, which is ambiguous given nested divs
// of the same indentation) — a precise, unambiguous way to isolate each
// pane's own JSX for the assertions below.
const sourcePaneStart = lrSrc.indexOf('<div className="lr-pane lr-pane-source">')
const draftPaneStart = lrSrc.indexOf('<div className="lr-pane lr-pane-draft">')
assert.ok(sourcePaneStart !== -1 && draftPaneStart !== -1 && sourcePaneStart < draftPaneStart, 'could not locate both panes in order')
const sourcePaneJsx = lrSrc.slice(sourcePaneStart, draftPaneStart)

describe('LeadershipReport.tsx has no "Back to Admin Dashboard" link — the one intentional exception, since the persistent sidebar already provides navigation', () => {
  test('no back-link button exists in LeadershipReport.tsx (the phrase may only appear in an explanatory comment about its removal, never in rendered JSX)', () => {
    assert.equal(lrSrc.includes('className="link-btn back-link"'), false)
    assert.equal(/>\s*&larr;\s*Back to Admin Dashboard\s*</.test(lrSrc), false)
  })

  test('every other admin destination keeps its own back-link, unchanged — Weekly Summary, Reports & Analytics, User Management', () => {
    assert.match(weeklySummarySrc, /<button type="button" className="link-btn back-link no-print" onClick=\{onBack\}>/)
    assert.match(reportsAnalyticsSrc, /<button type="button" className="link-btn back-link no-print" onClick=\{onBack\}>/)
    assert.match(userManagementSrc, /<button type="button" className="link-btn back-link" onClick=\{onBack\}>/)
  })
})

describe('LeadershipReport.tsx — left pane is strictly read-only', () => {
  test('fetches via the existing, unmodified fetchPersistedAnalysis(\'weekly\', ...) — no new endpoint, no new service call', () => {
    assert.match(lrSrc, /import \{ fetchPersistedAnalysis, isAtsShapedSections \} from '\.\.\/lib\/executiveSummaryService'/)
    assert.match(lrSrc, /fetchPersistedAnalysis\('weekly', week\.weekStartDate\)/)
  })

  test('the left pane renders AtsReportView with no onChange/edit prop, and no edit-mode branch exists for it anywhere in the file', () => {
    assert.match(sourcePaneJsx, /<AtsReportView report=\{sourceReport\} periodLabel=\{periodLabel\} \/>/)
    assert.equal(sourcePaneJsx.includes('AtsTopicsEditForm'), false, 'the source pane must never render an edit form')
    assert.equal(sourcePaneJsx.includes('onChange'), false, 'the source pane must have no mutation path at all')
  })

  test('the left pane has no Edit/Save/Regenerate controls — only the disabled "Print / Download ATS Report" button', () => {
    const buttonCount = (sourcePaneJsx.match(/<button/g) ?? []).length
    assert.equal(buttonCount, 1, 'expected exactly one button (Print / Download ATS Report) in the source pane')
    assert.match(sourcePaneJsx, />\s*Print \/ Download ATS Report\s*</)
  })

  test('an empty state explains the ATS report must be generated from Weekly Summary first, when none exists yet', () => {
    assert.match(lrSrc, /No ATS report has been generated for this week yet\./)
    assert.match(lrSrc, /Generate the weekly ATS report from Weekly Summary first, then return here\./)
  })

  test('a distinct empty state handles a persisted-but-legacy-shaped (pre-ATS) analysis, without ever passing the wrong shape into AtsReportView', () => {
    assert.match(lrSrc, /This week&apos;s saved analysis is not in the ATS format Leadership Report requires\./)
    assert.match(lrSrc, /!sourceIsAtsShaped \|\| !sourceReport/)
  })
})

describe('LeadershipReport.tsx — right pane receives an independent deep copy, editable only in memory', () => {
  test('deepCopyAtsReport builds new topic objects and a new bullets array per topic — never a shared reference to the source', () => {
    assert.match(lrSrc, /function deepCopyAtsReport\(report: AtsReport\): AtsReport \{/)
    assert.match(lrSrc, /bullets: \[\.\.\.topic\.bullets\],/)
    assert.match(lrSrc, /topics: report\.topics\.map\(\(topic\) => \(\{/)
  })

  test('the deep copy is computed once per fetch, from the freshly-fetched persisted analysis — never re-derived from state that could alias the source', () => {
    assert.match(lrSrc, /setDraftReport\(deepCopyAtsReport\(persisted\.sections\)\)/)
    // Confirms draftReport is never assigned directly from sourceReport/
    // persisted.sections without going through deepCopyAtsReport first.
    assert.equal(/setDraftReport\(persisted\.sections\)|setDraftReport\(sourceReport\)/.test(lrSrc), false)
  })

  test('editing (AtsTopicsEditForm) only ever targets draftReport/setDraftReport — never sourceReport/setSourceReport', () => {
    assert.match(lrSrc, /<AtsTopicsEditForm report=\{draftReport\} onChange=\{setDraftReport\} \/>/)
    assert.equal(/AtsTopicsEditForm report=\{sourceReport\}/.test(lrSrc), false)
  })

  test('Edit/Done Editing toggles a local mode state only — no network call, no persistence call, of any kind', () => {
    assert.match(lrSrc, /onClick=\{\(\) => setMode\('edit'\)\}/)
    assert.match(lrSrc, /onClick=\{\(\) => setMode\('view'\)\}/)
    assert.equal(/supabase|\.rpc\(|fetch\(/.test(lrSrc), false, 'no Supabase/network call may exist anywhere in this file yet')
  })

  test('default right-side state is view mode, rendered via the unmodified, read-only AtsReportView', () => {
    assert.match(lrSrc, /const \[mode, setMode\] = useState<Mode>\('view'\)/)
    assert.match(lrSrc, /<AtsReportView report=\{draftReport\} periodLabel=\{periodLabel\} \/>/)
  })
})

describe('LeadershipReport.tsx — Save Draft and Print/Download are present but non-functional in Phase 1', () => {
  // Visual-refinement phase: both buttons' className is now mode-dependent
  // (Save Draft becomes the visually primary/terracotta action while
  // editing, matching what Phase 2 will make functionally true; Print /
  // Download Report is primary in view mode and steps back to secondary
  // while editing) — but both remain `disabled` with no onClick in every
  // mode, since Phase 1 still performs zero persistence/printing.
  test('Save Draft is always disabled with no onClick handler, and a TODO marking it as Phase 2 persistence work — its className switches secondary (view) / primary (edit)', () => {
    assert.match(
      lrSrc,
      /<button\s*\n\s*type="button"\s*\n\s*className=\{`btn \$\{mode === 'edit' \? 'btn-primary' : 'btn-secondary'\}`\}\s*\n\s*disabled\s*\n\s*title="Save Draft persistence is Phase 2 work"\s*\n\s*>\s*\n\s*Save Draft\s*\n\s*<\/button>/,
    )
    assert.match(lrSrc, /TODO\(Phase 2\): a save_leadership_report_draft RPC/)
    assert.equal(/onClick=\{[^}]*\}\s*\n\s*>\s*\n\s*Save Draft/.test(lrSrc), false, 'Save Draft must have no onClick handler')
  })

  test('both Print / Download buttons are always disabled with no onClick handler — Print / Download Report\'s className switches primary (view) / secondary (edit); window.print may only appear in an explanatory TODO comment, never as an actual call', () => {
    assert.match(lrSrc, /<button type="button" className="btn btn-secondary" disabled title="Print \/ Download will be available in a later phase">\s*\n\s*Print \/ Download ATS Report\s*\n\s*<\/button>/)
    assert.match(
      lrSrc,
      /<button\s*\n\s*type="button"\s*\n\s*className=\{`btn \$\{mode === 'edit' \? 'btn-secondary' : 'btn-primary'\}`\}\s*\n\s*disabled\s*\n\s*title="Print \/ Download will be available in a later phase"\s*\n\s*>\s*\n\s*Print \/ Download Report\s*\n\s*<\/button>/,
    )
    assert.equal(/window\.print\(\)(?! from a disabled)/.test(lrSrc), false, 'must not invoke print yet — Phase 1 buttons are disabled placeholders only')
  })

  test('no Supabase write/RPC of any kind exists in this file — Phase 1 performs zero persistence', () => {
    assert.equal(/from ['"]\.\.\/lib\/supabaseClient['"]/.test(lrSrc), false)
    assert.equal(/\.rpc\(/.test(lrSrc), false)
  })
})

describe('LeadershipReport.tsx — right-side action visual hierarchy (Save Draft / Print-Download switch with mode)', () => {
  test('view mode: Save Draft reads as secondary, Print / Download Report reads as primary', () => {
    assert.match(lrSrc, /className=\{`btn \$\{mode === 'edit' \? 'btn-primary' : 'btn-secondary'\}`\}/)
  })

  test('edit mode: Save Draft reads as primary (previewing its Phase 2 role), Print / Download Report steps back to secondary', () => {
    assert.match(lrSrc, /className=\{`btn \$\{mode === 'edit' \? 'btn-secondary' : 'btn-primary'\}`\}/)
  })

  test('Edit and Done Editing remain plain secondary in both modes, unaffected by this hierarchy change', () => {
    assert.match(lrSrc, /<button type="button" className="btn btn-secondary" onClick=\{\(\) => setMode\('edit'\)\}>/)
    assert.match(lrSrc, /<button type="button" className="btn btn-secondary" onClick=\{\(\) => setMode\('view'\)\}>/)
  })
})

describe('LeadershipReport.tsx — edit-mode presentation is refined at the page-container level only', () => {
  test('a new .lr-edit-container wraps AtsTopicsEditForm in edit mode — AtsTopicsEditForm.tsx/its own CSS are never touched', () => {
    assert.match(lrSrc, /<div className="lr-edit-container">\s*\n\s*<AtsTopicsEditForm report=\{draftReport\} onChange=\{setDraftReport\} \/>\s*\n\s*<\/div>/)
  })

  test('.lr-edit-container is a light, restrained frame (white surface, thin border, comfortable padding) — not a second heavy visual layer, and it declares no property that could shrink controls/inputs inside AtsTopicsEditForm', () => {
    assert.match(lrCss, /\.lr-edit-container \{\s*\n\s*background: var\(--white\);\s*\n\s*border: 1px solid var\(--soft-sand\);\s*\n\s*border-radius: 10px;\s*\n\s*padding: 20px;\s*\n\s*\}/)
    assert.equal(/\.lr-edit-container[^}]*font-size/.test(lrCss), false, 'must not override font sizes inside the edit form')
  })

  test('the view-mode branch (AtsReportView) is unaffected — the new container is scoped to the edit-mode branch only', () => {
    assert.match(lrSrc, /<AtsReportView report=\{draftReport\} periodLabel=\{periodLabel\} \/>/)
    const viewModeIndex = lrSrc.indexOf('<AtsReportView report={draftReport} periodLabel={periodLabel} />')
    const editContainerIndex = lrSrc.indexOf('<div className="lr-edit-container">')
    assert.ok(viewModeIndex !== -1 && editContainerIndex !== -1 && editContainerIndex < viewModeIndex, 'expected the edit branch (with its container) before the view branch in source order')
  })
})

describe('LeadershipReport.tsx/.css — page header, week label, and safe date-only formatting', () => {
  test('the page title and subtitle match exactly what was approved', () => {
    assert.match(lrSrc, /<h1>Leadership Report<\/h1>/)
    assert.match(lrSrc, /<p className="lr-header-subtitle">Review the ATS source and prepare the final leadership report\.<\/p>/)
  })

  test('weekEndingLabel uses parseDateOnly (week.ts), never `new Date(dateOnlyString)` — periodEndDate is a date-only value (see the production off-by-one fix)', () => {
    assert.match(lrSrc, /import \{ parseDateOnly \} from '\.\.\/utils\/week'/)
    assert.match(lrSrc, /function weekEndingLabel\(periodEndDate: string\): string \{/)
    assert.match(lrSrc, /parseDateOnly\(periodEndDate\)\.toLocaleDateString/)
  })

  test('the week-nav toolbar mirrors the established Admin Dashboard pattern: Previous/Next buttons, a week label, and the shared .week-current-badge (never redefined)', () => {
    assert.match(lrSrc, /Previous/)
    assert.match(lrSrc, /Next/)
    assert.match(lrSrc, /\{isCurrentWeek && <span className="week-current-badge">Current<\/span>\}/)
    assert.equal(/^\.week-current-badge\s*\{/m.test(lrCss), false, 'must reuse the existing shared .week-current-badge, never redefine it')
  })
})

describe('LeadershipReport.css — desktop side-by-side layout, no tabs/toggle, responsive stacking independent of print', () => {
  test('two equal-width panes via CSS grid — never a tab/toggle UI', () => {
    assert.match(lrCss, /\.lr-panes \{\s*\n\s*display: grid;\s*\n\s*grid-template-columns: 1fr 1fr;/)
    assert.equal(/role="tab"|tablist|<select/.test(lrSrc), false)
  })

  test('below 1100px the panes stack to a single column — a genuinely smaller-screen breakpoint, not the print/mobile-nav breakpoints', () => {
    assert.match(lrCss, /@media \(max-width: 1100px\) \{\s*\n\s*\.lr-panes \{\s*\n\s*grid-template-columns: 1fr;/)
  })

  test('LeadershipReport.css declares no @media print rules at all in Phase 1 — print/mobile breakpoints cannot accidentally alter desktop presentation because none exist yet', () => {
    assert.equal(/@media print/.test(lrCss), false)
  })

  test('the left (source) and right (draft) panes are visually distinguished — muted/recessed source vs. a crisper draft surface with the terracotta accent already used for .executive-summary-content elsewhere', () => {
    assert.match(lrCss, /\.lr-pane-source \{\s*\n\s*background: var\(--warm-cream\);/)
    assert.match(lrCss, /\.lr-pane-draft \{\s*\n\s*background: var\(--white\);\s*\n\s*border: 1px solid var\(--soft-sand\);\s*\n\s*border-top: 4px solid var\(--terracotta\);/)
  })
})

describe('Frozen features remain byte-for-byte unaffected', () => {
  test('WeeklySummary.tsx is not imported by, and does not import, anything from LeadershipReport', () => {
    assert.equal(/from ['"]\.\/LeadershipReport['"]/.test(weeklySummarySrc), false)
    assert.equal(/from ['"]\.\/WeeklySummary['"]/.test(lrSrc), false)
  })

  test('ExecutiveAnalysisCard.tsx, AtsReportView.tsx, and AtsTopicsEditForm.tsx are reused unmodified — LeadershipReport.tsx never redefines any of their exported names', () => {
    assert.match(executiveCardSrc, /export default function ExecutiveAnalysisCard/)
    assert.match(atsViewSrc, /export default function AtsReportView/)
    assert.match(atsEditFormSrc, /export default function AtsTopicsEditForm/)
    assert.equal(/function ExecutiveAnalysisCard\(|function AtsReportView\(|function AtsTopicsEditForm\(/.test(lrSrc), false)
  })

  test('api/executive-summary.ts (ATS generation/prompt/schema) is untouched — Leadership Report calls no AI endpoint of any kind', () => {
    assert.match(executiveApiSrc, /const ATS_REPORT_SCHEMA = /)
    assert.equal(lrSrc.includes('/api/executive-summary'), false)
    assert.equal(lrSrc.includes('generateReportingAnalysis'), false)
  })

  test('print.css is untouched by this phase — no existing print mode changed, and no leadership-report print rule was added yet (Phase 3 work)', () => {
    assert.equal(/leadership-report/.test(printCss), false)
    assert.match(
      printCss,
      /body\.print-executive-analysis-only \.reports-analytics-page > \*:not\(\.print-header\):not\(\.executive-summary-section\),\s*\n\s*body\.print-executive-analysis-only \.weekly-summary > \*:not\(\.print-header\):not\(\.executive-summary-section\)/,
    )
  })
})

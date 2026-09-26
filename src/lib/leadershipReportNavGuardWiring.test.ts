// Run with: node --test src/lib/leadershipReportNavGuardWiring.test.ts
//
// Leadership Report — closing the one remaining data-loss gap: a sidebar
// navigation AWAY from Leadership Report (to Admin Dashboard, Weekly
// Summary, User Management, or Reports & Analytics) while the Current tab
// has unsaved edits. Reuses the existing dirty-tracking in
// LeadershipReportCurrent.tsx, threaded up through LeadershipReport.tsx and
// LeadershipReportGate.tsx to App.tsx — no new dirty-detection logic, no
// router, no new dependency, no change to AdminSidebar/AdminShell, no
// change to the password gate or RLS/RPC. Verified via source inspection,
// the established pattern for components with no rendering harness here.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const dir = path.dirname(fileURLToPath(import.meta.url))
const appSrc = readFileSync(path.join(dir, '..', 'App.tsx'), 'utf8')
const gateSrc = readFileSync(path.join(dir, '..', 'components', 'LeadershipReportGate.tsx'), 'utf8')
const sidebarSrc = readFileSync(path.join(dir, '..', 'components', 'AdminSidebar.tsx'), 'utf8')
const shellSrc = readFileSync(path.join(dir, '..', 'components', 'AdminShell.tsx'), 'utf8')
const curSrc = readFileSync(path.join(dir, '..', 'components', 'LeadershipReportCurrent.tsx'), 'utf8')

describe('App.tsx — a sidebar navigation away from a dirty Leadership Report is confirmed first', () => {
  test('leadershipReportDirty is new, dedicated state — not a duplicate of leadershipReportOpen or any other existing flag', () => {
    assert.match(appSrc, /const \[leadershipReportDirty, setLeadershipReportDirty\] = useState\(false\)/)
  })

  test('window.confirm() is NOT used for this guard — confirmed unreliable in the actual preview environment (silently resolves to false with no visible UI), so a custom ConfirmDialog is used instead', () => {
    // The bare substring appears in App.tsx's own explanatory comments
    // (documenting why it's NOT used) — stripped here (// line comments)
    // so those can't produce a false positive.
    const codeOnly = appSrc
      .split('\n')
      .map((line) => line.replace(/\/\/.*$/, ''))
      .join('\n')
    assert.equal(/window\.confirm/.test(codeOnly), false)
    assert.match(appSrc, /import ConfirmDialog from '\.\/components\/ConfirmDialog'/)
  })

  test('the guard only ever defers while Leadership Report is the currently open destination — every other combination invokes the action immediately (a plain pass-through)', () => {
    assert.match(
      appSrc,
      /const requestLeaveLeadershipReportIfDirty = \(action: \(\) => void\) => \{\s*\n\s*if \(!leadershipReportOpen \|\| !leadershipReportDirty\) \{\s*\n\s*action\(\)\s*\n\s*return\s*\n\s*\}\s*\n\s*setPendingLeaveAction\(\(\) => action\)\s*\n\s*\}/,
    )
  })

  test('all four navigate-AWAY handlers route their entire body through the guard, as the action to perform', () => {
    for (const name of ['handleNavigateToDashboard', 'handleNavigateToUserManagement', 'handleNavigateToReportsAnalytics', 'handleNavigateToWeeklySummary']) {
      const match = appSrc.match(new RegExp(`const ${name} = \\(\\) => \\{\\s*\\n\\s*requestLeaveLeadershipReportIfDirty\\(\\(\\) => \\{`))
      assert.ok(match, `expected ${name} to route its body through requestLeaveLeadershipReportIfDirty`)
    }
  })

  test('handleNavigateToLeadershipReport (navigating INTO Leadership Report, or re-clicking it while already there) is never gated — only navigating AWAY is', () => {
    const match = appSrc.match(/const handleNavigateToLeadershipReport = \(\) => \{([\s\S]*?)\n  \}/)
    assert.ok(match)
    assert.equal(/requestLeaveLeadershipReportIfDirty/.test(match[1]), false)
  })

  test('BRANCH 1 (confirm/Continue): the rendered dialog\'s onConfirm handler actually invokes the pending navigation action — this is the "confirm returns true -> navigation proceeds" path', () => {
    const dialogStart = appSrc.indexOf('{pendingLeaveAction && (')
    const dialogEnd = appSrc.indexOf('<Header', dialogStart)
    assert.ok(dialogStart !== -1 && dialogEnd !== -1 && dialogStart < dialogEnd, 'could not locate the rendered <ConfirmDialog> block for pendingLeaveAction')
    const dialogJsx = appSrc.slice(dialogStart, dialogEnd)
    assert.match(dialogJsx, /onConfirm=\{\(\) => \{\s*\n\s*const action = pendingLeaveAction\s*\n\s*setPendingLeaveAction\(null\)\s*\n\s*action\(\)\s*\n\s*\}\}/)
  })

  test('BRANCH 2 (cancel): the rendered dialog\'s onCancel handler only clears the pending action — none of the four destination flags are ever touched, so the screen and edits are unaffected', () => {
    const dialogStart = appSrc.indexOf('{pendingLeaveAction && (')
    const dialogEnd = appSrc.indexOf('<Header', dialogStart)
    const dialogJsx = appSrc.slice(dialogStart, dialogEnd)
    const onCancelMatch = dialogJsx.match(/onCancel=\{([^}]*)\}/)
    assert.ok(onCancelMatch)
    assert.equal(onCancelMatch[1].trim(), '() => setPendingLeaveAction(null)')
    assert.equal(/setWeeklySummaryOpen|setReportsAnalyticsOpen|setUserManagementOpen|setLeadershipReportOpen/.test(onCancelMatch[1]), false, 'onCancel must never touch any destination flag')
  })

  test('AdminSidebar/AdminShell are not modified for this — the guard lives entirely inside App.tsx\'s own handler bodies, transparent to both', () => {
    assert.equal(/requestLeaveLeadershipReportIfDirty|leadershipReportDirty|pendingLeaveAction/.test(sidebarSrc), false)
    assert.equal(/requestLeaveLeadershipReportIfDirty|leadershipReportDirty|pendingLeaveAction/.test(shellSrc), false)
  })

  test('<LeadershipReportGate> receives onDirtyChange={setLeadershipReportDirty} — the one new prop threaded through', () => {
    const usageMatch = appSrc.match(/<LeadershipReportGate\s*\n([\s\S]*?)\/>/)
    assert.ok(usageMatch)
    assert.match(usageMatch[1], /onDirtyChange=\{setLeadershipReportDirty\}/)
  })
})

describe('LeadershipReportGate.tsx — relays dirty state without adding its own tracking, and resets it on unmount', () => {
  test('onDirtyChange is forwarded as-is to the unlocked <LeadershipReport>, with no gate-owned dirty state of its own', () => {
    assert.match(gateSrc, /onDirtyChange: \(isDirty: boolean\) => void/)
    assert.match(gateSrc, /<LeadershipReport\s*\n([\s\S]*?)onDirtyChange=\{onDirtyChange\}/)
    assert.equal(/useState.*[Dd]irty/.test(gateSrc), false, 'the gate itself should own no dirty state — only relay it')
  })

  test('unmounting the gate (navigating to a different destination entirely) resets the relayed dirty flag to false', () => {
    assert.match(gateSrc, /useEffect\(\(\) => \{\s*\n\s*return \(\) => onDirtyChange\(false\)\s*\n\s*\}, \[onDirtyChange\]\)/)
  })
})

describe('LeadershipReportCurrent.tsx — beforeunload protection, active only while dirty', () => {
  test('a beforeunload listener is added only while isDirty is true — the effect returns early (adds nothing) when clean', () => {
    const effectMatch = curSrc.match(/useEffect\(\(\) => \{\s*\n\s*if \(!isDirty\) return\s*\n([\s\S]*?)\n\s*\}, \[isDirty\]\)/)
    assert.ok(effectMatch, 'expected a useEffect keyed on [isDirty] that returns early when not dirty')
    assert.match(effectMatch[1], /window\.addEventListener\('beforeunload', handleBeforeUnload\)/)
  })

  test('the listener is removed in the effect\'s own cleanup — covers both isDirty flipping to false and this component unmounting', () => {
    assert.match(curSrc, /return \(\) => window\.removeEventListener\('beforeunload', handleBeforeUnload\)/)
  })

  test('no custom message is depended on — e.returnValue is set to an empty string, not a specific string the code branches on', () => {
    assert.match(curSrc, /e\.preventDefault\(\)\s*\n\s*e\.returnValue = ''/)
  })

  test('nothing is persisted by this protection — no localStorage/sessionStorage usage was added alongside it', () => {
    assert.equal(/(localStorage|sessionStorage)(\.[a-zA-Z]|\[)/.test(curSrc), false)
  })
})

describe('LeadershipReportCurrent.tsx — a successful Save Draft clears the navigation-guard dirty state too', () => {
  test('the save-success path updates baselineContent to match the saved content, which is the same comparison isDirty (and therefore the relayed onDirtyChange/beforeunload) is computed from — no separate reset needed', () => {
    const tryStart = curSrc.indexOf('try {', curSrc.indexOf('const handleSaveDraft'))
    const tryEnd = curSrc.indexOf('} catch', tryStart)
    const tryBody = curSrc.slice(tryStart, tryEnd)
    assert.match(tryBody, /setBaselineContent\(saved\.content\)/)
    assert.match(curSrc, /const isDirty = draftReport !== null && baselineContent !== null && JSON\.stringify\(draftReport\) !== JSON\.stringify\(baselineContent\)/)
  })
})

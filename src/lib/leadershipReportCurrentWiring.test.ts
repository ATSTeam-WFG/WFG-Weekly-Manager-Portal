// Run with: node --test src/lib/leadershipReportCurrentWiring.test.ts
//
// Leadership Report — the Current workspace (two-column: a tabbed
// reference column on the left, the editable draft on the right).
// LeadershipReportCurrent.tsx imports supabaseClient.ts transitively (via
// leadershipReportDraftService.ts/executiveSummaryService.ts), so — like
// every other Supabase-touching component in this app — it cannot be
// imported and executed directly under plain `node --test`; verified via
// source inspection instead. Deterministic fingerprint behavior itself is
// verified by real execution in atsContentFingerprint.test.ts.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const dir = path.dirname(fileURLToPath(import.meta.url))
const curSrc = readFileSync(path.join(dir, '..', 'components', 'LeadershipReportCurrent.tsx'), 'utf8')
const lrCss = readFileSync(path.join(dir, '..', 'components', 'LeadershipReport.css'), 'utf8')

describe('LeadershipReportCurrent.tsx — loading a week loads its saved draft, or deep-copies the ATS source; never persists merely by opening', () => {
  test('an existing saved draft loads its content directly — checked, and taken, before falling back to a deep copy', () => {
    const savedBranchIndex = curSrc.indexOf('if (savedDraft) {')
    const setFromDraftIndex = curSrc.indexOf('setDraftReport(savedDraft.content)')
    const deepCopyBranchIndex = curSrc.indexOf('setDraftReport(copy)')
    assert.ok(savedBranchIndex !== -1 && setFromDraftIndex !== -1 && deepCopyBranchIndex !== -1)
    assert.ok(savedBranchIndex < setFromDraftIndex && setFromDraftIndex < deepCopyBranchIndex, 'expected the saved-draft branch (and its assignment) before the deep-copy fallback in source order')
  })

  test('no saved draft still falls back to a deep copy of the current ATS source, exactly as before', () => {
    assert.match(curSrc, /const copy = deepCopyAtsReport\(persisted\.sections\)/)
    assert.match(curSrc, /setDraftReport\(copy\)/)
    assert.match(curSrc, /setBaselineContent\(copy\)/)
  })

  test('loading a week is read-only — fetchLeadershipReportDraft is called inside the load effect, saveLeadershipReportDraft is not', () => {
    const effectStart = curSrc.indexOf('useEffect(() => {')
    const effectEnd = curSrc.indexOf("}, [week.weekStartDate])") + "}, [week.weekStartDate])".length
    const effectBody = curSrc.slice(effectStart, effectEnd)
    assert.match(effectBody, /fetchLeadershipReportDraft\(week\.weekStartDate\)/)
    assert.equal(/saveLeadershipReportDraft\(/.test(effectBody), false, 'merely opening the page/changing week must never call the save RPC')
  })

  test('switching weeks re-fetches independently — the load effect depends only on week.weekStartDate', () => {
    assert.match(curSrc, /\}, \[week\.weekStartDate\]\)/)
  })
})

describe('LeadershipReportCurrent.tsx — Save Draft sends the correct data and never mutates the ATS source', () => {
  test('the fingerprint is computed over the LEFT ATS source (sourceReport) — never the right-side draft content', () => {
    assert.match(curSrc, /computeAtsContentFingerprint\(sourceReport\)/)
    assert.equal(/computeAtsContentFingerprint\(draftReport\)/.test(curSrc), false)
  })

  test('the save call sends the current week/source identifiers and the right-side draft as content', () => {
    const callStart = curSrc.indexOf('const saved = await saveLeadershipReportDraft({')
    const callEnd = curSrc.indexOf('})', callStart)
    const callArgs = curSrc.slice(callStart, callEnd)
    assert.match(callArgs, /periodStartDate: week\.weekStartDate/)
    assert.match(callArgs, /periodEndDate,/)
    assert.match(callArgs, /periodLabel,/)
    assert.match(callArgs, /sourceAnalysisId,/)
    assert.match(callArgs, /sourceAtsFingerprint,/)
    assert.match(callArgs, /content: draftReport/)
  })

  test('a successful save updates local state (including the dirty-tracking baseline) from the server response and shows a "Draft saved" status', () => {
    const tryStart = curSrc.indexOf('try {', curSrc.indexOf('const handleSaveDraft'))
    const tryEnd = curSrc.indexOf('} catch', tryStart)
    const tryBody = curSrc.slice(tryStart, tryEnd)
    assert.match(tryBody, /setDraftReport\(saved\.content\)/)
    assert.match(tryBody, /setBaselineContent\(saved\.content\)/)
    assert.match(tryBody, /setSaveStatus\('saved'\)/)
    assert.match(curSrc, /saveStatus === 'saved' && <span className="lr-save-status lr-save-status-saved">Draft saved<\/span>/)
  })

  test('a failed save preserves the Admin\'s local edits — the catch block never resets draftReport', () => {
    const catchStart = curSrc.indexOf('} catch (err) {')
    const catchEnd = curSrc.indexOf('\n  }', catchStart)
    const catchBody = curSrc.slice(catchStart, catchEnd)
    assert.equal(/setDraftReport\(/.test(catchBody), false, 'a save failure must never touch draftReport')
    assert.match(catchBody, /setSaveStatus\('error'\)/)
  })

  test('Save Draft is disabled while a save is already in progress — no duplicate concurrent save is possible', () => {
    assert.match(curSrc, /disabled=\{!canSave \|\| saveStatus === 'saving'\}/)
  })

  test('an in-flight or already-completed save cannot be re-triggered by handleSaveDraft itself — it guards on saveStatus === \'saving\'', () => {
    assert.match(curSrc, /if \(!canSave \|\| saveStatus === 'saving' \|\| !draftReport \|\| !sourceReport \|\| !sourceAnalysisId \|\| !periodEndDate\) return/)
  })

  test('further local edits clear a previous "Draft saved"/error status — handleDraftChange resets saveStatus to idle', () => {
    const handlerStart = curSrc.indexOf('const handleDraftChange = (next: AtsReport) => {')
    const handlerEnd = curSrc.indexOf('\n  }', handlerStart)
    const handlerBody = curSrc.slice(handlerStart, handlerEnd)
    assert.match(handlerBody, /setDraftReport\(next\)/)
    assert.match(handlerBody, /setSaveStatus\('idle'\)/)
  })

  test('this file never queries or writes executive_analyses/executive_analysis_versions as a table target', () => {
    assert.equal(/\.from\(['"]executive_analys/.test(curSrc), false)
  })
})

describe('LeadershipReportCurrent.tsx reuses the dedicated, separately-tested ATS content fingerprint helper', () => {
  test('imports computeAtsContentFingerprint from atsContentFingerprint.ts rather than hashing content inline', () => {
    assert.match(curSrc, /import \{ computeAtsContentFingerprint \} from '\.\.\/lib\/atsContentFingerprint'/)
  })
})

describe('LeadershipReportCurrent.tsx — left column: ATS Format is the default tab, Previous Work is read-only', () => {
  test('leftTab state defaults to \'ats\'', () => {
    assert.match(curSrc, /const \[leftTab, setLeftTab\] = useState<LeftTab>\('ats'\)/)
  })

  test('the two left tabs are exactly "1  ATS Format" and "2  Previous Work"', () => {
    assert.match(curSrc, /1&nbsp; ATS Format/)
    assert.match(curSrc, /2&nbsp; Previous Work/)
  })

  test('the Previous Work tab renders via the unmodified, read-only AtsReportView — no edit affordance, no selector of any kind', () => {
    const paneStart = curSrc.indexOf('<h2>My Previous Leadership Report</h2>')
    const paneEnd = curSrc.indexOf('<div className="lr-col-draft">')
    assert.ok(paneStart !== -1 && paneEnd !== -1 && paneStart < paneEnd)
    const paneJsx = curSrc.slice(paneStart, paneEnd)
    assert.match(paneJsx, /<AtsReportView report=\{previousDraft\.content\}/)
    assert.equal(/AtsTopicsEditForm|<select|<input|onChange=/.test(paneJsx), false)
  })

  test('fetching the previous draft passes only the current week\'s start date — no owner/user identifier of any kind is ever passed from this component', () => {
    assert.match(curSrc, /fetchPreviousLeadershipReportDraft\(week\.weekStartDate\)/)
  })

  test('an absent previous draft shows the exact required empty-state copy, never substituting the ATS source or another owner\'s content', () => {
    assert.match(curSrc, /<p>No previous report available\.<\/p>/)
  })

  test('the previous-report fetch is independent of, and does not gate on, this week\'s ATS source validity', () => {
    const fetchIndex = curSrc.indexOf('fetchPreviousLeadershipReportDraft(week.weekStartDate)')
    const atsFetchIndex = curSrc.indexOf("fetchPersistedAnalysis('weekly', week.weekStartDate)")
    assert.ok(fetchIndex !== -1 && atsFetchIndex !== -1 && fetchIndex < atsFetchIndex, 'expected the previous-draft fetch to be independent of (and precede) the ATS source fetch/branching')
  })

  test('the ATS Format tab is strictly read-only — no edit affordance anywhere in its branch, and has exactly one button (Print/Download ATS Report)', () => {
    const atsStart = curSrc.indexOf("leftTab === 'ats' ? (")
    const atsEnd = curSrc.indexOf('<h2>My Previous Leadership Report</h2>', atsStart)
    const atsJsx = curSrc.slice(atsStart, atsEnd)
    assert.match(atsJsx, /<AtsReportView report=\{sourceReport\}/)
    assert.equal(/AtsTopicsEditForm|onChange=/.test(atsJsx), false)
    const buttonCount = (atsJsx.match(/<button/g) ?? []).length
    assert.equal(buttonCount, 1, 'expected exactly one button (Print / Download ATS Report) in the ATS Format tab')
    assert.match(atsJsx, />\s*Print \/ Download ATS Report\s*</)
  })

  test('an empty state explains the ATS report must be generated from Weekly Summary first, when none exists yet', () => {
    assert.match(curSrc, /No ATS report has been generated for this week yet\./)
    assert.match(curSrc, /Generate the weekly ATS report from Weekly Summary first, then return here\./)
  })

  test('a distinct empty state handles a persisted-but-legacy-shaped (pre-ATS) analysis, without ever passing the wrong shape into AtsReportView', () => {
    assert.match(curSrc, /This week&apos;s saved analysis is not in the ATS format Leadership Report requires\./)
    assert.match(curSrc, /!sourceIsAtsShaped \|\| !sourceReport/)
  })
})

describe('LeadershipReportCurrent.tsx — right column receives an independent deep copy, editable only in memory', () => {
  test('deepCopyAtsReport builds new topic objects and a new bullets array per topic — never a shared reference to the source', () => {
    assert.match(curSrc, /function deepCopyAtsReport\(report: AtsReport\): AtsReport \{/)
    assert.match(curSrc, /bullets: \[\.\.\.topic\.bullets\],/)
    assert.match(curSrc, /topics: report\.topics\.map\(\(topic\) => \(\{/)
  })

  test('editing (AtsTopicsEditForm) only ever targets draftReport — never sourceReport/setSourceReport', () => {
    assert.match(curSrc, /<AtsTopicsEditForm report=\{draftReport\} onChange=\{handleDraftChange\} \/>/)
    assert.equal(/AtsTopicsEditForm report=\{sourceReport\}/.test(curSrc), false)
  })

  test('Edit/Done Editing toggles a local mode state only — no network call, no persistence call, of any kind', () => {
    assert.match(curSrc, /onClick=\{\(\) => setMode\('edit'\)\}/)
    assert.match(curSrc, /onClick=\{\(\) => setMode\('view'\)\}/)
    assert.equal(/from ['"]\.\.\/lib\/supabaseClient['"]/.test(curSrc), false)
    assert.equal(/\.rpc\(/.test(curSrc), false)
  })

  test('default right-side state is view mode, rendered via the unmodified, read-only AtsReportView', () => {
    assert.match(curSrc, /const \[mode, setMode\] = useState<Mode>\('view'\)/)
    assert.match(curSrc, /<AtsReportView report=\{draftReport\} periodLabel=\{periodLabel\} \/>/)
  })
})

describe('LeadershipReportCurrent.tsx — right-side action visual hierarchy (Save Draft / Print-Download switch with mode)', () => {
  test('view mode: Save Draft reads as secondary, Print / Download Report reads as primary', () => {
    assert.match(curSrc, /className=\{`btn \$\{mode === 'edit' \? 'btn-primary' : 'btn-secondary'\}`\}/)
  })

  test('edit mode: Save Draft reads as primary, Print / Download Report steps back to secondary', () => {
    assert.match(curSrc, /className=\{`btn \$\{mode === 'edit' \? 'btn-secondary' : 'btn-primary'\} no-print`\}/)
  })

  test('Edit and Done Editing remain plain secondary in both modes, unaffected by this hierarchy change', () => {
    assert.match(curSrc, /<button type="button" className="btn btn-secondary" onClick=\{\(\) => setMode\('edit'\)\}>/)
    assert.match(curSrc, /<button type="button" className="btn btn-secondary" onClick=\{\(\) => setMode\('view'\)\}>/)
  })

  test('both Print / Download buttons are wired to their own dedicated print function, each disabled only when there is nothing to print', () => {
    assert.match(curSrc, /onClick=\{printLeadershipReportAtsOnly\}\s*\n\s*disabled=\{!hasSource \|\| !sourceIsAtsShaped \|\| !sourceReport\}/)
    assert.match(curSrc, /onClick=\{printLeadershipReportDraftOnly\}\s*\n\s*disabled=\{!draftReport\}/)
  })
})

describe('LeadershipReportCurrent.tsx — edit-mode presentation is refined at the page-container level only', () => {
  test('a new .lr-edit-container wraps AtsTopicsEditForm in edit mode — AtsTopicsEditForm.tsx/its own CSS are never touched', () => {
    assert.match(curSrc, /<div className="lr-edit-container">\s*\n\s*<AtsTopicsEditForm report=\{draftReport\} onChange=\{handleDraftChange\} \/>\s*\n\s*<\/div>/)
  })

  test('the view-mode branch (AtsReportView) is unaffected — the new container is scoped to the edit-mode branch only', () => {
    const viewModeIndex = curSrc.indexOf('<AtsReportView report={draftReport} periodLabel={periodLabel} />')
    const editContainerIndex = curSrc.indexOf('<div className="lr-edit-container">')
    assert.ok(viewModeIndex !== -1 && editContainerIndex !== -1 && editContainerIndex < viewModeIndex, 'expected the edit branch (with its container) before the view branch in source order')
  })
})

describe('LeadershipReportCurrent.tsx — week label and safe date-only formatting', () => {
  test('weekEndingLabel uses parseDateOnly (week.ts), never `new Date(dateOnlyString)` — periodEndDate is a date-only value (see the production off-by-one fix)', () => {
    assert.match(curSrc, /import \{ parseDateOnly \} from '\.\.\/utils\/week'/)
    assert.match(curSrc, /function weekEndingLabel\(periodEndDate: string\): string \{/)
    assert.match(curSrc, /parseDateOnly\(periodEndDate\)\.toLocaleDateString/)
  })

  test('the week-nav toolbar mirrors the established Admin Dashboard pattern: Previous/Next buttons, a week label, and the shared .week-current-badge (never redefined)', () => {
    assert.match(curSrc, /Previous/)
    assert.match(curSrc, /Next/)
    assert.match(curSrc, /\{isCurrentWeek && <span className="week-current-badge">Current<\/span>\}/)
  })
})

describe('LeadershipReportCurrent.tsx — frozen Executive Analysis/ATS components are reused unmodified', () => {
  test('AtsReportView.tsx and AtsTopicsEditForm.tsx are reused unmodified — this file never redefines either exported name', () => {
    const atsViewSrc = readFileSync(path.join(dir, '..', 'components', 'AtsReportView.tsx'), 'utf8')
    const atsEditFormSrc = readFileSync(path.join(dir, '..', 'components', 'AtsTopicsEditForm.tsx'), 'utf8')
    assert.match(atsViewSrc, /export default function AtsReportView/)
    assert.match(atsEditFormSrc, /export default function AtsTopicsEditForm/)
    assert.equal(/function AtsReportView\(|function AtsTopicsEditForm\(/.test(curSrc), false)
  })

  test('calls no AI generation endpoint of any kind', () => {
    assert.equal(curSrc.includes('/api/executive-summary'), false)
    assert.equal(curSrc.includes('generateReportingAnalysis'), false)
  })
})

describe('LeadershipReport.css — two-column desktop layout (Phase 2E), no tabs/toggle-select, responsive stacking independent of print', () => {
  test('two equal-width columns via CSS grid — approximately 1fr/1fr, per the approved hand-drawn layout', () => {
    assert.match(lrCss, /\.lr-columns \{\s*\n\s*display: grid;\s*\n\s*grid-template-columns: 1fr 1fr;/)
    assert.equal(/<select/.test(curSrc), false)
  })

  test('the left (reference) and right (draft) columns are visually distinguished — muted/recessed reference vs. a crisper draft surface with the terracotta accent already used for .executive-summary-content elsewhere', () => {
    assert.match(lrCss, /\.lr-pane-source,\s*\n\.lr-pane-history \{\s*\n\s*background: var\(--warm-cream\);/)
    assert.match(lrCss, /\.lr-pane-draft \{\s*\n\s*background: var\(--white\);\s*\n\s*border: 1px solid var\(--soft-sand\);\s*\n\s*border-top: 4px solid var\(--terracotta\);/)
  })

  test('below 1100px the columns stack to a single column — a genuinely smaller-screen breakpoint, not the print/mobile-nav breakpoints', () => {
    assert.match(lrCss, /@media \(max-width: 1100px\) \{\s*\n\s*\.lr-columns \{\s*\n\s*grid-template-columns: 1fr;/)
  })

  test('LeadershipReport.css\'s @media print rules are scoped to the letterhead and the always-mounted print-only mirrors only — they cannot alter desktop presentation (see leadershipReportPrintWiring.test.ts for the full print isolation coverage)', () => {
    const mediaPrintMatch = lrCss.match(/@media print \{([\s\S]*?)\n\}/)
    assert.ok(mediaPrintMatch, 'expected a @media print block in LeadershipReport.css')
    assert.match(mediaPrintMatch[1], /\.lr-current > \.print-header/)
    assert.match(mediaPrintMatch[1], /\.lr-print-ats-only,\s*\n\s*\.lr-print-draft-only,\s*\n\s*\.lr-print-previous-only,\s*\n\s*\.lr-print-history-only \{\s*\n\s*display: block;/)
  })

  test('.lr-edit-container is a light, restrained frame (white surface, thin border, comfortable padding) — not a second heavy visual layer, and declares no property that could shrink controls/inputs inside AtsTopicsEditForm', () => {
    assert.match(lrCss, /\.lr-edit-container \{\s*\n\s*background: var\(--white\);\s*\n\s*border: 1px solid var\(--soft-sand\);\s*\n\s*border-radius: 10px;\s*\n\s*padding: 20px;\s*\n\s*\}/)
    assert.equal(/\.lr-edit-container[^}]*font-size/.test(lrCss), false, 'must not override font sizes inside the edit form')
  })
})

describe('LeadershipReportCurrent.tsx — unsaved-edit protection before a week change', () => {
  test('isDirty compares draftReport against baselineContent (the content as loaded or last saved), not merely "is in edit mode"', () => {
    assert.match(curSrc, /const isDirty = draftReport !== null && baselineContent !== null && JSON\.stringify\(draftReport\) !== JSON\.stringify\(baselineContent\)/)
  })

  test('a clean week change bypasses the dialog entirely — requestWeekChange invokes the action immediately when not dirty', () => {
    assert.match(curSrc, /const requestWeekChange = \(action: \(\) => void\) => \{\s*\n\s*if \(!isDirty\) \{\s*\n\s*action\(\)\s*\n\s*return\s*\n\s*\}\s*\n\s*setPendingWeekAction\(\(\) => action\)\s*\n\s*\}/)
    assert.match(curSrc, /const handlePreviousWeek = \(\) => requestWeekChange\(onPreviousWeek\)/)
    assert.match(curSrc, /const handleNextWeek = \(\) => requestWeekChange\(onNextWeek\)/)
  })

  test('window.confirm() is NOT used for this guard — confirmed unreliable in the actual preview environment (silently resolves to false with no visible UI), so a custom ConfirmDialog is used instead', () => {
    // The bare substring appears in this file's own explanatory comments
    // (documenting why it's NOT used) — stripped here (// line comments,
    // the only comment style used in this file) so those can't produce a
    // false positive.
    const codeOnly = curSrc
      .split('\n')
      .map((line) => line.replace(/\/\/.*$/, ''))
      .join('\n')
    assert.equal(/window\.confirm/.test(codeOnly), false)
    assert.match(curSrc, /import ConfirmDialog from '\.\/ConfirmDialog'/)
  })

  test('BRANCH 1 (confirm/Continue): the rendered dialog\'s onConfirm handler actually invokes the pending week-change action — this is the "confirm returns true -> navigation proceeds" path', () => {
    const dialogStart = curSrc.indexOf('{pendingWeekAction && (')
    const dialogEnd = curSrc.indexOf('{loading ? (', dialogStart)
    assert.ok(dialogStart !== -1 && dialogEnd !== -1 && dialogStart < dialogEnd, 'could not locate the rendered <ConfirmDialog> block for pendingWeekAction')
    const dialogJsx = curSrc.slice(dialogStart, dialogEnd)
    assert.match(dialogJsx, /onConfirm=\{\(\) => \{\s*\n\s*const action = pendingWeekAction\s*\n\s*setPendingWeekAction\(null\)\s*\n\s*action\(\)\s*\n\s*\}\}/)
  })

  test('BRANCH 2 (cancel): the rendered dialog\'s onCancel handler only clears the pending action — it never invokes onPreviousWeek/onNextWeek, so the week genuinely does not change', () => {
    const dialogStart = curSrc.indexOf('{pendingWeekAction && (')
    const dialogEnd = curSrc.indexOf('{loading ? (', dialogStart)
    const dialogJsx = curSrc.slice(dialogStart, dialogEnd)
    const onCancelMatch = dialogJsx.match(/onCancel=\{([^}]*)\}/)
    assert.ok(onCancelMatch)
    assert.equal(onCancelMatch[1].trim(), '() => setPendingWeekAction(null)')
    assert.equal(/onPreviousWeek|onNextWeek/.test(onCancelMatch[1]), false, 'onCancel must never call the actual navigation callback')
  })

  test('the dialog is rendered only while a week-change action is pending — not shown at all when clean', () => {
    assert.match(curSrc, /\{pendingWeekAction && \(\s*\n\s*<ConfirmDialog/)
  })

  test('the week-nav buttons call the confirm-gated handlers, not the raw onPreviousWeek/onNextWeek props directly', () => {
    assert.match(curSrc, /onClick=\{handlePreviousWeek\}/)
    assert.match(curSrc, /onClick=\{handleNextWeek\}/)
  })

  test('dirty state is reported to the parent on every change, via the onDirtyChange prop — this is how switching to History (which unmounts this component) knows to warn first', () => {
    assert.match(curSrc, /useEffect\(\(\) => \{\s*\n\s*onDirtyChange\(isDirty\)\s*\n\s*\}, \[isDirty, onDirtyChange\]\)/)
  })

  test('no new dependency was introduced for the confirmation — every import is either \'react\' or a relative path within this project', () => {
    const importSpecifiers = [...curSrc.matchAll(/from '([^']+)'/g)].map((m) => m[1])
    assert.ok(importSpecifiers.length > 0, 'expected at least one import to check')
    for (const specifier of importSpecifiers) {
      assert.ok(specifier === 'react' || specifier.startsWith('.'), `unexpected non-relative, non-react import: ${specifier}`)
    }
  })
})

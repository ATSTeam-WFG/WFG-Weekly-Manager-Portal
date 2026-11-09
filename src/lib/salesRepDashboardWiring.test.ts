// Run with: node --experimental-strip-types --test src/lib/salesRepDashboardWiring.test.ts
//
// SalesRepReportForm.tsx and SalesRepDashboard.tsx both transitively import
// the real Supabase client (via repReportsService.ts), which constructs a
// client at module load time — not safe to import and execute directly
// here, same limitation documented throughout this codebase (see
// autosaveWiring.test.ts, deadlinePassedWiring.test.ts). This verifies the
// Phase 1B Sales Rep self-service UI's wiring via source inspection instead.
//
// What this covers:
// - SalesRepReportForm wires useAutosave's save() callback through
//   onSaveDraft (never a second write implementation, never onSubmit), and
//   its submit handler coordinates with autosave via
//   cancelPendingAndAwaitInFlight() BEFORE calling onSubmit — mirroring
//   ReportForm.tsx's own exact wiring, so a background autosave draft write
//   can never race the submit write to the same report row.
// - SalesRepDashboard calls the CORRECT lifecycle RPC for the report's
//   current state: resubmitRejectedSalesRepReport for a rejected report,
//   submitSalesRepReport for a fresh draft/not-started report — never the
//   wrong one for the wrong state (see repReportsService.ts's state-machine
//   comments: submitSalesRepReport only accepts draft -> submitted;
//   resubmitRejectedSalesRepReport is the only path back from rejected).
// - SalesRepDashboard never lets a RepReportError thrown by an RPC call
//   propagate as an unhandled crash — every call site is wrapped in a
//   try/catch.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const dir = path.dirname(fileURLToPath(import.meta.url))
const formSrc = readFileSync(path.join(dir, '..', 'components', 'SalesRepReportForm.tsx'), 'utf8')
const dashboardSrc = readFileSync(path.join(dir, '..', 'components', 'SalesRepDashboard.tsx'), 'utf8')
const repReportsServiceSrc = readFileSync(path.join(dir, 'repReportsService.ts'), 'utf8')

describe('SalesRepReportForm.tsx — wires useAutosave through the SAME persistence path as the manual Save Draft button', () => {
  test('imports useAutosave and RepReportError', () => {
    assert.match(formSrc, /import \{ useAutosave \} from '\.\.\/hooks\/useAutosave'/)
    assert.match(formSrc, /import \{ RepReportError \} from '\.\.\/lib\/repReportsService'/)
  })

  test('the autosave save() callback calls onSaveDraft — never a second write implementation, never onSubmit', () => {
    const autosaveMatch = formSrc.match(/const autosave = useAutosave<SalesRepReportSections>\(\{[\s\S]*?\n  \}\)/)
    assert.ok(autosaveMatch, 'could not locate the useAutosave call')
    const body = autosaveMatch[0]
    assert.match(body, /isLockedError: \(err\) => err instanceof RepReportError && err\.code === 'REP_STATUS_REGRESSION_BLOCKED'/)
    assert.match(body, /await onSaveDraft\(toSave\)/)
    assert.equal(body.includes('onSubmit'), false, 'autosave must never reference onSubmit')
  })

  test('typing (clearFeedback) notifies the autosave hook so a stale Saved/error indicator clears on the next edit', () => {
    const clearFeedbackMatch = formSrc.match(/const clearFeedback = \(\) => \{[\s\S]*?\n  \}/)
    assert.ok(clearFeedbackMatch)
    assert.match(clearFeedbackMatch[0], /autosave\.notifyEditStarted\(\)/)
  })
})

describe('SalesRepReportForm.tsx — manual Save Draft routes through autosave.saveNow, Back is dirty-save-then-navigate', () => {
  test('handleSave shows the saved confirmation and routes persistence through autosave.saveNow(\'manual\')', () => {
    const handleSaveMatch = formSrc.match(/const handleSave = \(\) => \{[\s\S]*?\n  \}/)
    assert.ok(handleSaveMatch)
    assert.match(handleSaveMatch[0], /setSavedMessage\(true\)/)
    assert.match(handleSaveMatch[0], /void autosave\.saveNow\('manual'\)/)
  })

  test('handleBackClick awaits autosave.saveNow(\'back\') and navigates (onBack()) only on a \'success\' outcome', () => {
    const handleBackClickMatch = formSrc.match(/const handleBackClick = async \(\) => \{[\s\S]*?\n  \}/)
    assert.ok(handleBackClickMatch, 'could not locate handleBackClick')
    const body = handleBackClickMatch[0]
    assert.match(body, /const outcome = await autosave\.saveNow\('back'\)/)
    assert.match(body, /if \(outcome === 'success'\) \{\s*\n\s*onBack\(\)\s*\n\s*\}/)
  })
})

// Bug class this guards against (same one documented in autosaveWiring.test.ts
// for ReportForm.tsx): a background autosave draft write and the final
// Submit/Resubmit write both target the same report row, with no
// coordination between them otherwise. Calling onSubmit(data) directly,
// bypassing useAutosave's single-flight queue, could let a concurrent
// 'draft' write land after the 'submitted' write and silently revert status.
describe('SalesRepReportForm.tsx — Submit/Resubmit never races a background autosave write to the same report row', () => {
  test('handleSubmitClick awaits autosave.cancelPendingAndAwaitInFlight() before calling onSubmit, so any autosave write already in flight (or about to fire) fully lands first', () => {
    const handleSubmitClickMatch = formSrc.match(/const handleSubmitClick = async \(\) => \{[\s\S]*?\n  \}/)
    assert.ok(handleSubmitClickMatch, 'could not locate handleSubmitClick')
    const body = handleSubmitClickMatch[0]
    const cancelIndex = body.indexOf('await autosave.cancelPendingAndAwaitInFlight()')
    const onSubmitIndex = body.indexOf('onSubmit(data)')
    assert.ok(cancelIndex !== -1 && onSubmitIndex !== -1)
    assert.ok(cancelIndex < onSubmitIndex, 'the autosave coordination wait must happen before onSubmit is ever called')
  })

  test('a local re-entrancy guard (submitClickInFlightRef) blocks a second click during the async gap before isSubmitting has re-rendered as true', () => {
    assert.match(formSrc, /const submitClickInFlightRef = useRef\(false\)/)
    const handleSubmitClickMatch = formSrc.match(/const handleSubmitClick = async \(\) => \{[\s\S]*?\n  \}/)
    assert.ok(handleSubmitClickMatch)
    const body = handleSubmitClickMatch[0]
    assert.match(body, /if \(isSubmitting \|\| submitClickInFlightRef\.current\) return/)
    assert.match(body, /submitClickInFlightRef\.current = true/)
    assert.match(body, /finally \{\s*\n\s*submitClickInFlightRef\.current = false\s*\n\s*\}/)
  })
})

describe('SalesRepReportForm.tsx — rejected-correction mode surfaces the reason and relabels the action', () => {
  test('shows a rejection banner with the rejectionReason when isRejectedCorrection is true', () => {
    assert.match(formSrc, /isRejectedCorrection && \(/)
    assert.match(formSrc, /rejectionReason/)
  })

  test('the submit button reads "Resubmit" in correction mode, not "Submit Report"', () => {
    assert.match(formSrc, /const submitLabel = isRejectedCorrection \? 'Resubmit' : 'Submit Report'/)
  })
})

describe('SalesRepDashboard.tsx — calls the correct lifecycle RPC for the report\'s current state, never the wrong one', () => {
  test('imports both submitSalesRepReport and resubmitRejectedSalesRepReport from repReportsService', () => {
    assert.match(dashboardSrc, /submitSalesRepReport/)
    assert.match(dashboardSrc, /resubmitRejectedSalesRepReport/)
  })

  test('handleSubmit branches on whether the report is currently rejected: resubmitRejectedSalesRepReport for rejected, submitSalesRepReport otherwise (covers both not-started and draft)', () => {
    const handleSubmitMatch = dashboardSrc.match(/const handleSubmit = async \([\s\S]*?\): Promise<void> => \{[\s\S]*?\n  \}/)
    assert.ok(handleSubmitMatch, 'could not locate handleSubmit')
    const body = handleSubmitMatch[0]
    assert.match(
      body,
      /reportState === 'rejected' \? await resubmitRejectedSalesRepReport\(week\.weekStartDate\) : await submitSalesRepReport\(week\.weekStartDate\)/,
    )
  })

  test('there is exactly one call site for each of submitSalesRepReport and resubmitRejectedSalesRepReport, both inside handleSubmit — no second, uncoordinated call path exists', () => {
    const submitCalls = dashboardSrc.match(/\bsubmitSalesRepReport\(week\.weekStartDate\)/g) ?? []
    const resubmitCalls = dashboardSrc.match(/\bresubmitRejectedSalesRepReport\(week\.weekStartDate\)/g) ?? []
    assert.equal(submitCalls.length, 1, 'submitSalesRepReport should be called from exactly one place')
    assert.equal(resubmitCalls.length, 1, 'resubmitRejectedSalesRepReport should be called from exactly one place')
  })
})

describe('SalesRepDashboard.tsx — a RepReportError thrown by any RPC call is always caught, never an unhandled crash', () => {
  test('handleSaveDraft wraps saveSalesRepReportDraft in try/catch', () => {
    const match = dashboardSrc.match(/const handleSaveDraft = async \([\s\S]*?\): Promise<void> => \{[\s\S]*?\n  \}/)
    assert.ok(match, 'could not locate handleSaveDraft')
    const body = match[0]
    assert.match(body, /try \{/)
    assert.match(body, /await saveSalesRepReportDraft\(/)
    assert.match(body, /\} catch \(err\) \{/)
  })

  test('handleSubmit wraps both the draft-save and the submit/resubmit RPC calls in a single try/catch, and maps SUBMISSION_DEADLINE_PASSED to a specific admin-exception message', () => {
    const match = dashboardSrc.match(/const handleSubmit = async \([\s\S]*?\): Promise<void> => \{[\s\S]*?\n  \}/)
    assert.ok(match, 'could not locate handleSubmit')
    const body = match[0]
    assert.match(body, /try \{/)
    assert.match(body, /\} catch \(err\) \{/)
    assert.match(body, /err instanceof RepReportError/)
    assert.match(body, /err\.code === 'SUBMISSION_DEADLINE_PASSED'/)
    assert.match(body, /Contact your admin to request an exception/)
  })

  test('the fetchRepReport load effect catches a failed fetch and sets a load-error state rather than leaving the page blank/crashed', () => {
    assert.match(dashboardSrc, /fetchRepReport\(repId, week\.weekStartDate\)[\s\S]*?\.catch\(\(\) => \{[\s\S]*?setLoadError\(true\)/)
  })

  test('the fetchRepReportHistory load effect catches a failed fetch and sets its own load-error state', () => {
    assert.match(dashboardSrc, /fetchRepReportHistory\(repId\)[\s\S]*?\.catch\(\(\) => \{[\s\S]*?setHistoryLoadError\(true\)/)
  })

  test('a load error renders a retry affordance rather than a blank page', () => {
    assert.match(dashboardSrc, /loadError/)
    assert.match(dashboardSrc, /onClick=\{retryLoad\}/)
  })
})

describe('SalesRepDashboard.tsx — no autosubmit: Submit/Resubmit only ever fires from an explicit rep action', () => {
  test('handleSubmit is only ever referenced as the onSubmit prop passed to SalesRepReportForm (a user-initiated button click inside that form), never called from a useEffect/timer', () => {
    assert.equal(/setInterval|setTimeout/.test(dashboardSrc), false, 'SalesRepDashboard must never schedule any automatic timer-driven action')
    assert.match(dashboardSrc, /onSubmit=\{handleSubmit\}/)
  })
})

// Phase 1 (Sales Rep Dashboard Manager Visibility) — the rep's assigned
// Manager's name/email, backed by the new
// 20261104090000_profiles_select_assigned_manager_for_rep.sql RLS policy
// (assigned/unrelated/reassigned authorization itself is verified live by
// that migration's own embedded self-test against a disposable Postgres
// instance, not re-derived here via source inspection).
describe('SalesRepDashboard.tsx — Manager identity card', () => {
  test('imports fetchMyCurrentManagerAssignment from repReportsService and fetchProfilesByIds from repRosterService', () => {
    assert.match(dashboardSrc, /fetchMyCurrentManagerAssignment/)
    assert.match(dashboardSrc, /import \{ fetchProfilesByIds, type RepProfileSummary \} from '\.\.\/lib\/repRosterService'/)
  })

  test('the manager-identity effect is a separate effect from the report-loading effect, with its own loading state, and never blocks report rendering on failure', () => {
    assert.match(dashboardSrc, /const \[manager, setManager\] = useState<RepProfileSummary \| null>\(null\)/)
    assert.match(dashboardSrc, /const \[managerLoading, setManagerLoading\] = useState\(true\)/)
    const effectMatch = dashboardSrc.match(/useEffect\(\(\) => \{\s*\n\s*let active = true\s*\n\s*setManagerLoading\(true\)[\s\S]*?\n {2}\}, \[repId, reloadToken\]\)/)
    assert.ok(effectMatch, 'could not locate the manager-identity effect')
    assert.match(effectMatch[0], /\.catch\(\(\) => \{\s*\n\s*if \(active\) setManager\(null\)/)
  })

  test('renders "Manager not assigned yet" when the rep has no current manager assignment', () => {
    assert.match(dashboardSrc, /Manager not assigned yet/)
  })

  test('renders the manager\'s full name and email when present', () => {
    assert.match(dashboardSrc, /manager\.fullName \?\? 'Unnamed Manager'/)
    assert.match(dashboardSrc, /\{manager\.email\}/)
  })
})

describe('repReportsService.ts — fetchMyCurrentManagerAssignment is scoped to the caller\'s own CURRENT assignment only', () => {
  test('filters rep_manager_assignments by rep_id = repId and unassigned_at IS NULL, returning at most one row', () => {
    const match = repReportsServiceSrc.match(/export async function fetchMyCurrentManagerAssignment\(repId: string\): Promise<RepManagerAssignment \| null> \{[\s\S]*?\n\}/)
    assert.ok(match, 'could not locate fetchMyCurrentManagerAssignment')
    const body = match[0]
    assert.match(body, /\.eq\('rep_id', repId\)/)
    assert.match(body, /\.is\('unassigned_at', null\)/)
    assert.match(body, /\.maybeSingle\(\)/)
  })

  test('never throws on a missing assignment or a query error — returns null both times', () => {
    const match = repReportsServiceSrc.match(/export async function fetchMyCurrentManagerAssignment\(repId: string\): Promise<RepManagerAssignment \| null> \{[\s\S]*?\n\}/)
    assert.ok(match)
    const body = match[0]
    assert.doesNotMatch(body, /throw/)
    assert.match(body, /if \(error\) \{[\s\S]*?return null\s*\n\s*\}/)
    assert.match(body, /return data \? assignmentFromRow\(data as RepManagerAssignmentRow\) : null/)
  })
})

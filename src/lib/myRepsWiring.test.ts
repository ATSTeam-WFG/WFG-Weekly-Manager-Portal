// Run with: node --experimental-strip-types --test src/lib/myRepsWiring.test.ts
//
// Phase 1B — the Manager-facing "My Reps" screen (src/components/MyReps.tsx).
// Verified via source inspection, the established pattern for components
// with no rendering harness in this project (see e.g.
// weeklySummaryWeekNavWiring.test.ts / adminDashboardRefinementWiring.test.ts).
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const dir = path.dirname(fileURLToPath(import.meta.url))
const myRepsSrc = readFileSync(path.join(dir, '..', 'components', 'MyReps.tsx'), 'utf8')

// Beta feedback (2026-11-16): Approve/Reject is replaced by an optional,
// non-blocking "Provide Feedback" action — ReportFeedbackPanel, not
// ReportReviewPanel. Any row with a report (draft or submitted) can be
// opened; there is no reviewability gate anymore since feedback never
// changes the report's status.
describe('MyReps.tsx — Approve/Reject is fully replaced by optional, non-blocking feedback', () => {
  test('never references the old isReviewable gate, ReportReviewPanel, or reviewSalesRepReport', () => {
    assert.doesNotMatch(myRepsSrc, /isReviewable/)
    assert.doesNotMatch(myRepsSrc, /ReportReviewPanel/)
    assert.doesNotMatch(myRepsSrc, /reviewSalesRepReport/)
    assert.doesNotMatch(myRepsSrc, />Approve</)
    assert.doesNotMatch(myRepsSrc, />Reject</)
  })

  test('any row with a report (draft or submitted) opens ReportFeedbackPanel — gated on hasReport, not on submission status', () => {
    assert.match(myRepsSrc, /const hasReport = row\.report !== null/)
    assert.match(myRepsSrc, /onClick=\{hasReport \? \(\) => setSelectedRepId\(row\.repId\) : undefined\}/)
    assert.match(myRepsSrc, /\{selectedRow && selectedRow\.report && \(\s*\n\s*<ReportFeedbackPanel/)
  })

  test('a \'draft\' report row still renders the "Draft (not yet submitted)" label', () => {
    assert.match(myRepsSrc, /if \(report\.status === 'draft'\) return 'Draft \(not yet submitted\)'/)
  })
})

describe('MyReps.tsx — addRepReportFeedback is only ever called with non-empty feedback text, and is optional', () => {
  test('a trimmed, non-empty feedback text gates whether Send Feedback is enabled — but closing without sending is always allowed', () => {
    assert.match(myRepsSrc, /const trimmedFeedback = feedbackText\.trim\(\)/)
    assert.match(myRepsSrc, /const canSend = trimmedFeedback\.length > 0 && !sending/)
    assert.match(myRepsSrc, /onClick=\{onClose\}/)
  })

  test('Send Feedback is disabled unless canSend is true', () => {
    assert.match(myRepsSrc, /className="btn btn-primary myreps-approve-btn" disabled=\{!canSend\}/)
  })

  test('handleSend bails out early (never calls the service) unless canSend, and otherwise calls addRepReportFeedback with the trimmed text', () => {
    assert.match(myRepsSrc, /const handleSend = async \(\) => \{\s*\n\s*if \(!canSend\) return/)
    assert.match(myRepsSrc, /addRepReportFeedback\(report\.id, trimmedFeedback\)/)
  })

  test('FEEDBACK_REQUIRED from the server is still handled with a friendly message, as defense in depth beyond the client-side gate', () => {
    assert.match(myRepsSrc, /case 'FEEDBACK_REQUIRED':/)
  })
})

describe('MyReps.tsx — goes through the service layer for the roster, never queries rep_manager_assignments directly', () => {
  test('imports and calls fetchMyCurrentReps from repReportsService', () => {
    assert.match(myRepsSrc, /import \{[\s\S]*fetchMyCurrentReps[\s\S]*\} from '\.\.\/lib\/repReportsService'/)
    assert.match(myRepsSrc, /fetchMyCurrentReps\(managerId\)/)
  })

  test('never issues its own raw supabase.from(\'rep_manager_assignments\' query', () => {
    assert.equal(myRepsSrc.includes("supabase.from('rep_manager_assignments'"), false)
  })

  test('never imports the supabase client directly at all — every read/write goes through the service layer', () => {
    assert.equal(/from ['"]\.\.\/lib\/supabaseClient['"]/.test(myRepsSrc), false)
  })
})

describe('MyReps.tsx — other required wiring', () => {
  // Manager Dashboard redesign (2026-11-13) added one additive, optional
  // prop (embedded) for reuse inside ManagerDashboardOverview — managerId
  // and onBack remain the only REQUIRED props, and embedded defaults to
  // false, so every existing caller (Team Reports) is unaffected.
  test('is a self-contained, droppable component: managerId + onBack required, embedded optional and additive only', () => {
    assert.match(myRepsSrc, /interface MyRepsProps \{\s*\n\s*managerId: string\s*\n\s*onBack: \(\) => void/)
    assert.match(myRepsSrc, /embedded\?: boolean/)
    assert.match(myRepsSrc, /export default function MyReps\(\{ managerId, onBack, embedded = false \}: MyRepsProps\)/)
  })

  test('a failed roster load surfaces an error state with a Retry control, never silently rendering blank', () => {
    assert.match(myRepsSrc, /loadState === 'error'/)
    assert.match(myRepsSrc, /onClick=\{handleRetry\}/)
  })
})

// Phase 3 (Manager Dashboard Enhancements) — week selector, superseding the
// Phase 1B "current week only" minimum-integration scope (the old test
// asserting getCurrentReportingWeek usage is replaced by these).
describe('MyReps.tsx — Phase 3 week selector, consistent with AdminDashboard\'s own pattern', () => {
  test('uses getReportingWeekByOffset with local weekOffset state, never getCurrentReportingWeek directly', () => {
    assert.match(myRepsSrc, /import \{ getReportingWeekByOffset \} from '\.\.\/utils\/week'/)
    assert.match(myRepsSrc, /const \[weekOffset, setWeekOffset\] = useState\(0\)/)
    assert.match(myRepsSrc, /const week = getReportingWeekByOffset\(weekOffset\)/)
    assert.equal(/getCurrentReportingWeek/.test(myRepsSrc), false)
  })

  test('Next is disabled at the current week (isCurrentWeek), and never advances past it — mirrors AdminDashboard\'s Math.min(0, ...) clamp', () => {
    assert.match(myRepsSrc, /const isCurrentWeek = weekOffset === 0/)
    assert.match(myRepsSrc, /onClick=\{\(\) => setWeekOffset\(\(o\) => Math\.min\(0, o \+ 1\)\)\}/)
    assert.match(myRepsSrc, /disabled=\{isCurrentWeek\}/)
  })

  test('reuses the shared, never-redefined .week-nav-btn/.week-selector-label/.week-current-badge classes from AdminDashboard.css, rather than inventing new ones', () => {
    assert.match(myRepsSrc, /className="week-selector-label"/)
    assert.match(myRepsSrc, /className="week-nav-btn"/)
    assert.match(myRepsSrc, /className=\{`week-current-badge\$\{isCurrentWeek \? '' : ' myreps-week-current-badge-hidden'\}`\}/)
    const myRepsCss = readFileSync(path.join(dir, '..', 'components', 'MyReps.css'), 'utf8')
    assert.equal(/^\.week-current-badge\s*\{/m.test(myRepsCss), false, 'must reuse the existing shared .week-current-badge, never redefine it')
    assert.equal(/^\.week-nav-btn\s*\{/m.test(myRepsCss), false, 'must reuse the existing shared .week-nav-btn, never redefine it')
  })

  test('the roster-loading effect depends on week.weekStartDate, so changing weeks refetches', () => {
    const effectMatch = myRepsSrc.match(/\}, \[managerId, week\.weekStartDate, reloadToken\]\)/)
    assert.ok(effectMatch, 'the load effect must depend on week.weekStartDate so a week change triggers a refetch')
  })

  // Regression test (2026-11-13) — Demo Manager found that Team Reports'
  // header/week-selector/Back button row visibly reflowed to a different
  // layout between the current week (badge present) and a past week (badge
  // absent), because the badge was conditionally OMITTED from the tree
  // rather than just hidden, changing the row's total rendered width enough
  // to trigger a different flex-wrap outcome. Root cause: conditional
  // rendering (`{isCurrentWeek && <span>...}`), not CSS. Fix: always render
  // the badge element; only its visibility toggles via a new, MyReps-scoped
  // class, so the row occupies identical width regardless of which week is
  // selected.
  describe('MyReps.tsx — Team Reports header/week-selector/Back button layout never reflows between weeks', () => {
    test('the Current badge is always rendered (never conditionally omitted from the tree) — only a visibility-only class toggles', () => {
      assert.doesNotMatch(myRepsSrc, /\{isCurrentWeek && <span className="week-current-badge">/)
      assert.match(myRepsSrc, /<span className=\{`week-current-badge\$\{isCurrentWeek \? '' : ' myreps-week-current-badge-hidden'\}`\}>Current<\/span>/)
    })

    test('the hidden-state class uses visibility, never display:none — the element still occupies its layout space when not the current week', () => {
      const myRepsCss = readFileSync(path.join(dir, '..', 'components', 'MyReps.css'), 'utf8')
      const ruleMatch = myRepsCss.match(/\.myreps-week-current-badge-hidden\s*\{[\s\S]*?\}/)
      assert.ok(ruleMatch, 'could not locate .myreps-week-current-badge-hidden')
      assert.match(ruleMatch[0], /visibility:\s*hidden/)
      assert.doesNotMatch(ruleMatch[0], /display:\s*none/)
    })

    test('the shared .week-current-badge rule itself (AdminDashboard.css, DO NOT MODIFY) is untouched', () => {
      const adminDashboardCss = readFileSync(path.join(dir, '..', 'components', 'AdminDashboard.css'), 'utf8')
      assert.match(adminDashboardCss, /\/\* SHARED — also used by Reports & Analytics\. DO NOT MODIFY\. \*\//)
    })
  })
})

// Phase 3 — weekly summary counts, reusing Phase 2's bucket logic so a
// Manager's own numbers here always agree with the Leadership Dashboard's.
describe('MyReps.tsx — weekly summary reuses deriveRepReportBucket from Phase 2, never a second independent calculation', () => {
  test('imports deriveRepReportBucket from repReportBucket.ts, the same module AdminManagerRepOverview.tsx uses', () => {
    assert.match(myRepsSrc, /import \{ deriveRepReportBucket, type RepReportBucket \} from '\.\.\/lib\/repReportBucket'/)
  })

  // Beta feedback (2026-11-16): collapsed from the old 4-way
  // missing/pending/approved/rejected buckets to a plain 3-way
  // missing/draft/submitted split.
  test('summaryCounts is built by folding every row through deriveRepReportBucket exactly once, into the 3 mutually exclusive buckets', () => {
    const match = myRepsSrc.match(/const summaryCounts = rows\.reduce\([\s\S]*?\n {2}\)/)
    assert.ok(match, 'could not locate summaryCounts')
    const body = match[0]
    assert.match(body, /const bucket = deriveRepReportBucket\(row\.report\)/)
    assert.match(body, /acc\[bucket\] \+= 1/)
    assert.match(body, /\{ missing: 0, draft: 0, submitted: 0 \}/)
  })

  test('the summary row renders Total Assigned (rows.length), Submitted, In Progress, and Missing — all 4 required figures', () => {
    assert.match(myRepsSrc, /<span className="myreps-summary-value">\{rows\.length\}<\/span>/)
    assert.match(myRepsSrc, />Total Assigned</)
    assert.match(myRepsSrc, />Submitted</)
    assert.match(myRepsSrc, />In Progress</)
    assert.match(myRepsSrc, />Missing</)
    assert.doesNotMatch(myRepsSrc, />Pending Review</)
    assert.doesNotMatch(myRepsSrc, />Approved</)
    assert.doesNotMatch(myRepsSrc, />Needs Correction</)
  })

  test('the summary row only renders once data has loaded (loadState === \'ready\' && rows.length > 0), never with stale/zeroed counts while loading', () => {
    assert.match(myRepsSrc, /loadState === 'ready' && rows\.length > 0 && \(\s*\n\s*<div className="myreps-summary-row">/)
  })

  // Manager Dashboard redesign (2026-11-13) — the summary row is additionally
  // suppressed in embedded mode (the Dashboard overview already shows its
  // own KPI cards above), never in Team Reports' own standalone page.
  test('the summary row is also gated on !embedded, on top of the existing loadState/rows.length checks', () => {
    assert.match(myRepsSrc, /\{!embedded && loadState === 'ready' && rows\.length > 0 && \(/)
  })
})

// Phase 3 — Manager-specific visibility / reassignment correctness. The
// underlying guarantee (RLS + the rep_manager_assignments_one_active_per_rep
// unique index) is unchanged from Phase 1/Phase 2 and already proven live
// (see 20261027140200_rep_manager_assignments.sql's own self-test and this
// engagement's Phase 4B reconciliation) — these tests only confirm MyReps.tsx
// itself still goes through that same, unmodified, RLS-scoped path.
describe('MyReps.tsx — Manager visibility is still scoped entirely by fetchMyCurrentReps(managerId) + RLS, unchanged by Phase 3', () => {
  test('fetchMyCurrentReps is still called with the signed-in Manager\'s own managerId prop, never an arbitrary/selectable id', () => {
    assert.match(myRepsSrc, /const assignments = await fetchMyCurrentReps\(managerId\)/)
  })

  test('the component never accepts or reads a different manager id from props, query params, or user input — managerId is the only id-shaped prop', () => {
    const ifaceMatch = myRepsSrc.match(/interface MyRepsProps \{[\s\S]*?\n\}/)
    assert.ok(ifaceMatch, 'could not locate MyRepsProps')
    assert.match(ifaceMatch[0], /managerId: string/)
    assert.doesNotMatch(ifaceMatch[0], /\bid\b|repId|employeeId|assignedManagerId/)
  })
})

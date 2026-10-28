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

describe('MyReps.tsx — a draft report never gets a review (Approve/Reject) action', () => {
  test("the reviewability gate is explicitly status === 'submitted', not merely 'report exists'", () => {
    assert.match(myRepsSrc, /function isReviewable\(report: RepReport \| null\): report is RepReport \{\s*\n\s*return report !== null && report\.status === 'submitted'\s*\n\s*\}/)
  })

  test('the row click / keyboard handlers that open the review panel are gated behind isReviewable, never unconditional', () => {
    assert.match(myRepsSrc, /const reviewable = isReviewable\(row\.report\)/)
    assert.match(myRepsSrc, /onClick=\{reviewable \? \(\) => setSelectedRepId\(row\.repId\) : undefined\}/)
  })

  test('<ReportReviewPanel>, which renders the Approve/Reject controls, is only ever mounted when isReviewable(selectedRow.report) is true', () => {
    assert.match(myRepsSrc, /\{selectedRow && isReviewable\(selectedRow\.report\) && \(\s*\n\s*<ReportReviewPanel/)
  })

  test('inside the panel, the Approve/Reject controls block itself is additionally conditioned on status === \'submitted\' (belt-and-suspenders with the outer isReviewable gate)', () => {
    assert.match(myRepsSrc, /\{report\.status === 'submitted' && \(\s*\n\s*<div className="myreps-section myreps-review-action">/)
  })

  test('a \'draft\' report row renders the "Draft (not yet submitted)" label, never a review affordance', () => {
    assert.match(myRepsSrc, /if \(report\.status === 'draft'\) return 'Draft \(not yet submitted\)'/)
  })
})

describe('MyReps.tsx — reviewSalesRepReport is only ever called with a non-empty, validated reason', () => {
  test('a trimmed, non-empty reason gates whether the Approve/Reject buttons are even enabled', () => {
    assert.match(myRepsSrc, /const trimmedReason = reason\.trim\(\)/)
    assert.match(myRepsSrc, /const canSubmit = trimmedReason\.length > 0 && submitting === null/)
  })

  test('both the Approve and Reject buttons are disabled unless canSubmit is true', () => {
    const rejectButtonMatch = myRepsSrc.match(/className="btn btn-secondary myreps-reject-btn"\s*\n\s*disabled=\{!canSubmit\}/)
    const approveButtonMatch = myRepsSrc.match(/className="btn btn-primary myreps-approve-btn"\s*\n\s*disabled=\{!canSubmit\}/)
    assert.ok(rejectButtonMatch, 'Reject button must be disabled={!canSubmit}')
    assert.ok(approveButtonMatch, 'Approve button must be disabled={!canSubmit}')
  })

  test('handleDecision bails out early (never calls the service) unless canSubmit, and otherwise calls reviewSalesRepReport with the trimmed reason', () => {
    assert.match(myRepsSrc, /const handleDecision = async \(decision: 'approved' \| 'rejected'\) => \{\s*\n\s*if \(!canSubmit\) return/)
    assert.match(myRepsSrc, /reviewSalesRepReport\(report\.id, decision, trimmedReason\)/)
  })

  test('REASON_REQUIRED from the server is still handled with a friendly message, as defense in depth beyond the client-side gate', () => {
    assert.match(myRepsSrc, /case 'REASON_REQUIRED':/)
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
  test('is a self-contained, droppable component: managerId + onBack only, no other required props', () => {
    assert.match(myRepsSrc, /interface MyRepsProps \{\s*\n\s*managerId: string\s*\n\s*onBack: \(\) => void\s*\n\s*\}/)
    assert.match(myRepsSrc, /export default function MyReps\(\{ managerId, onBack \}: MyRepsProps\)/)
  })

  test('uses getCurrentReportingWeek for the current-week scope, matching the brief\'s "current week only" minimum-integration requirement', () => {
    assert.match(myRepsSrc, /import \{ getCurrentReportingWeek \} from '\.\.\/utils\/week'/)
    assert.match(myRepsSrc, /getCurrentReportingWeek\(\)/)
  })

  test('a failed roster load surfaces an error state with a Retry control, never silently rendering blank', () => {
    assert.match(myRepsSrc, /loadState === 'error'/)
    assert.match(myRepsSrc, /onClick=\{handleRetry\}/)
  })
})

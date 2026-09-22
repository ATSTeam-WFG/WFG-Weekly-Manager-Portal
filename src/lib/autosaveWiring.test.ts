// Run with: node --test src/lib/autosaveWiring.test.ts
//
// useAutosave.ts is a React hook (useState/useEffect/useRef) — actually
// invoking a hook requires React's own runtime, and ReportForm.tsx/App.tsx
// both transitively import the real Supabase client (App.tsx directly;
// ReportForm.tsx via ManagerEditLockedError from reportsService.ts), which
// constructs a client at module load time. Neither is safe to import and
// execute directly here — same limitation documented throughout this
// codebase (see authSessionLifecycleWiring.test.ts, reportFieldAutoGrowWiring.test.ts,
// reportsServiceLockWiring.test.ts). This verifies the Manager Weekly
// Report autosave feature via source inspection instead.
//
// Feature this covers: managers should not have to remember to keep
// clicking Save Draft. If they type responses and step away, switch tabs,
// refresh, or are interrupted, recent work should already be safely
// persisted — via the SAME onSaveDraft/onSaveChanges path the manual
// buttons already use (never a second write implementation), on a 3-second
// trailing debounce with a 30-second max-wait anchored to the start of
// each continuous dirty period, never auto-submitting or overriding the
// Friday 4:00 PM lock / resolveSaveStatus reconciliation.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const dir = path.dirname(fileURLToPath(import.meta.url))
const hookSrc = readFileSync(path.join(dir, '..', 'hooks', 'useAutosave.ts'), 'utf8')
const reportFormSrc = readFileSync(path.join(dir, '..', 'components', 'ReportForm.tsx'), 'utf8')
const appSrc = readFileSync(path.join(dir, '..', 'App.tsx'), 'utf8')

describe('useAutosave.ts — dependency-free, generic, no domain imports', () => {
  test('imports nothing beyond React itself', () => {
    const importLines = hookSrc.match(/^import .*$/gm) ?? []
    assert.equal(importLines.length, 1)
    assert.match(importLines[0], /from 'react'/)
  })
})

describe('useAutosave.ts — 3-second trailing debounce', () => {
  test('debounceMs defaults to 3000 and drives a setTimeout that is re-armed inside the [data] effect', () => {
    assert.match(hookSrc, /debounceMs = 3000/)
    const effectMatch = hookSrc.match(/useEffect\(\(\) => \{[\s\S]*?\}, \[data\]\)/)
    assert.ok(effectMatch, 'could not locate the data-driven scheduling effect')
    assert.match(effectMatch[0], /debounceTimerRef\.current = setTimeout\(\(\) => \{[\s\S]*?\}, debounceMs\)/)
  })

  test('the debounce timer is cleared and replaced on every call of the scheduling effect (i.e. on every keystroke), not left to fire alongside a newer one', () => {
    const effectMatch = hookSrc.match(/useEffect\(\(\) => \{[\s\S]*?\}, \[data\]\)/)
    assert.ok(effectMatch)
    assert.match(effectMatch[0], /if \(debounceTimerRef\.current\) clearTimeout\(debounceTimerRef\.current\)\s*\n\s*debounceTimerRef\.current = setTimeout/)
  })
})

describe('useAutosave.ts — 30-second max-wait anchored to the start of the dirty period', () => {
  test('maxWaitMs defaults to 30000', () => {
    assert.match(hookSrc, /maxWaitMs = 30000/)
  })

  test('the max-wait timer is only started when dirtyPeriodActiveRef is NOT already true — i.e. once per continuous dirty period', () => {
    const effectMatch = hookSrc.match(/useEffect\(\(\) => \{[\s\S]*?\}, \[data\]\)/)
    assert.ok(effectMatch)
    assert.match(
      effectMatch[0],
      /if \(!dirtyPeriodActiveRef\.current\) \{\s*\n\s*dirtyPeriodActiveRef\.current = true\s*\n\s*maxWaitTimerRef\.current = setTimeout\([\s\S]*?, maxWaitMs\)/,
    )
  })

  test('the max-wait branch does NOT sit inside an unconditional block that would re-arm it on every keystroke — it is strictly gated by the dirtyPeriodActiveRef check', () => {
    const effectMatch = hookSrc.match(/useEffect\(\(\) => \{[\s\S]*?\}, \[data\]\)/)
    assert.ok(effectMatch)
    // Exactly one un-guarded assignment to maxWaitTimerRef.current inside
    // the scheduling effect (the one inside the dirtyPeriodActiveRef gate);
    // a second, unconditional assignment would mean it resets every change.
    const assignments = effectMatch[0].match(/maxWaitTimerRef\.current = setTimeout/g) ?? []
    assert.equal(assignments.length, 1)
  })

  test('a successful save clears/ends the current dirty period (dirtyPeriodActiveRef reset to false) before the underlying save call, so the NEXT change starts a fresh 30s window', () => {
    const performSaveMatch = hookSrc.match(/async function performSave\([\s\S]*?\n  \}/)
    assert.ok(performSaveMatch, 'could not locate performSave')
    const body = performSaveMatch[0]
    const clearIndex = body.indexOf('dirtyPeriodActiveRef.current = false')
    const saveCallIndex = body.indexOf('await save(')
    assert.ok(clearIndex !== -1 && saveCallIndex !== -1)
    assert.ok(clearIndex < saveCallIndex, 'the dirty period must end before the save call, not after')
  })
})

describe('useAutosave.ts — dirty comparison / no unnecessary writes', () => {
  test('performSave short-circuits with a successful no-op if the current data already equals the last-saved snapshot, before ever calling save()', () => {
    const performSaveMatch = hookSrc.match(/async function performSave\([\s\S]*?\n  \}/)
    assert.ok(performSaveMatch)
    const body = performSaveMatch[0]
    const dirtyCheckIndex = body.indexOf('if (isEqual(dataToSave, lastSavedRef.current))')
    const saveCallIndex = body.indexOf('await save(')
    assert.ok(dirtyCheckIndex !== -1 && saveCallIndex !== -1)
    assert.ok(dirtyCheckIndex < saveCallIndex)
    assert.match(body, /if \(isEqual\(dataToSave, lastSavedRef\.current\)\) \{\s*\n\s*\/\/[^\n]*\n\s*return 'success'\s*\n\s*\}/)
  })

  test('the scheduling effect itself also treats "matches last saved" as clean — no timers armed, and it clears any that are pending', () => {
    const effectMatch = hookSrc.match(/useEffect\(\(\) => \{[\s\S]*?\}, \[data\]\)/)
    assert.ok(effectMatch)
    assert.match(effectMatch[0], /if \(isEqual\(data, lastSavedRef\.current\)\) \{/)
  })
})

describe('useAutosave.ts — single-flight save guarantee', () => {
  test('performSave awaits any existing in-flight save (inFlightSaveRef) before proceeding, for every trigger', () => {
    const performSaveMatch = hookSrc.match(/async function performSave\([\s\S]*?\n  \}/)
    assert.ok(performSaveMatch)
    assert.match(
      performSaveMatch[0],
      /if \(inFlightSaveRef\.current\) \{\s*\n\s*await inFlightSaveRef\.current\.catch\(\(\) => \{\}\)\s*\n\s*\}/,
    )
  })

  test('the in-flight promise is tracked in a ref before awaiting it, and cleared immediately after — no two concurrent underlying save() calls are possible', () => {
    const performSaveMatch = hookSrc.match(/async function performSave\([\s\S]*?\n  \}/)
    assert.ok(performSaveMatch)
    const body = performSaveMatch[0]
    assert.match(body, /inFlightSaveRef\.current = savePromise/)
    assert.match(body, /const outcome = await savePromise/)
    assert.match(body, /inFlightSaveRef\.current = null/)
  })
})

describe('useAutosave.ts — edits during an in-flight save trigger a follow-up, never a stale "saved"', () => {
  test('after a successful save, if the live data no longer matches what was just persisted, a follow-up autosave is scheduled', () => {
    const performSaveMatch = hookSrc.match(/async function performSave\([\s\S]*?\n  \}/)
    assert.ok(performSaveMatch)
    assert.match(
      performSaveMatch[0],
      /if \(outcome === 'success' && !lockedRef\.current && !isEqual\(dataRef\.current, lastSavedRef\.current\)\) \{\s*\n\s*void performSave\('autosave'\)/,
    )
  })

  test('the "saved" status is only set when the just-persisted snapshot still matches the live data (stillCurrent) — never claims newer, unsaved content is saved', () => {
    assert.match(hookSrc, /const stillCurrent = isEqual\(dataToSave, dataRef\.current\)/)
    assert.match(hookSrc, /setStatus\(stillCurrent \? 'saved' : 'idle'\)/)
  })

  test('the value actually sent to save() is read from dataRef.current at call time, not a value captured in an old render/closure — so a timer scheduled minutes earlier still saves the LATEST content when it fires', () => {
    assert.match(hookSrc, /const dataToSave = dataRef\.current/)
    assert.match(hookSrc, /dataRef\.current = data/)
  })
})

describe('useAutosave.ts — autosave never calls onSubmit; it only ever calls the injected save()', () => {
  test('performSave has exactly one call into the injected save() — every trigger (autosave/manual/back) funnels through the same single call site, never a distinct submit-shaped call', () => {
    const performSaveMatch = hookSrc.match(/async function performSave\([\s\S]*?\n  \}/)
    assert.ok(performSaveMatch)
    const saveCalls = performSaveMatch[0].match(/\bsave\(dataToSave, trigger\)/g) ?? []
    assert.equal(saveCalls.length, 1)
  })

  test('cancelPendingAndAwaitInFlight — the coordination primitive a caller like Submit uses to avoid racing this hook — never calls save() itself, only cancels timers and awaits whatever is already in flight', () => {
    const fnMatch = hookSrc.match(/async function cancelPendingAndAwaitInFlight\(\): Promise<void> \{[\s\S]*?\n  \}/)
    assert.ok(fnMatch, 'could not locate cancelPendingAndAwaitInFlight')
    assert.equal(fnMatch[0].includes('save('), false)
    assert.match(fnMatch[0], /await inFlightSaveRef\.current\.catch\(\(\) => \{\}\)/)
  })
})

describe('useAutosave.ts — a locked error stops all further autosave attempts for the rest of this session', () => {
  test('isLockedError(err) sets lockedRef permanently and reports a distinct "locked" status/outcome', () => {
    assert.match(hookSrc, /if \(isLockedError\(err\)\) \{\s*\n\s*lockedRef\.current = true/)
    assert.match(hookSrc, /if \(trigger === 'autosave'\) setStatus\('locked'\)/)
  })

  test('performSave and the scheduling effect both bail out immediately once lockedRef is true', () => {
    const performSaveMatch = hookSrc.match(/async function performSave\([\s\S]*?\n  \}/)
    assert.ok(performSaveMatch)
    assert.match(performSaveMatch[0], /if \(lockedRef\.current\) return 'locked'/)
    const effectMatch = hookSrc.match(/useEffect\(\(\) => \{[\s\S]*?\}, \[data\]\)/)
    assert.ok(effectMatch)
    assert.match(effectMatch[0], /if \(lockedRef\.current\) return/)
  })

  test('there is no code path that ever resets lockedRef back to false — a lock is a one-way, session-lifetime stop', () => {
    assert.equal(hookSrc.includes('lockedRef.current = false'), false)
  })
})

describe('useAutosave.ts — ordinary failure leaves content intact and allows a later retry', () => {
  test('a non-locked error only sets an "error" status for the autosave trigger and returns — it never clears lastSavedRef, never touches the live data, and does not set lockedRef', () => {
    const catchMatch = hookSrc.match(/\} catch \(err\) \{([\s\S]*?)\n {6}\}/)
    assert.ok(catchMatch, 'could not locate the performSave catch block')
    const body = catchMatch[1]
    assert.match(body, /if \(trigger === 'autosave'\) setStatus\('error'\)/)
    assert.equal(body.includes('lastSavedRef.current ='), false, 'a failed save must not update the last-saved snapshot')
  })

  test('the scheduling effect re-arms on the very next data change regardless of a prior error — no permanent flag blocks retrying after an ordinary failure', () => {
    // Only lockedRef (set exclusively inside the isLockedError branch, which
    // returns early) can permanently stop scheduling. The ordinary-error
    // fallthrough — the code after that branch's own closing brace, up to
    // the ordinary `return 'error'` — never touches lockedRef, so the next
    // [data] effect run schedules normally.
    const performSaveMatch = hookSrc.match(/async function performSave\([\s\S]*?\n  \}/)
    assert.ok(performSaveMatch)
    const lockedBranchMatch = performSaveMatch[0].match(/if \(isLockedError\(err\)\) \{[\s\S]*?\n\s*\}/)
    assert.ok(lockedBranchMatch, 'could not locate the isLockedError branch')
    const afterLockedBranch = performSaveMatch[0].slice(performSaveMatch[0].indexOf(lockedBranchMatch[0]) + lockedBranchMatch[0].length)
    const ordinaryFallthrough = afterLockedBranch.slice(0, afterLockedBranch.indexOf("return 'error'") + "return 'error'".length)
    assert.equal(ordinaryFallthrough.includes('lockedRef.current = true'), false)
    assert.match(ordinaryFallthrough, /setStatus\('error'\)/)
  })

  // Bug this covers: both timers are already cleared (lines earlier in
  // performSave, before the save() call even starts), and the [data]
  // scheduling effect only re-arms when `data` itself changes again. Without
  // an explicit retry, a save that fails with no further edits afterward
  // (the manager doesn't type anything else) would sit unsaved forever —
  // including a failed MANUAL save, which shows "Draft saved"/"Changes
  // saved" optimistically and so gives the manager no reason to retry
  // themselves. Confirmed as a real gap, not a guess, by reading performSave
  // top-to-bottom: nothing else re-arms a timer for an unchanged `data`.
  test('an ordinary (non-locked) failure schedules exactly one bounded retry via the debounce timer, so content is never silently stuck unsaved when nothing else changes again', () => {
    const performSaveMatch = hookSrc.match(/async function performSave\([\s\S]*?\n  \}/)
    assert.ok(performSaveMatch)
    const catchMatch = performSaveMatch[0].match(/\} catch \(err\) \{([\s\S]*?)\n {6}\}/)
    assert.ok(catchMatch, 'could not locate the performSave catch block')
    const ordinaryBody = catchMatch[1]
    assert.match(
      ordinaryBody,
      /if \(!debounceTimerRef\.current\) \{\s*\n\s*debounceTimerRef\.current = setTimeout\(\(\) => \{\s*\n\s*debounceTimerRef\.current = null\s*\n\s*void performSave\('autosave'\)\s*\n\s*\}, debounceMs\)\s*\n\s*\}/,
    )
  })

  test('the retry-on-failure guard (!debounceTimerRef.current) prevents stacking a second retry timer on top of one already scheduled', () => {
    const performSaveMatch = hookSrc.match(/async function performSave\([\s\S]*?\n  \}/)
    assert.ok(performSaveMatch)
    const catchMatch = performSaveMatch[0].match(/\} catch \(err\) \{([\s\S]*?)\n {6}\}/)
    assert.ok(catchMatch)
    assert.match(catchMatch[1], /if \(!debounceTimerRef\.current\) \{/)
  })
})

describe('useAutosave.ts — cancelPendingAndAwaitInFlight: coordinating with an external write (e.g. Submit) so it never races this hook\'s own save()', () => {
  test('is exposed from the hook\'s return value alongside status/saveNow/notifyEditStarted', () => {
    assert.match(hookSrc, /return \{\s*\n\s*status,\s*\n\s*saveNow: \(trigger\) => performSave\(trigger\),\s*\n\s*notifyEditStarted,\s*\n\s*cancelPendingAndAwaitInFlight,\s*\n\s*\}/)
  })

  test('cancels both the debounce and max-wait timers and ends the current dirty period, without starting any new save', () => {
    const fnMatch = hookSrc.match(/async function cancelPendingAndAwaitInFlight\(\): Promise<void> \{[\s\S]*?\n  \}/)
    assert.ok(fnMatch)
    const body = fnMatch[0]
    assert.match(body, /if \(debounceTimerRef\.current\) \{\s*\n\s*clearTimeout\(debounceTimerRef\.current\)\s*\n\s*debounceTimerRef\.current = null\s*\n\s*\}/)
    assert.match(body, /if \(maxWaitTimerRef\.current\) \{\s*\n\s*clearTimeout\(maxWaitTimerRef\.current\)\s*\n\s*maxWaitTimerRef\.current = null\s*\n\s*\}/)
    assert.match(body, /dirtyPeriodActiveRef\.current = false/)
  })

  test('awaits any save already in flight (never starting a new one), so the caller\'s own write is guaranteed to begin only after a prior autosave write has fully landed', () => {
    const fnMatch = hookSrc.match(/async function cancelPendingAndAwaitInFlight\(\): Promise<void> \{[\s\S]*?\n  \}/)
    assert.ok(fnMatch)
    assert.match(fnMatch[0], /if \(inFlightSaveRef\.current\) \{\s*\n\s*await inFlightSaveRef\.current\.catch\(\(\) => \{\}\)\s*\n\s*\}/)
  })
})

describe('useAutosave.ts — status transitions on new edits (clears stale saved/error, not saving/locked)', () => {
  test('notifyEditStarted clears a stale "saved" or "error" back to idle, but leaves "saving" and "locked" alone', () => {
    assert.match(
      hookSrc,
      /function notifyEditStarted\(\) \{\s*\n\s*setStatus\(\(prev\) => \(prev === 'saved' \|\| prev === 'error' \? 'idle' : prev\)\)/,
    )
  })
})

describe('ReportForm.tsx — wires useAutosave through the SAME persistence path as the manual buttons', () => {
  test('imports useAutosave, areReportSectionsEqual, and ManagerEditLockedError', () => {
    assert.match(reportFormSrc, /import \{ useAutosave \} from '\.\.\/hooks\/useAutosave'/)
    assert.match(reportFormSrc, /areReportSectionsEqual/)
    assert.match(reportFormSrc, /import \{ ManagerEditLockedError \} from '\.\.\/lib\/reportsService'/)
  })

  test('the autosave save() callback calls onSaveDraft/onSaveChanges — never a second write implementation, never onSubmit', () => {
    const autosaveMatch = reportFormSrc.match(/const autosave = useAutosave<ManagerReportSectionsV2>\(\{[\s\S]*?\n  \}\)/)
    assert.ok(autosaveMatch, 'could not locate the useAutosave call')
    const body = autosaveMatch[0]
    assert.match(body, /isEqual: areReportSectionsEqual/)
    assert.match(body, /isLockedError: \(err\) => err instanceof ManagerEditLockedError/)
    assert.match(body, /await onSaveChanges\?\.\(toSave, \{ navigateToDashboard: trigger === 'manual' \}\)/)
    assert.match(body, /await onSaveDraft\(toSave\)/)
    assert.equal(body.includes('onSubmit'), false, 'autosave must never reference onSubmit')
  })

  test('typing (clearFeedback) notifies the autosave hook so a stale Saved/error indicator clears on the next edit', () => {
    const clearFeedbackMatch = reportFormSrc.match(/const clearFeedback = \(\) => \{[\s\S]*?\n  \}/)
    assert.ok(clearFeedbackMatch)
    assert.match(clearFeedbackMatch[0], /autosave\.notifyEditStarted\(\)/)
  })
})

describe('ReportForm.tsx — manual Save Draft / Save Changes still save immediately and now cancel/absorb pending autosave timers', () => {
  test('handleSave and handleSaveChanges both show their existing confirmation immediately (unchanged) and route the actual persistence through autosave.saveNow(\'manual\')', () => {
    const handleSaveMatch = reportFormSrc.match(/const handleSave = \(\) => \{[\s\S]*?\n  \}/)
    assert.ok(handleSaveMatch)
    assert.match(handleSaveMatch[0], /setSavedMessage\(true\)/)
    assert.match(handleSaveMatch[0], /void autosave\.saveNow\('manual'\)/)

    const handleSaveChangesMatch = reportFormSrc.match(/const handleSaveChanges = \(\) => \{[\s\S]*?\n  \}/)
    assert.ok(handleSaveChangesMatch)
    assert.match(handleSaveChangesMatch[0], /setSavedMessage\(true\)/)
    assert.match(handleSaveChangesMatch[0], /void autosave\.saveNow\('manual'\)/)
  })

  test('a manual save routes through the SAME single-flight performSave as autosave (inside useAutosave.ts) — verified structurally: saveNow simply calls performSave with the given trigger', () => {
    assert.match(hookSrc, /saveNow: \(trigger\) => performSave\(trigger\)/)
  })
})

describe('ReportForm.tsx — Back to Dashboard: dirty saves-then-navigates, clean navigates immediately, failure stays on the form', () => {
  test('the back link is wired to handleBackClick, not a raw onBack call', () => {
    assert.match(reportFormSrc, /<button className="link-btn back-link" onClick=\{handleBackClick\}>/)
    assert.equal(/onClick=\{onBack\}/.test(reportFormSrc), false, 'onBack must no longer be called directly from the back link — it must go through the dirty-check-then-save handler')
  })

  test('handleBackClick awaits autosave.saveNow(\'back\') and navigates (onBack()) only on a \'success\' outcome', () => {
    const handleBackClickMatch = reportFormSrc.match(/const handleBackClick = async \(\) => \{[\s\S]*?\n  \}/)
    assert.ok(handleBackClickMatch, 'could not locate handleBackClick')
    const body = handleBackClickMatch[0]
    assert.match(body, /const outcome = await autosave\.saveNow\('back'\)/)
    assert.match(body, /if \(outcome === 'success'\) \{\s*\n\s*onBack\(\)\s*\n\s*\}/)
  })

  test('when nothing is dirty, saveNow(\'back\') resolves to \'success\' WITHOUT calling save() at all (per the hook\'s own dirty short-circuit), so the clean case never invokes onSaveDraft/onSaveChanges before navigating', () => {
    // This is the hook's own short-circuit (already verified above); this
    // test documents that ReportForm relies on exactly that behavior rather
    // than duplicating a dirty-check of its own before calling saveNow.
    assert.equal(/lastSavedRef|isDirty/.test(reportFormSrc), false, 'ReportForm must not re-implement its own dirty tracking — it must rely solely on the shared useAutosave hook')
  })

  test('on a locked or ordinary error outcome, handleBackClick does not navigate — the manager stays on the form with the existing lock/error messaging (lockMessage prop) still visible', () => {
    const handleBackClickMatch = reportFormSrc.match(/const handleBackClick = async \(\) => \{[\s\S]*?\n  \}/)
    assert.ok(handleBackClickMatch)
    // Only one call to onBack() inside this handler, gated by the success check above.
    const onBackCalls = handleBackClickMatch[0].match(/onBack\(\)/g) ?? []
    assert.equal(onBackCalls.length, 1)
  })
})

// Bug this covers: a background autosave draft write and the final Submit
// write both target the same report row (manager_id + week_start_date) via
// saveReportV2, with no coordination between them otherwise. Before this
// fix, handleSubmitClick called onSubmit(data) directly, bypassing
// useAutosave's single-flight queue entirely — the ONE write path in this
// component that did. An autosave debounce/max-wait timer firing at the
// same moment a manager clicks Submit could send a concurrent 'draft'
// upsert alongside the 'submitted' upsert; whichever write lands last at
// the database wins, with a real (if narrow) chance the draft write lands
// after the submit write and silently reverts status back to 'draft' even
// though the UI already shows "Submitted".
describe('ReportForm.tsx — Submit never races a background autosave write to the same report row', () => {
  test('handleSubmitClick awaits autosave.cancelPendingAndAwaitInFlight() before calling onSubmit, so any autosave write already in flight (or about to fire from an armed timer) fully lands first', () => {
    const handleSubmitClickMatch = reportFormSrc.match(/const handleSubmitClick = async \(\) => \{[\s\S]*?\n  \}/)
    assert.ok(handleSubmitClickMatch, 'could not locate handleSubmitClick')
    const body = handleSubmitClickMatch[0]
    const cancelIndex = body.indexOf('await autosave.cancelPendingAndAwaitInFlight()')
    const onSubmitIndex = body.indexOf('onSubmit(data)')
    assert.ok(cancelIndex !== -1 && onSubmitIndex !== -1)
    assert.ok(cancelIndex < onSubmitIndex, 'the autosave coordination wait must happen before onSubmit is ever called')
  })

  test('a local re-entrancy guard (submitClickInFlightRef) blocks a second click during the async gap before isSubmitting has re-rendered as true', () => {
    assert.match(reportFormSrc, /const submitClickInFlightRef = useRef\(false\)/)
    const handleSubmitClickMatch = reportFormSrc.match(/const handleSubmitClick = async \(\) => \{[\s\S]*?\n  \}/)
    assert.ok(handleSubmitClickMatch)
    const body = handleSubmitClickMatch[0]
    assert.match(body, /if \(isSubmitting \|\| submitClickInFlightRef\.current\) return/)
    assert.match(body, /submitClickInFlightRef\.current = true/)
    assert.match(body, /finally \{\s*\n\s*submitClickInFlightRef\.current = false\s*\n\s*\}/)
  })

  test('the validation short-circuit (2-3 "What Matters Now" items) still runs before the guard is set and before any autosave coordination — an invalid submit never touches the autosave queue', () => {
    const handleSubmitClickMatch = reportFormSrc.match(/const handleSubmitClick = async \(\) => \{[\s\S]*?\n  \}/)
    assert.ok(handleSubmitClickMatch)
    const body = handleSubmitClickMatch[0]
    const validationIndex = body.indexOf('isWhatMattersNowValidForSubmit(data.whatMattersNow)')
    const guardSetIndex = body.indexOf('submitClickInFlightRef.current = true')
    assert.ok(validationIndex !== -1 && guardSetIndex !== -1)
    assert.ok(validationIndex < guardSetIndex)
  })
})

describe('ReportForm.tsx — subtle autosave status UI, distinct from the loud manual confirmation', () => {
  test('renders Saving…/Saved/failure text keyed off autosave.status, suppressed while the manual savedMessage is showing', () => {
    assert.match(reportFormSrc, /\{!savedMessage && autosave\.status === 'saving' && <span className="autosave-status">Saving&hellip;<\/span>\}/)
    assert.match(reportFormSrc, /\{!savedMessage && autosave\.status === 'saved' && <span className="autosave-status autosave-status-saved">Saved<\/span>\}/)
    assert.match(reportFormSrc, /Couldn&apos;t save automatically — your changes are still here\./)
  })

  test('no separate/competing UI is rendered for the \'locked\' status — it relies on the existing lockMessage banner', () => {
    assert.equal(/autosave\.status === 'locked'/.test(reportFormSrc), false)
  })
})

describe('App.tsx — handleSaveDraft/handleSaveChanges are awaitable, re-throw on failure, and preserve existing behavior', () => {
  test('handleSaveDraft is async, preserves the optimistic setReportData/setStatus/setLegacyReference ordering before the network call, and re-throws after setting lockMessage on a lock', () => {
    const match = appSrc.match(/const handleSaveDraft = async \(data: ManagerReportSectionsV2\): Promise<void> => \{[\s\S]*?\n  \}/)
    assert.ok(match, 'could not locate handleSaveDraft')
    const body = match[0]
    const setReportDataIndex = body.indexOf('setReportData(data)')
    const setStatusIndex = body.indexOf("setStatus('draft')")
    const saveCallIndex = body.indexOf('await saveReportV2(')
    assert.ok(setReportDataIndex !== -1 && setStatusIndex !== -1 && saveCallIndex !== -1)
    assert.ok(setReportDataIndex < saveCallIndex && setStatusIndex < saveCallIndex, 'optimistic update must still happen before the network call')
    assert.match(body, /if \(err instanceof ManagerEditLockedError\) setLockMessage\(err\.message\)\s*\n\s*throw err/)
  })

  test('handleSaveDraft throws ManagerEditLockedError (not a silent return) when checkManagerWriteLock reports locked, before any optimistic state update', () => {
    const match = appSrc.match(/const handleSaveDraft = async \(data: ManagerReportSectionsV2\): Promise<void> => \{([\s\S]*?)\n  \}/)
    assert.ok(match)
    const body = match[1]
    const lockCheckIndex = body.indexOf('if (checkManagerWriteLock(isNewReport))')
    const throwIndex = body.indexOf('throw new ManagerEditLockedError')
    const setReportDataIndex = body.indexOf('setReportData(data)')
    assert.ok(lockCheckIndex !== -1 && throwIndex !== -1 && setReportDataIndex !== -1)
    assert.ok(lockCheckIndex < throwIndex && throwIndex < setReportDataIndex)
  })

  test('handleSaveDraft still reconciles against saveReportV2\'s returned status (resolveSaveStatus\'s content-only/submitted-in-background case) — no second reconciliation implementation', () => {
    assert.match(appSrc, /const persistedStatus = await saveReportV2\(managerId, week\.weekStartDate, data, 'draft', isNewReport\)/)
    assert.match(appSrc, /if \(persistedStatus !== 'draft'\) setStatus\(persistedStatus\)/)
  })

  test('handleSaveChanges accepts an optional { navigateToDashboard } option defaulting to true, so any existing/omitted caller keeps navigating exactly as before', () => {
    const match = appSrc.match(/const handleSaveChanges = async \([\s\S]*?\): Promise<void> => \{[\s\S]*?\n  \}/)
    assert.ok(match, 'could not locate handleSaveChanges')
    const body = match[0]
    assert.match(body, /options: \{ navigateToDashboard\?: boolean \} = \{\}/)
    assert.match(body, /const \{ navigateToDashboard = true \} = options/)
    assert.match(body, /if \(navigateToDashboard\) setView\('dashboard'\)/)
  })

  test('handleSaveChanges re-throws ManagerEditLockedError (after setting lockMessage) and re-throws ordinary errors too, so a caller can await/react', () => {
    const match = appSrc.match(/const handleSaveChanges = async \([\s\S]*?\): Promise<void> => \{[\s\S]*?\n  \}/)
    assert.ok(match)
    assert.match(match[0], /if \(err instanceof ManagerEditLockedError\) setLockMessage\(err\.message\)\s*\n\s*throw err/)
  })

  test('the two <ReportForm> render sites still pass handleSaveDraft/handleSaveChanges by reference, unchanged — no new wiring needed at the call sites themselves', () => {
    assert.match(appSrc, /onSaveDraft=\{handleSaveDraft\}/)
    assert.match(appSrc, /onSaveChanges=\{handleSaveChanges\}/)
  })

  test('handleSubmit (Submit) is completely untouched by this feature — autosave must never be able to submit a report', () => {
    assert.match(appSrc, /const handleSubmit = async \(data: ManagerReportSectionsV2\) => \{/)
  })
})

import { useEffect, useRef, useState } from 'react'

// Dependency-free debounce-with-max-wait autosave, generic over any data
// shape T. Domain-agnostic on purpose (no import of any report/Supabase
// type) so it stays trivially wiring-testable and reusable: the caller
// supplies its own equality check, its own save function, and (optionally)
// a predicate to recognize its own "hard stop" error type.
//
// Timing contract:
// - `debounceMs` (default 3000): a trailing debounce that resets on every
//   change while the data stays dirty (differs from the last successfully
//   saved snapshot).
// - `maxWaitMs` (default 30000): measured from the START of the current
//   continuous dirty period, not reset on every change — only a successful
//   save (which ends that dirty period) lets the next change start a fresh
//   window.
//
// Concurrency contract: only one call into `save` is ever in flight at a
// time, for ANY trigger (autosave, or a manual saveNow('manual'/'back')).
// A second attempt while one is in flight simply awaits the first, then
// re-checks whether there's still something new to persist. A save is
// never allowed to mark data "saved" if that data is no longer what's
// currently on screen — if it changed mid-save, a follow-up save is
// scheduled automatically once the in-flight one resolves.
export type AutosaveStatus = 'idle' | 'saving' | 'saved' | 'error' | 'locked'
export type AutosaveTrigger = 'autosave' | 'manual' | 'back'
export type AutosaveOutcome = 'success' | 'locked' | 'error'

interface UseAutosaveOptions<T> {
  data: T
  isEqual: (a: T, b: T) => boolean
  save: (data: T, trigger: AutosaveTrigger) => Promise<void>
  isLockedError?: (err: unknown) => boolean
  debounceMs?: number
  maxWaitMs?: number
}

interface UseAutosaveResult {
  status: AutosaveStatus
  // For manual save-button clicks and the "leaving the form" dirty-check —
  // never call this with 'autosave' from outside the hook.
  saveNow: (trigger: 'manual' | 'back') => Promise<AutosaveOutcome>
  // Call when the manager resumes typing, to clear a stale 'saved'/'error'
  // indicator left over from before this new edit.
  notifyEditStarted: () => void
  // For a caller that persists through a completely separate path outside
  // this hook (e.g. a final Submit) and must never race this hook's own
  // save() calls to the same underlying record: cancels any pending
  // debounce/max-wait timer (so one can't fire mid-submit) and, if a save
  // is already in flight, awaits it so it fully lands before the caller's
  // own write begins. Never starts a new save itself, never throws, and
  // ignores the outcome of whatever it waited on — the caller is expected
  // to do its own fresh authorization/lock check regardless.
  cancelPendingAndAwaitInFlight: () => Promise<void>
}

export function useAutosave<T>({
  data,
  isEqual,
  save,
  isLockedError = () => false,
  debounceMs = 3000,
  maxWaitMs = 30000,
}: UseAutosaveOptions<T>): UseAutosaveResult {
  const [status, setStatus] = useState<AutosaveStatus>('idle')

  // Always holds the latest `data`, so callbacks scheduled by a past
  // render's setTimeout (which would otherwise close over stale data) can
  // read the current value at the moment they actually run.
  const dataRef = useRef(data)
  dataRef.current = data

  const lastSavedRef = useRef(data)
  const lockedRef = useRef(false)
  const inFlightSaveRef = useRef<Promise<AutosaveOutcome> | null>(null)
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const maxWaitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const dirtyPeriodActiveRef = useRef(false)

  async function performSave(trigger: AutosaveTrigger): Promise<AutosaveOutcome> {
    // Never run two saves concurrently — queue behind whatever is already
    // in flight (from any trigger) and re-evaluate once it's done.
    if (inFlightSaveRef.current) {
      await inFlightSaveRef.current.catch(() => {})
    }

    if (lockedRef.current) return 'locked'

    const dataToSave = dataRef.current
    if (isEqual(dataToSave, lastSavedRef.current)) {
      // Already covered by the save just waited on (or nothing changed).
      return 'success'
    }

    // This save is about to cover whatever is current right now — any
    // pending timers for it are now redundant, and the dirty period ends
    // here (a fresh one starts only if the data changes again later).
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current)
      debounceTimerRef.current = null
    }
    if (maxWaitTimerRef.current) {
      clearTimeout(maxWaitTimerRef.current)
      maxWaitTimerRef.current = null
    }
    dirtyPeriodActiveRef.current = false

    const savePromise = (async (): Promise<AutosaveOutcome> => {
      if (trigger === 'autosave') setStatus('saving')
      try {
        await save(dataToSave, trigger)
        lastSavedRef.current = dataToSave
        // Only claim "Saved" if the content just persisted still matches
        // what's on screen — if the manager kept typing during the save,
        // this result is already stale for display purposes (the follow-up
        // save below will cover the newer content).
        const stillCurrent = isEqual(dataToSave, dataRef.current)
        if (trigger === 'autosave') setStatus(stillCurrent ? 'saved' : 'idle')
        return 'success'
      } catch (err) {
        if (isLockedError(err)) {
          lockedRef.current = true
          if (trigger === 'autosave') setStatus('locked')
          return 'locked'
        }
        if (trigger === 'autosave') setStatus('error')
        // The content is still dirty (lastSavedRef was never updated above),
        // but both timers were already cleared before this attempt started,
        // and the [data] scheduling effect only re-arms on a NEW change —
        // it will never fire again for this same, already-failed value. So
        // this content would otherwise sit unsaved indefinitely unless the
        // manager happens to type something else. Schedule one bounded
        // retry here directly so autosave's own safety net holds even after
        // an ordinary failure with no further edits — this also covers a
        // failed MANUAL save, which shows its own success message
        // optimistically and has no other retry path of its own.
        if (!debounceTimerRef.current) {
          debounceTimerRef.current = setTimeout(() => {
            debounceTimerRef.current = null
            void performSave('autosave')
          }, debounceMs)
        }
        return 'error'
      }
    })()

    inFlightSaveRef.current = savePromise
    const outcome = await savePromise
    inFlightSaveRef.current = null

    if (outcome === 'success' && !lockedRef.current && !isEqual(dataRef.current, lastSavedRef.current)) {
      void performSave('autosave')
    }

    return outcome
  }

  // Schedules the debounce/max-wait timers on every genuine data change.
  useEffect(() => {
    if (lockedRef.current) return

    if (isEqual(data, lastSavedRef.current)) {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current)
        debounceTimerRef.current = null
      }
      if (maxWaitTimerRef.current) {
        clearTimeout(maxWaitTimerRef.current)
        maxWaitTimerRef.current = null
      }
      dirtyPeriodActiveRef.current = false
      return
    }

    // Trailing debounce: reset on every change while dirty.
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current)
    debounceTimerRef.current = setTimeout(() => {
      debounceTimerRef.current = null
      void performSave('autosave')
    }, debounceMs)

    // Max-wait: started ONCE per continuous dirty period — deliberately
    // NOT reset on every keystroke, only by a successful save ending the
    // period (handled inside performSave above).
    if (!dirtyPeriodActiveRef.current) {
      dirtyPeriodActiveRef.current = true
      maxWaitTimerRef.current = setTimeout(() => {
        maxWaitTimerRef.current = null
        void performSave('autosave')
      }, maxWaitMs)
    }
    // performSave/save/isEqual are stable enough for this hook's purposes
    // (the caller is expected to pass a stable save/isEqual reference or
    // accept re-scheduling on identity change); only `data` should drive
    // this effect's re-run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data])

  // True-unmount-only cleanup, so a torn-down form never leaves a dangling
  // timer behind.
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current)
      if (maxWaitTimerRef.current) clearTimeout(maxWaitTimerRef.current)
    }
  }, [])

  function notifyEditStarted() {
    setStatus((prev) => (prev === 'saved' || prev === 'error' ? 'idle' : prev))
  }

  async function cancelPendingAndAwaitInFlight(): Promise<void> {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current)
      debounceTimerRef.current = null
    }
    if (maxWaitTimerRef.current) {
      clearTimeout(maxWaitTimerRef.current)
      maxWaitTimerRef.current = null
    }
    dirtyPeriodActiveRef.current = false
    if (inFlightSaveRef.current) {
      await inFlightSaveRef.current.catch(() => {})
    }
  }

  return {
    status,
    saveNow: (trigger) => performSave(trigger),
    notifyEditStarted,
    cancelPendingAndAwaitInFlight,
  }
}

import { useEffect, useRef } from 'react'

// Dependency-free vertical auto-grow for a controlled <textarea>: expands
// the element to fit its current content, using the standard
// scrollHeight technique (no new library, no CSS feature with inconsistent
// browser support). Only ever sets `height` — never `width` — so this can
// never affect horizontal layout.
//
// Runs on every change to `value`. This is only ever used with a fully
// controlled textarea (value + onChange), so a value change happens on
// exactly every keystroke and paste — no separate onInput handler needed,
// and no risk of resizing based on stale content.
export function useAutoGrowTextarea(value: string) {
  const ref = useRef<HTMLTextAreaElement | null>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [value])

  return ref
}

import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import './PrintReportMenu.css'

export interface PrintReportMenuOption {
  label: string
  onSelect: () => void
}

interface PrintReportMenuProps {
  label: string
  options: PrintReportMenuOption[]
}

// A small, dependency-free dropdown button — built for exactly one job
// (Weekly Summary's "Print Summary" / "Print Consolidated Report" choice)
// rather than pulling in a menu/dropdown library for two static options.
// Closes on: selecting an option, Escape, or a click outside; reopening
// always refocuses the first item (role="menu"/"menuitem", arrow-key
// navigation, focus returns to the trigger button on close). The trigger
// itself carries .no-print — like every other action button in this app,
// it never appears in any print output, including the very modes it
// triggers.
export default function PrintReportMenu({ label, options }: PrintReportMenuProps) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([])

  useEffect(() => {
    if (!open) return

    const handlePointerDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handlePointerDown)
    return () => document.removeEventListener('mousedown', handlePointerDown)
  }, [open])

  useEffect(() => {
    if (open) itemRefs.current[0]?.focus()
  }, [open])

  const closeAndRefocusTrigger = () => {
    setOpen(false)
    buttonRef.current?.focus()
  }

  const handleTriggerKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      setOpen(true)
    }
  }

  const handleItemKeyDown = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      const next = (index + 1) % options.length
      itemRefs.current[next]?.focus()
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      const prev = (index - 1 + options.length) % options.length
      itemRefs.current[prev]?.focus()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      closeAndRefocusTrigger()
    } else if (e.key === 'Tab') {
      setOpen(false)
    }
  }

  const handleSelect = (option: PrintReportMenuOption) => {
    closeAndRefocusTrigger()
    option.onSelect()
  }

  return (
    <div className="print-report-menu no-print" ref={containerRef}>
      <button
        type="button"
        className="btn btn-primary print-report-menu-trigger"
        onClick={() => setOpen((o) => !o)}
        onKeyDown={handleTriggerKeyDown}
        aria-haspopup="menu"
        aria-expanded={open}
        ref={buttonRef}
      >
        {label}
        <span aria-hidden="true" className="print-report-menu-caret">
          ▾
        </span>
      </button>
      {open && (
        <div className="print-report-menu-list" role="menu">
          {options.map((option, index) => (
            <button
              key={option.label}
              type="button"
              role="menuitem"
              className="print-report-menu-item"
              ref={(el) => {
                itemRefs.current[index] = el
              }}
              onClick={() => handleSelect(option)}
              onKeyDown={(e) => handleItemKeyDown(e, index)}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

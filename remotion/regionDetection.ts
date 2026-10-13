import { AMBIGUOUS_STATE_ABBREVIATIONS, US_STATES, type UsStateEntry } from './usStates.ts'
import type { VideoStoryboardScene } from '../src/lib/videoStoryboard.ts'

// Pure, whitelist-based region detection — the ONLY thing the cinematic
// director's REGIONAL_MAP treatment is allowed to rely on. This NEVER
// infers a location: it only recognizes a full state name, or an
// unambiguous 2-letter abbreviation, that is ALREADY LITERALLY PRESENT in
// the scene's own already-grounded on-screen fields (title/body/bullets/
// next — never narrationText, never metrics). Scanning metrics is
// deliberately excluded: a metric LABEL's 2-letter prefix (e.g. "FL Agency
// Net Remittance") is exactly the kind of low-context abbreviation this
// function should not gamble on; a genuine regional story almost always
// also names the region in its title/body/bullets/next, which this DOES
// scan.
export interface DetectedRegion {
  name: string
  abbreviation: string
  x: number
  y: number
}

function wordBoundaryMatch(haystack: string, needle: string): boolean {
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`\\b${escaped}\\b`, 'i').test(haystack)
}

export function detectGroundedRegion(scene: Pick<VideoStoryboardScene, 'title' | 'body' | 'bullets' | 'next'>): DetectedRegion | undefined {
  const haystack = [scene.title, scene.body ?? '', ...(scene.bullets ?? []), scene.next ?? ''].join(' \n ')
  if (!haystack.trim()) return undefined

  const match = (entry: UsStateEntry): boolean => {
    if (wordBoundaryMatch(haystack, entry.name)) return true
    if (AMBIGUOUS_STATE_ABBREVIATIONS.has(entry.abbreviation)) return false
    // An abbreviation is only trusted when written in the conventional
    // ALL-CAPS form (e.g. "NC", "TN") — never case-insensitively, which is
    // exactly what would make it collide with an ordinary word.
    return new RegExp(`\\b${entry.abbreviation}\\b`).test(haystack)
  }

  const found = US_STATES.find(match)
  return found ? { name: found.name, abbreviation: found.abbreviation, x: found.x, y: found.y } : undefined
}

import { parseDateOnly } from '../utils/week.ts'

// THE WFG WEEKLY LEADERSHIP UPDATE FORM — the editable Leadership Report's
// content shape, rebuilt to follow the supplied Word document
// ("WFG_Weekly_Leadership_Update 10 02 26.docx") exactly in wording,
// structure, and ordering, rather than reusing the generic AtsReport shape
// (openingParagraph + topics) the ATS/"Present Week Summary" report uses.
//
// PERMANENT TEMPLATE WORDING vs. EDITABLE CONTENT: every constant exported
// below (TITLE, TAGLINE, section headings, helper questions, supporting
// labels, bottom guidance) is permanent form copy, verbatim from the source
// document — it is rendered by the form/view components but is never part
// of LeadershipReportContent and never sent to/from Supabase. Only the
// fields on LeadershipReportContent are what a leader actually edits each
// week.
//
// Each of the four bullet sections below mirrors the document's own
// "Bold Label: rest of sentence" bullet convention as a single plain
// string per item (e.g. "Net Premiums: September MTD net premiums
// exceeded prior MTD by 8%") — rendering bolds everything before the
// first ": " (see boldLeadInLabel below). This avoids inventing a
// separate label/text split the source document doesn't actually need as
// distinct editable fields, while still visually matching the document.

export const LEADERSHIP_REPORT_TITLE = 'WFG WEEKLY LEADERSHIP UPDATE'
export const LEADERSHIP_REPORT_TAGLINE = 'Exception-based  |  Forward-looking  |  Focused on material impact'

export const LEADERSHIP_REPORT_SECTION_LABELS = {
  lookingAroundTheCorner: {
    heading: 'LOOKING AROUND THE CORNER',
    helperQuestion: 'What do you see developing over the next four weeks that could create an opportunity, risk, decision, or need for action?',
    supportingLabel: 'Next 4 weeks',
  },
  nextWeekPriorities: {
    heading: 'NEXT WEEK - HIGH-IMPACT PRIORITIES',
    helperQuestion: 'What actions will your team drive that will materially advance WFG or an important business outcome?',
    supportingLabel: 'Up to 3 priorities',
  },
  otherNotableItems: {
    heading: 'OTHER NOTABLE ITEMS',
    helperQuestion: 'Anything important that does not fit above but warrants attention.',
  },
  okrNotes: {
    heading: 'OKR NOTES / EXCEPTIONS - IF APPLICABLE',
    helperQuestion: 'Note only meaningful OKR movement, status changes, completions, or concerns. Leave blank if there is nothing material to report.',
  },
} as const

export const LEADERSHIP_REPORT_BOTTOM_GUIDANCE = {
  reportOnlyWhatMatters: {
    heading: 'REPORT ONLY WHAT MATTERS',
    items: ['Materially affect WFG', 'Create an opportunity', 'Address a risk', 'Require leadership attention', 'Signal what is around the corner'],
  },
  leadershipExpectations: {
    heading: 'Leadership expectations:',
    items: ['Be Decisive', 'Be Proactive', 'Be Engaged', 'Be Reliable', 'Be Prospective'],
  },
}

export interface LeadershipReportContent {
  leader: string
  weekEnding: string
  // The document's first content section — intentionally UNheaded (the
  // source form has no "01"/"Weekly Update" heading before it; it follows
  // directly after Leader/Week Ending).
  weeklyUpdateBullets: string[]
  lookingAroundTheCornerBullets: string[]
  nextWeekPrioritiesBullets: string[]
  otherNotableItemsBullets: string[]
  okrNotes: string
}

const CONTENT_KEYS: Array<keyof LeadershipReportContent> = [
  'leader',
  'weekEnding',
  'weeklyUpdateBullets',
  'lookingAroundTheCornerBullets',
  'nextWeekPrioritiesBullets',
  'otherNotableItemsBullets',
  'okrNotes',
]

const BULLET_KEYS: Array<keyof LeadershipReportContent> = [
  'weeklyUpdateBullets',
  'lookingAroundTheCornerBullets',
  'nextWeekPrioritiesBullets',
  'otherNotableItemsBullets',
]

// A runtime type guard, not just a TypeScript cast — distinguishes this
// new shape from the legacy AtsReport shape (openingParagraph/topics)
// that every Leadership Report draft saved before this change still uses.
// Historical rows are never rewritten to match this shape; callers use
// this guard to render a safe legacy fallback instead of crashing.
export function isLeadershipReportContent(value: unknown): value is LeadershipReportContent {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  if (!CONTENT_KEYS.every((key) => key in v)) return false
  if (typeof v.leader !== 'string' || typeof v.weekEnding !== 'string' || typeof v.okrNotes !== 'string') return false
  return BULLET_KEYS.every((key) => Array.isArray(v[key]) && (v[key] as unknown[]).every((item) => typeof item === 'string'))
}

export function blankLeadershipReportContent(leader: string, weekEnding: string): LeadershipReportContent {
  return {
    leader,
    weekEnding,
    weeklyUpdateBullets: [],
    lookingAroundTheCornerBullets: [],
    nextWeekPrioritiesBullets: [],
    otherNotableItemsBullets: [],
    okrNotes: '',
  }
}

// A genuine deep copy — a new bullets array per section, never a shared
// reference back to the source (the previous week's own saved draft, or
// another in-memory copy of it). Mirrors the same guarantee
// deepCopyAtsReport already provided for the old shape.
export function deepCopyLeadershipReportContent(content: LeadershipReportContent): LeadershipReportContent {
  return {
    leader: content.leader,
    weekEnding: content.weekEnding,
    weeklyUpdateBullets: [...content.weeklyUpdateBullets],
    lookingAroundTheCornerBullets: [...content.lookingAroundTheCornerBullets],
    nextWeekPrioritiesBullets: [...content.nextWeekPrioritiesBullets],
    otherNotableItemsBullets: [...content.otherNotableItemsBullets],
    okrNotes: content.okrNotes,
  }
}

// "October 02, 2026" — matches the source document's own Week Ending
// format exactly. Always derived from the viewed reporting week's own
// end date, never copied forward from a previous week (each week must
// show its own date even when the rest of its content is copy-forwarded
// from the prior week).
export function formatLeadershipReportWeekEnding(periodEndDate: string): string {
  return parseDateOnly(periodEndDate).toLocaleDateString('en-US', { month: 'long', day: '2-digit', year: 'numeric' })
}

// Splits a bullet's leading "Label:" off from the rest of the sentence for
// bold rendering — purely presentational, matches the source document's
// own bold-lead-in convention. Never used to parse/validate editable
// input; a bullet with no colon just renders as plain text.
export function splitBulletLeadIn(bullet: string): { label: string | null; rest: string } {
  const match = bullet.match(/^([^:]{1,80}):\s?(.*)$/s)
  if (!match) return { label: null, rest: bullet }
  return { label: match[1], rest: match[2] }
}

// The video-specific WFG visual system — deliberately its own, smaller
// token set rather than importing the portal's own CSS custom properties.
// The brief is explicit that video design should follow the reference
// video's editorial quality bar and does NOT need to look like the portal
// UI; the underlying color FAMILY is shared (see COLORS below, matching
// the portal's own :root tokens in src/index.css), but everything about
// how those colors are USED here — typography scale, spacing, motion — is
// its own system, tuned for a 1920x1080 executive video rather than an
// admin dashboard.
//
// No custom font files/packages are loaded — only system font stacks, to
// keep this phase's dependency footprint at "the minimum required for
// local rendering" (per the phase brief). SERIF is used for editorial
// display moments (headlines, big metrics) to read as "executive update,"
// not "PowerPoint slide"; SANS is used for supporting/body copy.

export const COLORS = {
  espresso: '#302A27',
  terracotta: '#B7654A',
  softSand: '#E9DDD2',
  warmCream: '#F8F5EF',
  white: '#FFFFFF',
  darkCharcoal: '#292524',
  mutedGray: '#78716C',
  // Restrained accent EXTENSIONS (visual-direction v2 pass) — never a
  // rainbow palette, and never a replacement for the base identity above.
  // Each accent has one, and only one, contextual meaning (see
  // visualStorySpec.ts's accentForSubject): gold for value/opportunity,
  // sage for healthy/progressing state, slateBlue for
  // technology/systems/connectivity. terracotta remains the one color for
  // friction/emphasis/important transitions — these three are additive,
  // used sparingly, on top of the same warm-cream/espresso/terracotta
  // foundation everywhere else.
  gold: '#B8923F',
  sage: '#7A8B6F',
  slateBlue: '#4C6B8A',
} as const

export const FONT_SERIF = 'Georgia, "Times New Roman", Times, serif'
export const FONT_SANS = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif'

export const VIDEO_WIDTH = 1920
export const VIDEO_HEIGHT = 1080
export const FPS = 30

// Generous editorial margins — the reference video's "generous whitespace"
// quality, not a dashboard's dense edge-to-edge layout.
export const FRAME_PADDING_X = 160
export const FRAME_PADDING_Y = 120

// A small, self-contained US-states reference table — used ONLY by
// regionDetection.ts (to recognize an ALREADY-GROUNDED region mention in a
// scene's own title/body/bullets/next) and usMapOutline.tsx (to place a
// marker at that region's approximate position on a simplified map
// silhouette). Nothing here is used to infer or invent a location — it is
// purely a lookup from a real, already-present name/abbreviation to a
// display label and an approximate marker position.

export interface UsStateEntry {
  name: string
  abbreviation: string
  // Approximate marker position within a 0-960 x 0-600 reference viewBox
  // (matches usMapOutline.tsx's <svg viewBox="0 0 960 600">) — intentionally
  // approximate/simplified (a recognizable relative layout, not
  // surveyed-accurate cartography), sufficient for "emphasize the relevant
  // region" rather than precise mapping.
  x: number
  y: number
}

export const US_STATES: UsStateEntry[] = [
  { name: 'Alabama', abbreviation: 'AL', x: 620, y: 420 },
  { name: 'Alaska', abbreviation: 'AK', x: 120, y: 500 },
  { name: 'Arizona', abbreviation: 'AZ', x: 280, y: 400 },
  { name: 'Arkansas', abbreviation: 'AR', x: 560, y: 380 },
  { name: 'California', abbreviation: 'CA', x: 130, y: 320 },
  { name: 'Colorado', abbreviation: 'CO', x: 380, y: 300 },
  { name: 'Connecticut', abbreviation: 'CT', x: 850, y: 190 },
  { name: 'Delaware', abbreviation: 'DE', x: 820, y: 240 },
  { name: 'Florida', abbreviation: 'FL', x: 700, y: 520 },
  { name: 'Georgia', abbreviation: 'GA', x: 660, y: 420 },
  { name: 'Hawaii', abbreviation: 'HI', x: 260, y: 540 },
  { name: 'Idaho', abbreviation: 'ID', x: 280, y: 160 },
  { name: 'Illinois', abbreviation: 'IL', x: 600, y: 260 },
  { name: 'Indiana', abbreviation: 'IN', x: 630, y: 260 },
  { name: 'Iowa', abbreviation: 'IA', x: 550, y: 230 },
  { name: 'Kansas', abbreviation: 'KS', x: 470, y: 300 },
  { name: 'Kentucky', abbreviation: 'KY', x: 660, y: 300 },
  { name: 'Louisiana', abbreviation: 'LA', x: 560, y: 450 },
  { name: 'Maine', abbreviation: 'ME', x: 880, y: 130 },
  { name: 'Maryland', abbreviation: 'MD', x: 810, y: 250 },
  { name: 'Massachusetts', abbreviation: 'MA', x: 860, y: 175 },
  { name: 'Michigan', abbreviation: 'MI', x: 630, y: 190 },
  { name: 'Minnesota', abbreviation: 'MN', x: 520, y: 150 },
  { name: 'Mississippi', abbreviation: 'MS', x: 590, y: 420 },
  { name: 'Missouri', abbreviation: 'MO', x: 550, y: 300 },
  { name: 'Montana', abbreviation: 'MT', x: 350, y: 140 },
  { name: 'Nebraska', abbreviation: 'NE', x: 460, y: 250 },
  { name: 'Nevada', abbreviation: 'NV', x: 200, y: 290 },
  { name: 'New Hampshire', abbreviation: 'NH', x: 865, y: 155 },
  { name: 'New Jersey', abbreviation: 'NJ', x: 830, y: 230 },
  { name: 'New Mexico', abbreviation: 'NM', x: 360, y: 400 },
  { name: 'New York', abbreviation: 'NY', x: 800, y: 175 },
  { name: 'North Carolina', abbreviation: 'NC', x: 760, y: 340 },
  { name: 'North Dakota', abbreviation: 'ND', x: 450, y: 140 },
  { name: 'Ohio', abbreviation: 'OH', x: 680, y: 250 },
  { name: 'Oklahoma', abbreviation: 'OK', x: 470, y: 370 },
  { name: 'Oregon', abbreviation: 'OR', x: 160, y: 160 },
  { name: 'Pennsylvania', abbreviation: 'PA', x: 790, y: 220 },
  { name: 'Rhode Island', abbreviation: 'RI', x: 865, y: 190 },
  { name: 'South Carolina', abbreviation: 'SC', x: 740, y: 390 },
  { name: 'South Dakota', abbreviation: 'SD', x: 450, y: 190 },
  { name: 'Tennessee', abbreviation: 'TN', x: 640, y: 350 },
  { name: 'Texas', abbreviation: 'TX', x: 450, y: 460 },
  { name: 'Utah', abbreviation: 'UT', x: 280, y: 290 },
  { name: 'Vermont', abbreviation: 'VT', x: 850, y: 145 },
  { name: 'Virginia', abbreviation: 'VA', x: 790, y: 290 },
  { name: 'Washington', abbreviation: 'WA', x: 190, y: 100 },
  { name: 'West Virginia', abbreviation: 'WV', x: 750, y: 270 },
  { name: 'Wisconsin', abbreviation: 'WI', x: 580, y: 180 },
  { name: 'Wyoming', abbreviation: 'WY', x: 360, y: 220 },
  { name: 'District of Columbia', abbreviation: 'DC', x: 805, y: 255 },
]

// Two-letter abbreviations excluded from standalone-abbreviation matching
// because they collide with common English words/business abbreviations
// (regionDetection.ts still matches these states by their FULL name —
// "Maine"/"Hawaii"/"Oklahoma" etc. are still detected, just not from a
// bare "ME"/"HI"/"OK" token).
export const AMBIGUOUS_STATE_ABBREVIATIONS = new Set(['IN', 'OR', 'ME', 'HI', 'OK', 'OH', 'ID', 'AL', 'CO', 'MT', 'MA', 'PA'])

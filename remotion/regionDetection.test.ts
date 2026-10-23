// Run with: node --test remotion/regionDetection.test.ts
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { detectGroundedRegion } from './regionDetection.ts'

describe('detectGroundedRegion — whitelist-only, never an inference', () => {
  test('detects a full state name in the title', () => {
    const region = detectGroundedRegion({ title: 'Texas Market Expansion', body: '', bullets: [], next: '' })
    assert.ok(region)
    assert.equal(region.name, 'Texas')
    assert.equal(region.abbreviation, 'TX')
  })

  test('detects an unambiguous ALL-CAPS abbreviation in a bullet (e.g. "$18M TN deal")', () => {
    const region = detectGroundedRegion({ title: 'New Agent & Commercial Growth Pipeline', body: '', bullets: ['$18M TN deal secured'], next: '' })
    assert.ok(region)
    assert.equal(region.abbreviation, 'TN')
  })

  test('detects a region mentioned in body or next, not just title', () => {
    assert.equal(detectGroundedRegion({ title: 'Update', body: 'Strong momentum in North Carolina this week.', bullets: [], next: '' })?.name, 'North Carolina')
    assert.equal(detectGroundedRegion({ title: 'Update', body: '', bullets: [], next: 'Expand into Georgia next quarter.' })?.name, 'Georgia')
  })

  test('never scans metrics — a 2-letter state prefix inside a metric label is NOT treated as a region mention', () => {
    // This mirrors the exact real-world case this function must NOT match
    // on: "FL Agency Net Remittance" is a metric LABEL, not on-screen
    // scene text; detectGroundedRegion's signature doesn't even accept
    // metrics, so this documents that guarantee structurally.
    const region = detectGroundedRegion({ title: 'Quarter-End Revenue & Remittance Performance', body: '', bullets: [], next: '' })
    assert.equal(region, undefined)
  })

  test('an ambiguous abbreviation (e.g. "IN", "OR", "HI") is never matched as a region — only that state\'s full name is', () => {
    assert.equal(detectGroundedRegion({ title: 'Buy IN or sell', body: '', bullets: [], next: '' }), undefined)
    assert.equal(detectGroundedRegion({ title: 'Say HI to the team', body: '', bullets: [], next: '' }), undefined)
    assert.equal(detectGroundedRegion({ title: 'Indiana Expansion', body: '', bullets: [], next: '' })?.name, 'Indiana')
  })

  test('a lowercase or mixed-case abbreviation is never matched — only the conventional ALL-CAPS form is trusted', () => {
    assert.equal(detectGroundedRegion({ title: 'the tn market', body: '', bullets: [], next: '' }), undefined)
  })

  test('returns undefined when no region is genuinely present — never a fabricated default', () => {
    assert.equal(detectGroundedRegion({ title: 'Title Production & Underwriting Quality Risk', body: '', bullets: ['Agent confidence lost'], next: '' }), undefined)
  })
})

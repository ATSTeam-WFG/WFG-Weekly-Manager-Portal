// Run with: node --test src/utils/initials.test.ts
// Pure logic, zero imports beyond the function itself — dynamically,
// exhaustively unit-tested per this project's established two-tier
// testing convention.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { getInitials } from './initials.ts'

describe('getInitials', () => {
  test('first + last initial for a two-word name', () => {
    assert.equal(getInitials('Jane Manager'), 'JM')
  })

  test('first + last initial for a three-or-more-word name — middle names are ignored', () => {
    assert.equal(getInitials('Mary Jane Watson'), 'MW')
  })

  test('first two letters for a single-word name', () => {
    assert.equal(getInitials('Cher'), 'CH')
  })

  test('a single-letter name is returned as-is, uppercased', () => {
    assert.equal(getInitials('X'), 'X')
  })

  test('extra internal whitespace is collapsed and ignored', () => {
    assert.equal(getInitials('  Jane   Manager  '), 'JM')
  })

  test('always uppercases the result regardless of input casing', () => {
    assert.equal(getInitials('jane manager'), 'JM')
  })

  test('an empty or whitespace-only name returns an empty string — never fabricated placeholder initials', () => {
    assert.equal(getInitials(''), '')
    assert.equal(getInitials('   '), '')
  })
})

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { generateEmailChangeToken, hashEmailChangeToken, verifyEmailChangeToken } from './emailChangeToken.ts'

describe('generateEmailChangeToken', () => {
  test('produces a 64-character hex string (32 random bytes) and never the same value twice', () => {
    const a = generateEmailChangeToken()
    const b = generateEmailChangeToken()
    assert.match(a, /^[0-9a-f]{64}$/)
    assert.match(b, /^[0-9a-f]{64}$/)
    assert.notEqual(a, b)
  })
})

describe('hashEmailChangeToken / verifyEmailChangeToken', () => {
  test('a token verifies against its own hash', () => {
    const token = generateEmailChangeToken()
    const hash = hashEmailChangeToken(token)
    assert.equal(verifyEmailChangeToken(token, hash), true)
  })

  test('a different token never verifies against another token\'s hash', () => {
    const tokenA = generateEmailChangeToken()
    const tokenB = generateEmailChangeToken()
    const hashA = hashEmailChangeToken(tokenA)
    assert.equal(verifyEmailChangeToken(tokenB, hashA), false)
  })

  test('a malformed (non-hex) or wrong-length token is rejected, never thrown', () => {
    const hash = hashEmailChangeToken(generateEmailChangeToken())
    assert.equal(verifyEmailChangeToken('not-a-valid-token', hash), false)
    assert.equal(verifyEmailChangeToken('', hash), false)
    assert.equal(verifyEmailChangeToken('ab', hash), false)
  })

  test('hashing is deterministic — the same token always hashes to the same value', () => {
    const token = generateEmailChangeToken()
    assert.equal(hashEmailChangeToken(token), hashEmailChangeToken(token))
  })
})

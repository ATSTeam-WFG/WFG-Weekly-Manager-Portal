import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { isRateLimited } from './simpleRateLimiter.ts'

describe('isRateLimited', () => {
  test('allows up to the configured attempts within a window, then blocks', () => {
    const key = `test-key-${Math.random()}`
    const now = 1_000_000
    for (let i = 0; i < 20; i++) {
      assert.equal(isRateLimited(key, now + i), false, `attempt ${i + 1} should be allowed`)
    }
    assert.equal(isRateLimited(key, now + 20), true, 'the 21st attempt within the window should be blocked')
  })

  test('different keys are tracked independently', () => {
    const now = 2_000_000
    for (let i = 0; i < 20; i++) isRateLimited(`key-a-${now}`, now + i)
    assert.equal(isRateLimited(`key-a-${now}`, now + 20), true)
    assert.equal(isRateLimited(`key-b-${now}`, now + 20), false)
  })

  test('attempts outside the window no longer count against the limit', () => {
    const key = `test-key-window-${Math.random()}`
    const now = 3_000_000
    for (let i = 0; i < 20; i++) isRateLimited(key, now + i)
    assert.equal(isRateLimited(key, now + 20), true)
    assert.equal(isRateLimited(key, now + 70_000), false, 'a full window later, the earlier attempts should have expired')
  })
})

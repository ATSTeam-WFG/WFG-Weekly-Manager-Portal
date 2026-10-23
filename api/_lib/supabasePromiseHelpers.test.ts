// Run with: node --experimental-strip-types --test api/_lib/supabasePromiseHelpers.test.ts
//
// Zero imports beyond node:test/node:assert and the file under test — no
// @supabase/supabase-js, so (unlike authorize-generation.ts itself) this
// gets REAL execution, not source inspection. The fake "thenable" objects
// below are shaped EXACTLY like what a real @supabase/postgrest-js
// PostgrestFilterBuilder actually exposes — confirmed directly against the
// installed package:
//
//   const { createClient } = require('@supabase/supabase-js')
//   const b = createClient('https://x.supabase.co', 'key').rpc('f', {})
//   typeof b.then    -> 'function'
//   typeof b.catch   -> 'undefined'
//   typeof b.finally -> 'undefined'
//
// i.e. it's thenable (awaitable) but does NOT implement the rest of the
// Promise interface. These tests first reproduce the ORIGINAL crash this
// caused (calling .catch directly throws), then prove recordBestEffort
// handles the exact same shape safely in both the resolve and reject case.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { recordBestEffort } from './supabasePromiseHelpers.ts'

// A minimal thenable matching the real builder's shape: only `.then` is a
// function; `.catch`/`.finally` are genuinely absent (not even inherited),
// exactly like the real PostgrestFilterBuilder instance confirmed above.
function fakePostgrestBuilder(outcome: { resolve: unknown } | { reject: unknown }): PromiseLike<unknown> & { catch?: undefined; finally?: undefined } {
  return {
    then(onFulfilled?: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) {
      if ('resolve' in outcome) {
        return Promise.resolve(outcome.resolve).then(onFulfilled)
      }
      return Promise.reject(outcome.reject).then(onFulfilled, onRejected)
    },
  }
}

describe('fakePostgrestBuilder — confirms the fixture actually matches the real builder\'s shape', () => {
  test('has .then but not .catch/.finally, exactly like the real PostgrestFilterBuilder', () => {
    const builder = fakePostgrestBuilder({ resolve: null })
    assert.equal(typeof builder.then, 'function')
    assert.equal(typeof builder.catch, 'undefined')
    assert.equal(typeof builder.finally, 'undefined')
  })
})

describe('REPRODUCTION: the original bug — chaining .catch() directly on this shape throws synchronously', () => {
  test('`builder.catch(() => {})` throws a TypeError, before anything is ever awaited — this is the exact crash that replaced a real provider error with an unrelated one on 2026-10-12', () => {
    const builder = fakePostgrestBuilder({ reject: new Error('original HeyGen error') })
    assert.throws(() => {
      // @ts-expect-error — reproducing the exact invalid call the old code made
      builder.catch(() => {})
    }, TypeError)
  })
})

describe('recordBestEffort — the fix: a real try/catch around a real await, never a chained method that may not exist', () => {
  test('a RESOLVING thenable: recordBestEffort completes normally, does not throw', async () => {
    const builder = fakePostgrestBuilder({ resolve: { data: 'ok' } })
    await assert.doesNotReject(recordBestEffort(builder))
  })

  test('a REJECTING thenable (the exact scenario that crashed in production): recordBestEffort swallows it and resolves, never throws', async () => {
    const builder = fakePostgrestBuilder({ reject: new Error('database write failed') })
    await assert.doesNotReject(recordBestEffort(builder))
  })

  test('recordBestEffort always resolves to undefined, regardless of what the thenable produced — callers never get a value to (mis)use', async () => {
    const resolved = await recordBestEffort(fakePostgrestBuilder({ resolve: { data: 'ignored' } }))
    const rejected = await recordBestEffort(fakePostgrestBuilder({ reject: new Error('ignored') }))
    assert.equal(resolved, undefined)
    assert.equal(rejected, undefined)
  })

  test('a genuinely synchronous throw from a misbehaving thenable\'s own .then is still caught, not just a rejection', async () => {
    const throwingThenable: PromiseLike<unknown> = {
      then() {
        throw new Error('thenable itself threw synchronously')
      },
    }
    await assert.doesNotReject(recordBestEffort(throwingThenable))
  })
})

describe('ARCHITECTURE: never re-throws or masks — the caller\'s original error must survive this call unchanged', () => {
  test('recordBestEffort itself never throws, which is what lets a caller safely do `await recordBestEffort(...); throw originalErr` without the original error being replaced', async () => {
    const originalErr = new Error('the real provider error')
    let caught: unknown
    try {
      await recordBestEffort(fakePostgrestBuilder({ reject: new Error('write also failed') }))
      throw originalErr
    } catch (err) {
      caught = err
    }
    assert.equal(caught, originalErr, 'the ORIGINAL error must be what propagates, never the write-failure')
  })
})

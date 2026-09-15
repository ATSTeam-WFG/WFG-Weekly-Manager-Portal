// Run with: node --test src/lib/listUsersOutcome.test.ts
//
// mapListUsersResponse is the pure WHAT-should-happen decision extracted
// from adminUserManagementService.ts's fetchManagedUsers (which itself
// touches the real Supabase client via sessionService and the browser
// fetch API, and so isn't safe to execute directly — see
// adminUserManagementServiceWiring.test.ts for that function's wiring,
// verified via source inspection instead). This file covers the actual
// error-mapping requirement: every failure branch must return a distinct,
// safe code/message — never collapse into one generic result — and never
// leak anything beyond what the server already decided was safe to send.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { mapListUsersResponse } from './listUsersOutcome.ts'

describe('mapListUsersResponse — non-2xx responses', () => {
  test("passes through the server's own sanitized {error, message} verbatim", () => {
    const result = mapListUsersResponse(false, { error: 'UNAUTHORIZED', message: 'Missing or invalid Authorization header.' })
    assert.deepEqual(result, {
      status: 'error',
      code: 'UNAUTHORIZED',
      message: 'Missing or invalid Authorization header.',
    })
  })

  test('a 403 FORBIDDEN body is passed through the same way', () => {
    const result = mapListUsersResponse(false, { error: 'FORBIDDEN', message: 'Admin access is required.' })
    assert.deepEqual(result, { status: 'error', code: 'FORBIDDEN', message: 'Admin access is required.' })
  })

  test('a 500 SERVER_MISCONFIGURED body is passed through the same way', () => {
    const result = mapListUsersResponse(false, {
      error: 'SERVER_MISCONFIGURED',
      message: 'Server is missing required configuration.',
    })
    assert.deepEqual(result, {
      status: 'error',
      code: 'SERVER_MISCONFIGURED',
      message: 'Server is missing required configuration.',
    })
  })

  test('a non-2xx response with no parseable body falls back to REQUEST_FAILED', () => {
    const result = mapListUsersResponse(false, null)
    assert.equal(result.status, 'error')
    assert.equal((result as { code: string }).code, 'REQUEST_FAILED')
  })

  test('a non-2xx response whose body is missing error/message fields falls back to REQUEST_FAILED, never a crash', () => {
    assert.equal((mapListUsersResponse(false, {}) as { code: string }).code, 'REQUEST_FAILED')
    assert.equal((mapListUsersResponse(false, { error: 'X' }) as { code: string }).code, 'REQUEST_FAILED')
    assert.equal((mapListUsersResponse(false, { message: 'X' }) as { code: string }).code, 'REQUEST_FAILED')
  })

  test('a non-2xx body with non-string error/message fields is rejected, never coerced', () => {
    const result = mapListUsersResponse(false, { error: 123, message: { nested: true } })
    assert.equal((result as { code: string }).code, 'REQUEST_FAILED')
  })
})

describe('mapListUsersResponse — 2xx responses', () => {
  test('a 200 with a valid users array is a success outcome', () => {
    const users = [
      {
        fullName: 'Jane Manager',
        email: 'jane@wfgtitle.com',
        role: 'manager' as const,
        status: 'active' as const,
        submitsWeeklyReport: true,
      },
    ]
    const result = mapListUsersResponse(true, { users })
    assert.deepEqual(result, { status: 'ok', users })
  })

  test('submitsWeeklyReport passes through untouched — this is a pure pass-through, never re-derived from role/status', () => {
    const users = [
      {
        fullName: 'Dual-Role Admin',
        email: 'dualrole.admin@example.com',
        role: 'admin' as const,
        status: 'active' as const,
        submitsWeeklyReport: true,
      },
      {
        fullName: 'Plain Admin',
        email: 'admin@wfgtitle.com',
        role: 'admin' as const,
        status: 'active' as const,
        submitsWeeklyReport: false,
      },
    ]
    const result = mapListUsersResponse(true, { users })
    assert.deepEqual(result, { status: 'ok', users })
  })

  test('a 200 with an empty users array is still a success outcome, not an error', () => {
    const result = mapListUsersResponse(true, { users: [] })
    assert.deepEqual(result, { status: 'ok', users: [] })
  })

  test('a 200 with a malformed body (users missing or not an array) falls back to REQUEST_FAILED, never a silent crash', () => {
    assert.equal((mapListUsersResponse(true, null) as { code: string }).code, 'REQUEST_FAILED')
    assert.equal((mapListUsersResponse(true, {}) as { code: string }).code, 'REQUEST_FAILED')
    assert.equal((mapListUsersResponse(true, { users: 'not-an-array' }) as { code: string }).code, 'REQUEST_FAILED')
  })
})

describe('Error codes/messages never carry more than the server already sanitized', () => {
  test('every error outcome tested here is free of raw-error/credential/stack-trace markers', () => {
    const outcomes = [
      mapListUsersResponse(false, null),
      mapListUsersResponse(true, {}),
      mapListUsersResponse(false, { error: 'UNAUTHORIZED', message: 'Missing or invalid Authorization header.' }),
    ]
    for (const outcome of outcomes) {
      if (outcome.status !== 'error') continue
      const combined = `${outcome.code} ${outcome.message}`
      assert.equal(/service_role|SUPABASE_SECRET_KEY|Bearer |eyJ|stack|at Object\.|node_modules/i.test(combined), false)
    }
  })
})

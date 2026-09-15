// Run with: node --test src/lib/adminUserManagementServiceWiring.test.ts
//
// adminUserManagementService.ts imports sessionService.ts, which imports the
// real browser Supabase client singleton (src/lib/supabaseClient.ts) — that
// throws at module-load time outside a Vite runtime (it reads
// import.meta.env, which plain `node --test` never populates), so this
// file isn't safe to import and execute directly here. Verified via source
// inspection instead, the same pattern used elsewhere in this project. The
// actual error-mapping decision this file delegates to (mapListUsersResponse)
// is exhaustively, dynamically tested in listUsersOutcome.test.ts.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const dir = path.dirname(fileURLToPath(import.meta.url))
const serviceSrc = readFileSync(path.join(dir, 'adminUserManagementService.ts'), 'utf8')
const userManagementSrc = readFileSync(path.join(dir, '..', 'components', 'UserManagement.tsx'), 'utf8')

describe('fetchManagedUsers — each failure returns a distinct, safe outcome instead of one generic result', () => {
  const fnMatch = serviceSrc.match(/export async function fetchManagedUsers\(\)[\s\S]*?\n\}/)
  assert.ok(fnMatch, 'could not locate fetchManagedUsers')
  const body = fnMatch[0]

  test('a getValidAccessToken() failure (no session, or refresh failed) returns NO_VALID_SESSION_OUTCOME, before any fetch is attempted', () => {
    const tokenTryIndex = body.indexOf('accessToken = await getValidAccessToken()')
    const fetchIndex = body.indexOf("await fetch('/api/admin/users/list'")
    const catchBlock = body.match(/accessToken = await getValidAccessToken\(\)\s*\n\s*\} catch \{\s*\n\s*return (\w+)/)
    assert.ok(tokenTryIndex !== -1 && fetchIndex !== -1 && tokenTryIndex < fetchIndex)
    assert.ok(catchBlock, 'could not find the getValidAccessToken catch branch')
    assert.equal(catchBlock[1], 'NO_VALID_SESSION_OUTCOME')
  })

  test('a fetch()-level network failure returns REQUEST_FAILED_OUTCOME, never NO_VALID_SESSION_OUTCOME', () => {
    const catchBlock = body.match(/await fetch\('\/api\/admin\/users\/list'[\s\S]*?\} catch \{\s*\n\s*return (\w+)/)
    assert.ok(catchBlock, 'could not find the fetch() catch branch')
    assert.equal(catchBlock[1], 'REQUEST_FAILED_OUTCOME')
  })

  test('the parsed response is handed to mapListUsersResponse — the actual mapping logic lives in exactly one place, exhaustively tested elsewhere', () => {
    assert.match(body, /return mapListUsersResponse\(response\.ok, body\)/)
  })

  test('imports the outcome constants/mapper from the pure listUsersOutcome module, never redefining them locally', () => {
    assert.match(serviceSrc, /import \{\s*\n\s*mapListUsersResponse,\s*\n\s*NO_VALID_SESSION_OUTCOME,\s*\n\s*REQUEST_FAILED_OUTCOME,/)
  })
})

describe('UserManagement.tsx — the load-error UI shows the specific safe code/message, not a fixed generic string', () => {
  test('loadError state holds {code, message}, not a boolean', () => {
    assert.match(userManagementSrc, /useState<\{ code: string; message: string \} \| null>\(null\)/)
  })

  test('on a non-ok outcome, loadError is set from outcome.code/outcome.message', () => {
    assert.match(userManagementSrc, /setLoadError\(\{ code: outcome\.code, message: outcome\.message \}\)/)
  })

  test('the rendered error paragraph includes both loadError.message and loadError.code', () => {
    const renderMatch = userManagementSrc.match(/loadError \? \(([\s\S]*?)\) : users\.length === 0/)
    assert.ok(renderMatch, 'could not locate the loadError render branch')
    assert.match(renderMatch[1], /\{loadError\.message\}/)
    assert.match(renderMatch[1], /\{loadError\.code\}/)
  })

  test('loadUsers() resets loadError to null (not false) before each load attempt', () => {
    assert.match(userManagementSrc, /setLoadError\(null\)/)
  })
})

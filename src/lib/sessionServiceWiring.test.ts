// Run with: node --test src/lib/sessionServiceWiring.test.ts
//
// sessionService.ts imports the real browser Supabase client singleton
// (supabaseClient.ts), which throws at module-load time outside a Vite
// runtime (it reads import.meta.env, never populated under plain
// `node --test`) — so this file isn't safe to import and execute directly
// here. Verified via source inspection instead, the same pattern used
// elsewhere in this project. The actual margin/refresh-need decision this
// file delegates to is exhaustively, dynamically tested in
// sessionRefreshPolicy.test.ts.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const dir = path.dirname(fileURLToPath(import.meta.url))
const src = readFileSync(path.join(dir, 'sessionService.ts'), 'utf8')

describe('getValidAccessToken delegates its refresh-need decision to the shared, tested policy — never a local margin re-implementation', () => {
  test('imports shouldRefreshBeforeUse from sessionRefreshPolicy.ts, and does not define its own margin constant', () => {
    assert.match(src, /import \{ shouldRefreshBeforeUse \} from '\.\/sessionRefreshPolicy'/)
    assert.equal(/SESSION_REFRESH_MARGIN_SECONDS\s*=/.test(src), false)
  })

  test('calls shouldRefreshBeforeUse(session.expires_at, nowSeconds) before deciding whether to return the cached token as-is', () => {
    const fnMatch = src.match(/export async function getValidAccessToken\(\)[\s\S]*?\n\}/)
    assert.ok(fnMatch, 'could not locate getValidAccessToken')
    const body = fnMatch[0]
    const checkIndex = body.indexOf('shouldRefreshBeforeUse(session.expires_at, nowSeconds)')
    const earlyReturnIndex = body.indexOf('return session.access_token')
    assert.ok(checkIndex !== -1 && earlyReturnIndex !== -1 && checkIndex < earlyReturnIndex)
  })

  test('a session with no session object at all still throws SessionError before any refresh margin logic runs', () => {
    const fnMatch = src.match(/export async function getValidAccessToken\(\)[\s\S]*?\n\}/)
    assert.ok(fnMatch)
    const body = fnMatch[0]
    const noSessionCheckIndex = body.indexOf('if (!session)')
    const marginCheckIndex = body.indexOf('shouldRefreshBeforeUse(')
    assert.ok(noSessionCheckIndex !== -1 && marginCheckIndex !== -1 && noSessionCheckIndex < marginCheckIndex)
  })

  test('a refresh failure (error or no session back) throws SessionError — never silently falls back to the old, possibly-stale access token', () => {
    const fnMatch = src.match(/export async function getValidAccessToken\(\)[\s\S]*?\n\}/)
    assert.ok(fnMatch)
    const body = fnMatch[0]
    assert.match(body, /if \(refreshError \|\| !refreshData\.session\) \{\s*\n\s*throw new SessionError/)
    // The success path returns the token from the fresh refreshData, not
    // from the original (possibly near-death) session object.
    assert.match(body, /return refreshData\.session\.access_token/)
  })
})

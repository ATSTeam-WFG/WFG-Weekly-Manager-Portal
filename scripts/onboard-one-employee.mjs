// One-record-at-a-time PREVIEW onboarding tool. Calls the EXACT same
// server-side functions api/admin/users/invite.ts (Add Manager) and
// api/admin/users/invite-sales-rep.ts (Add Sales Rep) call — no new logic,
// no new account-creation code path, just this engagement's established
// account-creation functions invoked directly instead of through a browser
// session, since no Admin browser session is available to drive the UI
// here. Reads NEXT_PUBLIC_SUPABASE_URL/SUPABASE_SECRET_KEY/EMPLOYEE_TEMP_PASSWORD
// from .env.local exactly like the real api/*.ts handlers do — never reads,
// prints, or hardcodes any secret value itself.
//
// Usage:
//   node --import ./scripts/register-test-hooks.mjs scripts/onboard-one-employee.mjs manager "Chad Hansen" chansen@wfgtitle.com
//   node --import ./scripts/register-test-hooks.mjs scripts/onboard-one-employee.mjs sales_rep "Kristy Campbell" kcampbell@wfgtitle.com
//
// Intentionally one record per invocation — never loops over a roster file
// itself — so each PREVIEW write stays individually reviewable, matching
// the "create one, stop, review" pace this onboarding is being run at.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const dir = path.dirname(fileURLToPath(import.meta.url))
const envPath = path.join(dir, '..', '.env.local')
for (const line of readFileSync(envPath, 'utf8').split('\n')) {
  const trimmed = line.trim()
  if (!trimmed || trimmed.startsWith('#')) continue
  const eq = trimmed.indexOf('=')
  if (eq === -1) continue
  const key = trimmed.slice(0, eq)
  const value = trimmed.slice(eq + 1)
  if (!(key in process.env)) process.env[key] = value
}

// Hard safety check — never proceed unless pointed at the confirmed PREVIEW
// project, regardless of what .env.local happens to contain.
const EXPECTED_REF = 'asojatcycijoikeovibs'
if (!process.env.NEXT_PUBLIC_SUPABASE_URL?.includes(EXPECTED_REF)) {
  console.error(`REFUSING: NEXT_PUBLIC_SUPABASE_URL does not reference the confirmed PREVIEW project (${EXPECTED_REF}).`)
  process.exit(1)
}

const [, , kind, fullName, email] = process.argv
if (!['manager', 'sales_rep'].includes(kind) || !fullName || !email) {
  console.error('Usage: node --import ./scripts/register-test-hooks.mjs scripts/onboard-one-employee.mjs <manager|sales_rep> "<Full Name>" <email>')
  process.exit(1)
}

const { addOrCreateManagerAccount, addOrCreateSalesRepAccount } = await import('../api/_lib/supabaseServiceClient.ts')

console.log(`Target project ref: ${EXPECTED_REF}`)
console.log(`Creating ${kind} account for "${fullName}" <${email}>...`)

const outcome =
  kind === 'manager' ? await addOrCreateManagerAccount(fullName, email) : await addOrCreateSalesRepAccount(fullName, email)

console.log('Outcome:', outcome.status)
if (outcome.status !== 'created') {
  console.log('No account was created or modified — see status above.')
  process.exit(outcome.status === 'already_created' || outcome.status === 'already_registered' ? 0 : 1)
}
console.log('Done. No email was sent. No credentials were printed. The shared temporary password is already configured server-side only.')

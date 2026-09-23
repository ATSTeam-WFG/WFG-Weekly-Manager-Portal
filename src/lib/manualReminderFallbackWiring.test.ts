// Run with: node --test src/lib/manualReminderFallbackWiring.test.ts
//
// AdminDashboard.tsx and ReminderPanel.tsx both ultimately depend on the
// real browser Supabase client / React DOM APIs (navigator.clipboard),
// neither of which this project has a renderer (jsdom/@testing-library)
// wired up for — this project's own convention for exactly this situation
// (see dualRoleRoutingWiring.test.ts, onboardingRedirectWiring.test.ts) is
// to verify component wiring via source inspection instead. The underlying
// pure recipient-selection logic (getReminderTargets/buildFridayReminderEmail)
// is already exhaustively tested dynamically in reminderService.test.ts;
// this file covers only what changed here: that the manual Prepare
// Reminders / Copy Email / Copy Message fallback is reachable, reuses the
// single canonical selection function, and never sends or calls any API.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const dir = path.dirname(fileURLToPath(import.meta.url))
const dashboardSrc = readFileSync(path.join(dir, '..', 'components', 'AdminDashboard.tsx'), 'utf8')
const panelSrc = readFileSync(path.join(dir, '..', 'components', 'ReminderPanel.tsx'), 'utf8')

describe('Prepare Reminders is reachable while REMINDER_ACTIONS_ENABLED stays false', () => {
  test('AdminDashboard.tsx no longer imports or references REMINDER_ACTIONS_ENABLED at all', () => {
    assert.equal(dashboardSrc.includes('REMINDER_ACTIONS_ENABLED'), false)
    assert.equal(dashboardSrc.includes("from '../config/featureFlags'"), false)
  })

  test('the bulk "Prepare Reminders" button renders whenever there is at least one pending submitter — no flag gate', () => {
    assert.match(dashboardSrc, /\{needsAttention > 0 && \(/)
  })

  test('the per-row "Remind" button renders whenever that manager has not submitted — no flag gate', () => {
    // Step 2's redesign turned the old `&&`-render into a ternary (an em
    // dash shows in the Reminder column for an already-submitted manager
    // instead of nothing), but the same condition still gates it: no
    // feature flag involved either way.
    assert.match(dashboardSrc, /\{manager\.status !== 'submitted' \? \(/)
    const buttonBlockMatch = dashboardSrc.match(/\{manager\.status !== 'submitted' \? \(([\s\S]*?)\) : \(/)
    assert.ok(buttonBlockMatch, 'could not locate the conditional Remind button block')
    assert.match(buttonBlockMatch[1], /className="manager-remind-btn"/)
  })

  test('featureFlags.ts itself is untouched — REMINDER_ACTIONS_ENABLED is still exactly false', () => {
    const flagsSrc = readFileSync(path.join(dir, '..', 'config', 'featureFlags.ts'), 'utf8')
    assert.match(flagsSrc, /export const REMINDER_ACTIONS_ENABLED = false/)
  })
})

describe('Recipient selection reuses the single canonical getReminderTargets — no second implementation', () => {
  test('AdminDashboard.tsx imports getReminderTargets from src/lib/reminderService.ts', () => {
    assert.match(dashboardSrc, /import \{ getReminderTargets, type ReminderTarget \} from '\.\.\/lib\/reminderService'/)
  })

  test('pendingReminderTargets is computed via getReminderTargets(managers), and needsAttention is derived from its length', () => {
    assert.match(dashboardSrc, /const pendingReminderTargets = getReminderTargets\(managers\)/)
    assert.match(dashboardSrc, /const needsAttention = pendingReminderTargets\.length/)
  })

  test('the bulk button passes pendingReminderTargets straight through — never a separately re-filtered array', () => {
    assert.match(dashboardSrc, /onClick=\{\(\) => setReminderTarget\(pendingReminderTargets\)\}/)
  })

  test('the per-row button also goes through getReminderTargets, not an inline status check', () => {
    assert.match(dashboardSrc, /setReminderTarget\(getReminderTargets\(\[manager\]\)\)/)
  })

  test('no inline "managers.filter(...status !== ...submitted)" reminder-selection duplicate remains', () => {
    assert.equal(/setReminderTarget\(managers\.filter/.test(dashboardSrc), false)
  })
})

describe('ReminderPanel displays name, status, email, and message for every target', () => {
  test('renders StatusBadge, the email line, and the generated message for each manager', () => {
    assert.match(panelSrc, /<StatusBadge status=\{manager\.status\} \/>/)
    assert.match(panelSrc, /To: \{manager\.email \|\| 'Email not available'\}/)
    assert.match(panelSrc, /<p className="reminder-message">\{message\}<\/p>/)
  })

  test('ReminderPanel now takes ReminderTarget[] (the getReminderTargets output type), not the broader ManagerSummary[]', () => {
    assert.match(panelSrc, /import type \{ ReminderTarget \} from '\.\.\/lib\/reminderService'/)
    assert.match(panelSrc, /managers: ReminderTarget\[\]/)
  })
})

describe('Copy Email copies exactly the manager\'s own email', () => {
  test('the Copy Email button calls handleCopy with manager.email, never any other field', () => {
    assert.match(panelSrc, /onClick=\{\(\) => manager\.email && handleCopy\(manager\.email, emailKey\)\}/)
  })

  test('the Copy Email button is disabled when there is no email on file, so it can never copy an empty/missing value', () => {
    assert.match(panelSrc, /disabled=\{!manager\.email\}/)
  })
})

describe('Copy Message copies exactly the existing generated reminder message', () => {
  test('message is produced by the existing buildReminderMessage(manager, week, isPastDeadline), unchanged wording', () => {
    assert.match(panelSrc, /const message = buildReminderMessage\(manager, week, isPastDeadline\)/)
  })

  test('the Copy Message button calls handleCopy with that exact message value', () => {
    assert.match(panelSrc, /onClick=\{\(\) => handleCopy\(message, messageKey\)\}/)
  })

  test('buildReminderMessage\'s own wording logic is untouched (draft vs not_started copy)', () => {
    assert.match(panelSrc, /I've started your report, but it hasn't been submitted yet|I can see you've started your report, but it hasn't been submitted yet/)
    assert.match(panelSrc, /It looks like your report hasn't been started yet/)
  })
})

describe('Copy uses navigator.clipboard.writeText and fails gracefully', () => {
  test('handleCopy calls navigator.clipboard.writeText', () => {
    assert.match(panelSrc, /await navigator\.clipboard\.writeText\(text\)/)
  })

  test('a missing/unsupported clipboard API or a rejected writeText is caught, never thrown, and only affects that one key\'s own state', () => {
    const fnMatch = panelSrc.match(/async function handleCopy\([\s\S]*?\n  \}/)
    assert.ok(fnMatch, 'could not locate handleCopy')
    assert.match(fnMatch[0], /try \{/)
    assert.match(fnMatch[0], /catch \{/)
    assert.match(fnMatch[0], /setCopyStates\(\(prev\) => \(\{ \.\.\.prev, \[key\]: 'error' \}\)\)/)
  })

  test('a successful copy sets a transient "copied" state for that key only, auto-clearing on a timeout', () => {
    assert.match(panelSrc, /setCopyStates\(\(prev\) => \(\{ \.\.\.prev, \[key\]: 'copied' \}\)\)/)
    assert.match(panelSrc, /window\.setTimeout\(/)
  })

  test('the button label reflects Copied!/Couldn\'t copy transiently, defaulting back to the original label', () => {
    assert.match(panelSrc, /copyButtonLabel/)
    assert.match(panelSrc, /'Copied!'/)
    assert.match(panelSrc, /"Couldn't copy"/)
  })
})

describe('No Send action or API call exists anywhere in this fallback', () => {
  test('ReminderPanel.tsx has no Send button, no disabled attribute tied to sending, and no "Send Reminder(s)" text', () => {
    assert.equal(/Send \$\{managers\.length\} Reminders/.test(panelSrc), false)
    assert.equal(panelSrc.includes("'Send Reminder'"), false)
    assert.equal(/<button[^>]*disabled(?!=\{!manager\.email\})/.test(panelSrc), false)
  })

  test('ReminderPanel.tsx never calls fetch or references /api/reminders', () => {
    assert.equal(panelSrc.includes('fetch('), false)
    assert.equal(panelSrc.includes('/api/reminders'), false)
  })

  test('AdminDashboard.tsx never calls fetch or references /api/reminders either', () => {
    assert.equal(dashboardSrc.includes('fetch('), false)
    assert.equal(dashboardSrc.includes('/api/reminders'), false)
  })

  test('the footer note reflects manual-copy-only, no auto-send framing', () => {
    assert.match(panelSrc, /Automatic sending is not enabled/)
  })
})

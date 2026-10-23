// Run with: node --test src/lib/adminVisualRefinementWiring.test.ts
//
// Header.tsx/AdminSidebar.tsx/AdminDashboard.tsx are React components with
// no rendering harness in this project — the established pattern (see
// adminShellWiring.test.ts, adminDashboardRefinementWiring.test.ts) is to
// verify wiring via source inspection instead.
//
// Feature this covers: the reference-driven visual refinement of the
// global Header, AdminSidebar (decorative lower-sidebar treatment), and
// AdminDashboard (top row restructure, five consistent KPI icon
// structures, manager initials, denser table) — all presentation-only,
// with every calculation/eligibility/callback from the prior step
// preserved exactly.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const dir = path.dirname(fileURLToPath(import.meta.url))
const headerSrc = readFileSync(path.join(dir, '..', 'components', 'Header.tsx'), 'utf8')
const headerCss = readFileSync(path.join(dir, '..', 'components', 'Header.css'), 'utf8')
const sidebarSrc = readFileSync(path.join(dir, '..', 'components', 'AdminSidebar.tsx'), 'utf8')
const sidebarCss = readFileSync(path.join(dir, '..', 'components', 'AdminSidebar.css'), 'utf8')
const dashboardSrc = readFileSync(path.join(dir, '..', 'components', 'AdminDashboard.tsx'), 'utf8')
const dashboardCss = readFileSync(path.join(dir, '..', 'components', 'AdminDashboard.css'), 'utf8')
const initialsSrc = readFileSync(path.join(dir, '..', 'utils', 'initials.ts'), 'utf8')

describe('Header.tsx — presentation-only refinement; Sign Out and the props interface are untouched', () => {
  test('HeaderProps still requires exactly displayName/roleLabel/onSignOut — any later addition (e.g. the video-consent badge) must be optional, never a new required prop', () => {
    const interfaceBlock = headerSrc.match(/interface HeaderProps \{([\s\S]*?)\n\}/)
    assert.ok(interfaceBlock, 'could not locate the HeaderProps interface')
    assert.match(interfaceBlock[1], /displayName: string/)
    assert.match(interfaceBlock[1], /roleLabel: string/)
    assert.match(interfaceBlock[1], /onSignOut: \(\) => void/)
    // Every field other than the three required ones above must be
    // optional (name?: type) — a required addition would silently break
    // every existing caller that doesn't pass it.
    const fieldLines = interfaceBlock[1]
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('//'))
    for (const line of fieldLines) {
      if (/^(displayName|roleLabel|onSignOut):/.test(line)) continue
      assert.match(line, /^\w+\?:/, `unexpected required field in HeaderProps: "${line}"`)
    }
  })

  test('Sign Out button is byte-identical in behavior — same className, same onClick, same label', () => {
    assert.match(headerSrc, /<button type="button" className="sign-out-btn" onClick=\{onSignOut\}>\s*\n\s*Sign Out\s*\n\s*<\/button>/)
  })

  test('the initials avatar is derived from the existing displayName via the shared getInitials utility — never a fabricated image/photo', () => {
    assert.match(headerSrc, /import \{ getInitials \} from '\.\.\/utils\/initials'/)
    assert.match(headerSrc, /<span className="header-user-avatar" aria-hidden="true">\s*\n\s*\{getInitials\(displayName\)\}\s*\n\s*<\/span>/)
    assert.equal(/<img[^>]*avatar/i.test(headerSrc), false)
  })

  test('no notification bell, no decorative chevron, no profile dropdown menu — removed as implying functionality that does not exist', () => {
    assert.equal(/bell|notification/i.test(headerSrc), false)
    assert.equal(/chevron/i.test(headerSrc), false)
    assert.equal(/dropdown|<select|role="menu"/i.test(headerSrc), false)
    assert.equal(/header-bell|header-user-chevron/.test(headerCss), false)
  })

  test('the WFG logo asset is reused as-is — same import, same alt text, no new/replacement image', () => {
    assert.match(headerSrc, /import wfgLogo from '\.\.\/assets\/wfg-logo\.png'/)
    assert.match(headerSrc, /<img src=\{wfgLogo\} alt="WFG" className="header-logo" \/>/)
  })

  test('the divider and title still both exist alongside the logo, unchanged text', () => {
    assert.match(headerSrc, /<span className="header-divider" aria-hidden="true" \/>/)
    assert.match(headerSrc, /<span className="header-title">Weekly Manager Report<\/span>/)
  })

  test('the mobile breakpoint still hides the identity block (and now also the divider) exactly as it hid the title — no new behavior at that breakpoint beyond presentation', () => {
    assert.match(headerCss, /@media \(max-width: 480px\) \{[\s\S]*?\.header-title,\s*\n\s*\.header-divider \{\s*\n\s*display: none;/)
    assert.match(headerCss, /@media \(max-width: 480px\) \{[\s\S]*?\.header-user \{\s*\n\s*display: none;/)
  })
})

describe('AdminSidebar.tsx — decorative lower-sidebar treatment is aria-hidden, CSS-only, and never interferes with navigation', () => {
  test('SidebarDecoration is a separate, aria-hidden block — not one of the four navigable items', () => {
    assert.match(sidebarSrc, /function SidebarDecoration\(\) \{/)
    assert.match(sidebarSrc, /<div className="admin-sidebar-decoration" aria-hidden="true">/)
  })

  test('it renders the requested WFG copy exactly: People/Knowledge/Possibilities and the tagline', () => {
    assert.match(sidebarSrc, /People\s*\n\s*<br \/>\s*\n\s*Knowledge\s*\n\s*<br \/>\s*\n\s*Possibilities/)
    assert.match(sidebarSrc, /Together We Close More/)
  })

  test('the landscape shapes are plain CSS (layered divs), never an <img> or external asset reference', () => {
    assert.equal(/<img/.test(sidebarSrc), false)
    assert.equal(/url\(['"]?http/.test(sidebarCss), false)
    assert.match(sidebarSrc, /<span className="admin-sidebar-hill admin-sidebar-hill-back" \/>/)
  })

  // The Leadership Report phase regrouped the flat 4-item `items` array
  // into grouped destinations (with dividers, see leadershipReportWiring.
  // test.ts) — this test's own intent (the decoration renders as the last
  // sibling, after every nav destination, and the destination count itself
  // is unaffected by the decoration) still holds, just against the new
  // `groups` structure.
  test('the decoration is still the last sibling after every nav destination — now 6, two added by later phases (Leadership Report, Video Creation), unrelated to this decoration', () => {
    const groupsMatch = sidebarSrc.match(/const groups: [\s\S]*?\] = \[[\s\S]*?\n  \]\s*\n/)
    assert.ok(groupsMatch)
    assert.equal((groupsMatch[0].match(/key: '/g) ?? []).length, 6)
    assert.match(sidebarSrc, /\{groups\.map\(\(group, groupIndex\) => \([\s\S]*?\)\)\}\s*\n\s*<SidebarDecoration \/>/)
  })

  test('it is hidden at short viewport heights and whenever the sidebar is in its off-canvas mode, so it can never crowd out mobile navigation', () => {
    assert.match(sidebarCss, /@media \(max-height: 760px\) \{\s*\n\s*\.admin-sidebar-decoration \{\s*\n\s*display: none;/)
    const mobileBlockMatch = sidebarCss.match(/@media \(max-width: 860px\) \{([\s\S]*)\n\}\s*$/)
    assert.ok(mobileBlockMatch)
    assert.match(mobileBlockMatch[1], /\.admin-sidebar-decoration \{\s*\n\s*display: none;/)
  })

  test('it is pushed to the bottom of the sidebar\'s flex column (margin-top: auto), never interspersed between nav items', () => {
    assert.match(sidebarCss, /\.admin-sidebar-decoration \{\s*\n\s*margin-top: auto;/)
  })

  test('the composition (landscape + text as one unified block) is substantially larger than a small banner, and the outer decoration box is never absolutely/fixed positioned — normal flow, so it can never overlap the nav buttons above it', () => {
    assert.match(sidebarCss, /\.admin-sidebar-decoration \{\s*\n\s*margin-top: auto;\s*\n\s*position: relative;\s*\n\s*height: 260px;/)
    assert.equal(/\.admin-sidebar-decoration \{[\s\S]{0,120}position: (absolute|fixed)/.test(sidebarCss), false)
    // The hill background layer is intentionally absolute — but only
    // relative to the outer decoration box above, which itself stays in
    // normal flow, so this can never escape/overlap the nav items.
    assert.match(sidebarCss, /\.admin-sidebar-landscape \{\s*\n\s*position: absolute;\s*\n\s*inset: 0;/)
  })

  test('regression: the sidebar is pinned to the viewport (position: sticky + height: 100vh - header) rather than stretching to match .admin-shell\'s tallest sibling — the actual root cause of the decoration anchoring to the bottom of an oversized box instead of the visible screen', () => {
    assert.match(
      sidebarCss,
      /^\.admin-sidebar \{[\s\S]*?position: sticky;\s*\n\s*top: var\(--admin-shell-header-height, 61px\);\s*\n\s*height: calc\(100vh - var\(--admin-shell-header-height, 61px\)\);/m,
    )
  })

  test('the mobile off-canvas breakpoint explicitly resets position to static — zero change to the already-approved fixed-panel behavior from Step 1', () => {
    const mobileBlockMatch = sidebarCss.match(/@media \(max-width: 860px\) \{\s*\n\s*\.admin-sidebar \{([\s\S]*?)\n\s*\}/)
    assert.ok(mobileBlockMatch, 'could not locate the mobile .admin-sidebar override')
    assert.match(mobileBlockMatch[1], /position: static;/)
  })

  test('the tagline sits with roughly 24-32px of breathing room above the sidebar\'s bottom edge: the decoration\'s own bottom padding (8px) plus the sidebar\'s existing 20px padding', () => {
    assert.match(sidebarCss, /\.admin-sidebar-decoration \{[\s\S]*?padding: 0 8px 8px;/)
    assert.match(sidebarCss, /^\.admin-sidebar \{[\s\S]*?padding: 20px 12px;/m)
  })

  test('the sidebar\'s own width and the nav items\' own sizing are untouched by enlarging the decoration', () => {
    assert.match(sidebarCss, /^\.admin-sidebar \{\s*\n\s*display: flex;\s*\n\s*flex-direction: column;\s*\n\s*gap: 2px;\s*\n\s*width: 220px;/m)
    assert.match(sidebarCss, /^\.admin-sidebar-item \{\s*\n\s*display: flex;\s*\n\s*align-items: center;\s*\n\s*gap: 12px;\s*\n\s*width: 100%;\s*\n\s*font-family: inherit;\s*\n\s*font-size: 14px;/m)
  })
})

describe('AdminDashboard.tsx — all five KPI cards now share the same icon-circle structure', () => {
  test('Completion now has an inline SVG icon inside .adp-kpi-icon, matching the same local-icon approach as the other four — no icon library import', () => {
    const completionCardMatch = dashboardSrc.match(/<div className="adp-kpi-card adp-kpi-card-completion">([\s\S]*?)\n {12}<\/div>/)
    assert.ok(completionCardMatch, 'could not locate the Completion KPI card')
    assert.match(completionCardMatch[1], /<span className="adp-kpi-icon" aria-hidden="true">\s*\n\s*<svg/)
    assert.equal(/from ['"](react-icons|@heroicons|lucide-react|@fortawesome)/.test(dashboardSrc), false)
  })

  test('all five cards use the exact same .adp-kpi-icon container class — one shared circle size/shape for all', () => {
    assert.equal((dashboardSrc.match(/className="adp-kpi-icon" aria-hidden="true"/g) ?? []).length, 5)
  })

  test('Not Started now uses a warm terracotta tint (changed from the prior neutral gray); Total Managers/Completion stay neutral; Submitted stays green; Draft stays amber — no KPI calculation changed', () => {
    assert.match(
      dashboardCss,
      /\.adp-kpi-card-not-started \.adp-kpi-icon \{\s*\n\s*background: rgba\(183, 101, 74,[\s\S]*?\n\s*color: var\(--terracotta\);\s*\n\}/,
    )
    assert.match(dashboardCss, /\.adp-kpi-card-submitted \.adp-kpi-icon \{\s*\n\s*background: rgba\(22, 131, 75,/)
    assert.match(dashboardCss, /\.adp-kpi-card-draft \.adp-kpi-icon \{\s*\n\s*background: rgba\(217, 119, 6,/)
    // Calculations themselves are untouched.
    assert.match(dashboardSrc, /const notStarted = managers\.filter\(\(m\) => m\.status === 'not_started'\)\.length/)
  })

  test('Pending still has no KPI card of its own', () => {
    assert.equal(dashboardSrc.includes('adp-kpi-card-pending'), false)
  })
})

describe('AdminDashboard.tsx — manager initials are derived from the real fullName, never fabricated', () => {
  test('the manager row uses the same shared getInitials utility as Header, applied to manager.fullName', () => {
    assert.match(dashboardSrc, /import \{ getInitials \} from '\.\.\/utils\/initials'/)
    assert.match(dashboardSrc, /<span className="adp-manager-avatar" aria-hidden="true">\s*\n\s*\{getInitials\(manager\.fullName\)\}\s*\n\s*<\/span>/)
  })

  test('no manager avatar photo/image was fabricated — the avatar is text-only initials', () => {
    assert.equal(/<img[^>]*manager/i.test(dashboardSrc), false)
  })

  test('name and email still render exactly as before, just now alongside (not replaced by) the initials circle', () => {
    assert.match(dashboardSrc, /<span className="manager-name">\{manager\.fullName\}<\/span>/)
    assert.match(dashboardSrc, /\{manager\.email \|\| 'Email not available'\}/)
  })

  test('getInitials itself never invents data for a blank name', () => {
    assert.match(initialsSrc, /if \(parts\.length === 0\) return ''/)
  })
})

describe('AdminDashboard.tsx — no Actions/kebab column; the existing five columns and their exact behaviors are preserved', () => {
  test('the column headers are still exactly Manager | Submission Status | Submitted | Reminder | Report — no Actions column', () => {
    const headerRowMatch = dashboardSrc.match(/<div className="adp-table-header-row" role="row">([\s\S]*?)<\/div>/)
    assert.ok(headerRowMatch)
    const body = headerRowMatch[1]
    assert.match(body, />Manager<\/span>/)
    assert.match(body, />Submission Status<\/span>/)
    assert.match(body, />Submitted<\/span>/)
    assert.match(body, />Reminder<\/span>/)
    assert.match(body, />Report<\/span>/)
    assert.equal(/Actions/.test(body), false)
    assert.equal((body.match(/role="columnheader"/g) ?? []).length, 5)
  })

  test('no kebab/three-dot menu was added anywhere in this component', () => {
    assert.equal(/kebab|three-dot|⋮|•••/i.test(dashboardSrc), false)
  })

  test('View Report still calls onSelectManager(manager) exactly, on both click and Enter/Space', () => {
    assert.match(dashboardSrc, /onClick=\{\(\) => onSelectManager\(manager\)\}/)
    assert.match(dashboardSrc, /if \(e\.key === 'Enter' \|\| e\.key === ' '\) onSelectManager\(manager\)/)
    assert.match(dashboardSrc, /\{manager\.status === 'submitted' \? 'View Report' : 'View'\} &rarr;/)
  })

  test('the Reminder action still only appears for a non-submitted manager and still calls the same getReminderTargets([manager]) — no new reminder state introduced', () => {
    assert.match(dashboardSrc, /\{manager\.status !== 'submitted' \? \(/)
    assert.match(dashboardSrc, /setReminderTarget\(getReminderTargets\(\[manager\]\)\)/)
    // No new camelCase reminder-state variable was introduced — the visible
    // label text "Reminder needed" (two words, checked separately below) is
    // presentational only and does not match this pattern.
    assert.equal(/needsReminder|reminderNeeded/i.test(dashboardSrc), false)
  })

  test('the reminder action reads "Reminder needed" with a small dot indicator, and is softened to a pale amber chip — same button, same onClick, only the presentation changed', () => {
    assert.match(dashboardSrc, /<span className="manager-remind-dot" aria-hidden="true" \/>\s*\n\s*Reminder needed/)
    const btnRuleMatch = dashboardCss.match(/\.manager-remind-btn \{([\s\S]*?)\n\}/)
    assert.ok(btnRuleMatch, 'could not locate .manager-remind-btn rule')
    assert.match(btnRuleMatch[1], /background: rgba\(217, 119, 6, 0\.12\);/)
    assert.match(btnRuleMatch[1], /color: var\(--amber\);/)
    assert.equal(/background: var\(--amber\);/.test(btnRuleMatch[1]), false)
    assert.match(dashboardCss, /\.manager-remind-dot \{[\s\S]*?background: var\(--amber\);/)
  })

  test('Submitted column still uses only submittedAt/submissionSource — never a fabricated timestamp — with an em dash otherwise', () => {
    assert.match(dashboardSrc, /manager\.submittedAt \? formatSubmittedAt\(manager\.submittedAt\) : '—'/)
    assert.match(dashboardSrc, /getSubmissionSourceLabel\(manager\)/)
  })
})

describe('AdminDashboard.tsx — top row restructure preserves week navigation exactly; density change is desktop-only', () => {
  test('Previous/Next/current-week disabling and the week calculations themselves are unchanged', () => {
    assert.match(dashboardSrc, /onClick=\{onPreviousWeek\}/)
    assert.match(dashboardSrc, /onClick=\{onNextWeek\}/)
    assert.match(dashboardSrc, /disabled=\{isCurrentWeek\}/)
    assert.match(dashboardSrc, /const daysLeft = getDaysUntilDeadline\(week\.fridayDate\)/)
    assert.match(dashboardSrc, /const isPastDeadline = isPastEasternCutoff\(15, 0\)/)
  })

  test('the week-navigation control and My Weekly Report (when present) are grouped together on the right of the same top row as the title', () => {
    const topRowMatch = dashboardSrc.match(/<div className="adp-top-row">([\s\S]*?)\n {6}<\/div>\n\n {6}\{loading/)
    assert.ok(topRowMatch, 'could not locate .adp-top-row')
    assert.match(topRowMatch[1], /<h1>Admin Dashboard<\/h1>/)
    assert.match(topRowMatch[1], /className="adp-top-row-right"/)
    assert.match(topRowMatch[1], /onOpenMyReport && \(/)
    assert.match(topRowMatch[1], /className="adp-week-nav"/)
  })

  test('desktop row padding is reduced for density, but the mobile breakpoint restores the original, more generous padding — density is desktop-only', () => {
    const baseRowMatch = dashboardCss.match(/^\.adp-row \{([\s\S]*?)\n\}/m)
    assert.ok(baseRowMatch)
    assert.match(baseRowMatch[1], /padding: 6px 16px;/)
    const mobileBlockMatch = dashboardCss.match(/@media \(max-width: 640px\) \{([\s\S]*?)\n\}\s*\n\n@media \(max-width: 480px\)/)
    assert.ok(mobileBlockMatch)
    assert.match(mobileBlockMatch[1], /\.adp-row \{[\s\S]*?padding: 14px 16px;/)
  })
})

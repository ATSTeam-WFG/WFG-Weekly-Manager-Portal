// Temporary flags for the V1 first-call demo. Both features are fully built
// and left in the codebase untouched — flip either flag back to true to
// re-enable it, no other code changes needed.

// AI Executive Summary: enabled locally now that the Anthropic API key is
// configured and verified. Keep disabled in any environment without a real
// key configured, to avoid the "server is missing required configuration" error.
export const AI_EXECUTIVE_SUMMARY_ENABLED = true

// Reminder send controls: the status/tracking parts of the reminder work
// (Needs Attention, filters, per-manager detail) stay visible everywhere —
// only the "Remind" / "Prepare Reminders" actions that open the disabled
// send-email preview are hidden, since there's no approved email provider yet.
export const REMINDER_ACTIONS_ENABLED = false

// Employee-roster login sync: on each sign-in, reconciles an existing
// account's role/is_active against approved_employees. Left OFF until the
// roster is actually imported — turning this on while approved_employees is
// empty would deny access to every existing account, since "not found in
// the roster" is treated as not approved. Flip to true once the roster
// import is complete; no other code change is needed.
export const EMPLOYEE_ROSTER_SYNC_ENABLED = false

// Self-service first-time account setup: the "Request Access" entry point on
// Login, and the invite/create-password/complete-profile sequence it leads
// to. Left OFF for Alpha — the code is fully built, but turning this on
// before SUPABASE_SECRET_KEY exists and "Allow new user signups" has been
// deliberately disabled (and re-verified for existing-user sign-in) would be
// premature. Forgot Password is intentionally NOT gated by this flag — it
// only touches an existing account's own password, never approved_employees
// or the invite system, so it carries none of the same risk.
export const SELF_SERVICE_ONBOARDING_ENABLED = false

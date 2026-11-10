import { authenticateAdmin } from '../../_lib/adminAuth.js'
import {
  findProfileByEmail,
  convertManagedEmployeeRole,
  findActiveAssignmentForRep,
  normalizeEmail,
  lookupApprovedEmployeeByNormalizedEmail,
} from '../../_lib/supabaseServiceClient.js'
import { decideRoleConversionAction, type RoleConversionProfileLookup } from '../../_lib/roleConversion.js'
import { isAssignmentVerified } from '../../_lib/salesRepPreProvisioning.js'
import { APPROVED_ROLE_CONVERSIONS } from '../../_lib/roleConversionRoster.js'

interface VercelRequest {
  method?: string
  headers: Record<string, string | string[] | undefined>
  body: unknown
}

interface VercelResponse {
  status(code: number): VercelResponse
  json(body: unknown): void
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY

function sendError(res: VercelResponse, status: number, code: string, message: string) {
  res.status(status).json({ error: code, message })
}

interface EntryResult {
  email: string
  decision: string
  status: 'preview' | 'skipped' | 'full_success' | 'converted_assignment_failed' | 'assignment_unverified' | 'error'
  message: string
}

// "Convert Role" — Admin-ONLY. Fixed, versioned roster of exactly the two
// approved launch-completion conversions (never a client-supplied
// email/role). Each entry is only ever converted FROM its named expected
// current role; convertManagedEmployeeRole refuses anything else. Austin's
// entry additionally assigns him to his approved Manager afterward, using
// the same admin-scoped-client + independent-re-read-before-success
// discipline already established in pre-provision-sales-reps.ts — never
// the service-role client for the assign_sales_rep RPC call.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== 'POST') {
      return sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Only POST requests are supported.')
    }

    const auth = await authenticateAdmin({
      supabaseUrl: SUPABASE_URL,
      supabasePublishableKey: SUPABASE_PUBLISHABLE_KEY,
      authorizationHeader: req.headers.authorization,
    })
    if (!auth.ok) {
      return sendError(res, auth.status, auth.code, auth.message)
    }

    const body = (req.body ?? {}) as { execute?: unknown }
    const execute = body.execute === true

    const results: EntryResult[] = []

    for (const entry of APPROVED_ROLE_CONVERSIONS) {
      const emailNormalized = normalizeEmail(entry.email)
      const profileResult = await findProfileByEmail(emailNormalized)
      const profileLookup: RoleConversionProfileLookup =
        profileResult.status === 'found'
          ? { status: 'found', role: profileResult.profile.role }
          : profileResult.status === 'error'
            ? { status: 'lookup_failed' }
            : { status: 'not_found' }

      // Read the roster's own portal_role directly — never approximated
      // from the profile's role, so a genuine split-brain (roster and
      // profile disagreeing) is correctly caught by
      // decideRoleConversionAction rather than papered over.
      // lookupApprovedEmployeeByNormalizedEmail returns null for both "not
      // on the roster" and "the lookup itself failed" (this file's
      // established, already-reviewed convention elsewhere) — for this
      // dry-run preview that only means a rare transient failure is
      // reported as skip_unexpected_current_role rather than a dedicated
      // lookup-failed reason. Never a safety gap: convertManagedEmployeeRole
      // performs its own fresh, correctly-distinguished roster read (with a
      // true 'error' status) before any write at execute time.
      const employee = await lookupApprovedEmployeeByNormalizedEmail(emailNormalized)
      const rosterPortalRole = employee?.portalRole ?? null

      const decision = decideRoleConversionAction({
        rosterPortalRole,
        expectedCurrentPortalRole: entry.expectedCurrentPortalRole,
        newPortalRole: entry.newPortalRole,
        profileLookup,
      })

      // For an entry that also assigns a Manager afterward, additionally
      // preview whether that Manager is currently eligible — so a dry run
      // surfaces the Robert Bauchle prerequisite explicitly, rather than
      // only discovering it at execute time.
      let managerReadiness: string | null = null
      if (entry.assignToManagerEmail) {
        const managerLookup = await findProfileByEmail(normalizeEmail(entry.assignToManagerEmail))
        managerReadiness =
          managerLookup.status === 'found' && managerLookup.profile.role === 'manager' && managerLookup.profile.isActive === true
            ? 'eligible'
            : managerLookup.status === 'found'
              ? `profile exists but is not an active manager (role=${managerLookup.profile.role}, active=${managerLookup.profile.isActive})`
              : managerLookup.status === 'error'
                ? 'lookup_failed'
                : 'no profile yet'
      }

      if (!execute) {
        results.push({
          email: entry.email,
          decision: decision.action,
          status: 'preview',
          message:
            ('reason' in decision ? decision.reason : 'Would convert as shown — no changes made (dry run).') +
            (managerReadiness ? ` Target manager (${entry.assignToManagerEmail}) readiness: ${managerReadiness}.` : ''),
        })
        continue
      }

      if (decision.action !== 'convert') {
        results.push({
          email: entry.email,
          decision: decision.action,
          status: decision.action === 'skip_already_converted' ? 'skipped' : 'error',
          message: 'reason' in decision ? decision.reason : 'Already converted — no action taken.',
        })
        continue
      }

      const outcome = await convertManagedEmployeeRole({
        email: entry.email,
        expectedCurrentPortalRole: entry.expectedCurrentPortalRole,
        newPortalRole: entry.newPortalRole,
        newSubmitsWeeklyReport: entry.newSubmitsWeeklyReport,
      })

      if (outcome.status !== 'ok') {
        results.push({
          email: entry.email,
          decision: decision.action,
          status: 'error',
          message: `Conversion did not complete: ${outcome.status}.`,
        })
        continue
      }

      if (!entry.assignToManagerEmail) {
        results.push({ email: entry.email, decision: decision.action, status: 'full_success', message: 'Role converted.' })
        continue
      }

      // Conversion succeeded and this entry also needs a Manager
      // assignment — same verify-after-write discipline as
      // pre-provision-sales-reps.ts: never report success on the RPC's
      // absence-of-error alone.
      const managerProfileResult = await findProfileByEmail(normalizeEmail(entry.assignToManagerEmail))
      if (managerProfileResult.status !== 'found' || managerProfileResult.profile.role !== 'manager' || managerProfileResult.profile.isActive !== true) {
        results.push({
          email: entry.email,
          decision: decision.action,
          status: 'converted_assignment_failed',
          message: `Role converted, but the target manager (${entry.assignToManagerEmail}) is not currently an active manager profile — no assignment was attempted. Convert again once resolved; the conversion itself will no-op safely.`,
        })
        continue
      }
      const expectedManagerProfileId = managerProfileResult.profile.id

      try {
        const { error: assignError } = await auth.supabase.rpc('assign_sales_rep', {
          p_rep_id: outcome.profileId,
          p_manager_id: expectedManagerProfileId,
        })
        if (assignError) {
          results.push({
            email: entry.email,
            decision: decision.action,
            status: 'converted_assignment_failed',
            message: `Role converted, but assignment failed: ${assignError.message}`,
          })
          continue
        }
      } catch (err) {
        results.push({
          email: entry.email,
          decision: decision.action,
          status: 'converted_assignment_failed',
          message: `Role converted, but assignment threw: ${err instanceof Error ? err.message : 'unknown error'}`,
        })
        continue
      }

      const verification = await findActiveAssignmentForRep(outcome.profileId)
      if (!isAssignmentVerified(verification, expectedManagerProfileId)) {
        results.push({
          email: entry.email,
          decision: decision.action,
          status: 'assignment_unverified',
          message: 'Role converted, assign_sales_rep returned no error, but the active assignment could not be independently confirmed afterward.',
        })
        continue
      }

      results.push({ email: entry.email, decision: decision.action, status: 'full_success', message: 'Role converted and Manager assignment confirmed.' })
    }

    return res.status(200).json({ execute, total: results.length, results })
  } catch (err) {
    console.error('admin/users/convert-role: unexpected error:', err)
    return sendError(res, 500, 'UNKNOWN', 'An unexpected error occurred.')
  }
}

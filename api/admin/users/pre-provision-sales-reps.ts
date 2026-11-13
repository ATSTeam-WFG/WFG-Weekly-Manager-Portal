import { authenticateAdmin } from '../../_lib/adminAuth.js'
import {
  lookupApprovedEmployeeByNormalizedEmail,
  createProfileFromApprovedEmployee,
  finalizePendingManagerAssignment,
  findProfileByUserId,
  findProfileByEmail,
  normalizeEmail,
  findActiveAssignmentForRep,
} from '../../_lib/supabaseServiceClient.js'
import {
  decidePreProvisioningAction,
  isAssignmentVerified,
  type PreProvisioningSnapshot,
  type ManagerProfileLookupStatus,
  type ProfileLookupStatus,
} from '../../_lib/salesRepPreProvisioning.js'
import { APPROVED_PRE_PROVISIONING_ROSTER } from '../../_lib/salesRepPreProvisioningRoster.js'

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
  repEmail: string
  managerEmail: string
  decision: string
  profileCreated: boolean
  assigned: boolean
  status: 'preview' | 'skipped' | 'full_success' | 'profile_created_assignment_failed' | 'assignment_unverified' | 'error'
  message: string
}

// "Pre-Provision Sales Reps" — Admin-ONLY (authenticateAdmin, never
// authenticateAdminOrSalesAdmin/Manager/Sales-Rep-usable — requirement 3).
// Lets an Overall Admin establish a Sales Rep's profiles row and their
// approved Manager assignment BEFORE that rep ever completes first login,
// using the exact same createProfileFromApprovedEmployee function
// complete-profile.ts itself calls at real first login (requirement 1/2:
// never touches auth.users, never touches password_change_required).
//
// assign_sales_rep is called using THIS CALLER's own admin-scoped Supabase
// client (auth.supabase from authenticateAdmin), never the service-role
// client — assign_sales_rep's own is_admin() check resolves auth.uid()
// from whatever client invokes it, and a service-role call has no
// auth.uid() at all. This mirrors exactly how the RPC is already called
// client-side today (src/lib/repReportsService.ts) — the only change is
// that caller is now a backend route acting as the real signed-in admin,
// not the browser.
//
// Fixed, versioned roster data (requirement 9) — never accepts an
// arbitrary roster/mapping from the request body at all.
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

    for (const entry of APPROVED_PRE_PROVISIONING_ROSTER) {
      const repEmailNormalized = normalizeEmail(entry.repEmail)
      const managerEmailNormalized = normalizeEmail(entry.managerEmail)

      const rep = await lookupApprovedEmployeeByNormalizedEmail(repEmailNormalized)

      // Every lookup below is reported as found / not_found-or-none /
      // lookup_failed — never collapsed to a plain boolean/null. A failed
      // lookup must never be treated the same as "doesn't exist" (see
      // decidePreProvisioningAction, which refuses to create or assign
      // anything on a lookup_failed).
      let repProfileLookup: ProfileLookupStatus = { status: 'not_found' }
      if (rep?.authUserId) {
        const repProfileResult = await findProfileByUserId(rep.authUserId)
        repProfileLookup =
          repProfileResult.status === 'found'
            ? { status: 'found' }
            : repProfileResult.status === 'error'
              ? { status: 'lookup_failed' }
              : { status: 'not_found' }
      }

      const managerProfileResult = await findProfileByEmail(managerEmailNormalized)
      const managerProfileLookup: ManagerProfileLookupStatus =
        managerProfileResult.status === 'found'
          ? {
              status: 'found',
              profileId: managerProfileResult.profile.id,
              role: managerProfileResult.profile.role,
              isActive: managerProfileResult.profile.isActive,
            }
          : managerProfileResult.status === 'error'
            ? { status: 'lookup_failed' }
            : { status: 'not_found' }

      // An assignment can only exist once a profile exists — skip the query
      // (rather than misreport it) when the profile lookup itself didn't
      // resolve to 'found'.
      let existingAssignmentLookup: PreProvisioningSnapshot['existingAssignmentLookup'] = { status: 'none' }
      if (repProfileLookup.status === 'found' && rep?.authUserId) {
        existingAssignmentLookup = await findActiveAssignmentForRep(rep.authUserId)
      }

      const snapshot: PreProvisioningSnapshot = {
        repEmail: entry.repEmail,
        repAuthUserId: rep?.authUserId ?? null,
        repPortalRole: rep?.portalRole ?? null,
        repIsActive: rep?.isActive ?? null,
        repProfileLookup,
        managerEmail: entry.managerEmail,
        managerProfileLookup,
        existingAssignmentLookup,
      }

      const decision = decidePreProvisioningAction(snapshot)

      if (!execute) {
        results.push({
          repEmail: entry.repEmail,
          managerEmail: entry.managerEmail,
          decision: decision.action,
          profileCreated: false,
          assigned: false,
          status: 'preview',
          message: 'reason' in decision ? decision.reason : 'Would proceed as shown — no changes made (dry run).',
        })
        continue
      }

      // --- Execute mode below. Every branch reports a specific, honest
      // status — a profile created without its assignment succeeding is
      // NEVER reported as full success (requirement 7). ---

      if (decision.action === 'skip_lookup_failed') {
        results.push({ repEmail: entry.repEmail, managerEmail: entry.managerEmail, decision: decision.action, profileCreated: false, assigned: false, status: 'error', message: decision.reason })
        continue
      }
      if (decision.action === 'skip_already_done') {
        results.push({ repEmail: entry.repEmail, managerEmail: entry.managerEmail, decision: decision.action, profileCreated: false, assigned: false, status: 'skipped', message: 'Already fully provisioned and assigned — no action taken.' })
        continue
      }
      if (
        decision.action === 'skip_rep_not_found_or_ineligible' ||
        decision.action === 'skip_manager_not_found_or_ineligible' ||
        decision.action === 'skip_assignment_conflict_different_manager'
      ) {
        results.push({ repEmail: entry.repEmail, managerEmail: entry.managerEmail, decision: decision.action, profileCreated: false, assigned: false, status: 'skipped', message: decision.reason })
        continue
      }

      let profileCreated = false
      if (decision.action === 'create_profile_and_assign' || decision.action === 'create_profile_only') {
        if (!rep) {
          results.push({ repEmail: entry.repEmail, managerEmail: entry.managerEmail, decision: decision.action, profileCreated: false, assigned: false, status: 'error', message: 'Roster lookup unexpectedly returned null during execution.' })
          continue
        }
        const createdProfile = await createProfileFromApprovedEmployee(rep.authUserId as string, rep)
        if (!createdProfile) {
          results.push({ repEmail: entry.repEmail, managerEmail: entry.managerEmail, decision: decision.action, profileCreated: false, assigned: false, status: 'error', message: 'Profile creation failed — see server logs. No assignment was attempted.' })
          continue
        }
        profileCreated = true
        // Best-effort, same discipline as elsewhere in this endpoint — the
        // profile is already created regardless of this call's outcome. A
        // no-op unless a Manager's own "Add Sales Rep" pending claim (see
        // inviteSalesRepAsManager) is waiting for exactly this rep; if this
        // Admin batch also assigns the rep below (create_profile_and_assign),
        // that explicit assignment simply reassigns it afterward — the
        // Admin's own choice of manager still wins.
        try {
          await finalizePendingManagerAssignment(rep.authUserId as string)
        } catch (err) {
          console.error('pre-provision-sales-reps: finalizePendingManagerAssignment threw unexpectedly:', err)
        }
      }

      if (decision.action === 'create_profile_only') {
        results.push({ repEmail: entry.repEmail, managerEmail: entry.managerEmail, decision: decision.action, profileCreated: true, assigned: false, status: 'profile_created_assignment_failed', message: 'Profile created. Manager is not currently eligible, so no assignment was attempted — this is not a failure, assign later once resolved.' })
        continue
      }

      // create_profile_and_assign or assign_only: attempt the assignment,
      // using the CALLER's own admin-scoped client (never service-role —
      // see the function header comment for why this matters).
      const expectedManagerProfileId = managerProfileLookup.status === 'found' ? managerProfileLookup.profileId : null
      try {
        const { error: assignError } = await auth.supabase.rpc('assign_sales_rep', {
          p_rep_id: rep?.authUserId,
          p_manager_id: expectedManagerProfileId,
        })
        if (assignError) {
          results.push({
            repEmail: entry.repEmail,
            managerEmail: entry.managerEmail,
            decision: decision.action,
            profileCreated,
            assigned: false,
            status: profileCreated ? 'profile_created_assignment_failed' : 'error',
            message: `Assignment failed: ${assignError.message}`,
          })
          continue
        }
      } catch (err) {
        results.push({
          repEmail: entry.repEmail,
          managerEmail: entry.managerEmail,
          decision: decision.action,
          profileCreated,
          assigned: false,
          status: profileCreated ? 'profile_created_assignment_failed' : 'error',
          message: `Assignment threw: ${err instanceof Error ? err.message : 'unknown error'}`,
        })
        continue
      }

      // assign_sales_rep returned no error — but never trust that alone.
      // Independently re-read the assignment before ever reporting
      // full_success (requirement 3).
      const verification = await findActiveAssignmentForRep(rep?.authUserId as string)
      if (!isAssignmentVerified(verification, expectedManagerProfileId)) {
        results.push({
          repEmail: entry.repEmail,
          managerEmail: entry.managerEmail,
          decision: decision.action,
          profileCreated,
          assigned: false,
          status: 'assignment_unverified',
          message: 'assign_sales_rep returned no error, but the active assignment could not be independently confirmed afterward. Verify and retry manually.',
        })
        continue
      }

      results.push({ repEmail: entry.repEmail, managerEmail: entry.managerEmail, decision: decision.action, profileCreated, assigned: true, status: 'full_success', message: 'Profile and assignment both confirmed.' })
    }

    return res.status(200).json({ execute, total: results.length, results })
  } catch (err) {
    console.error('admin/users/pre-provision-sales-reps: unexpected error:', err)
    return sendError(res, 500, 'UNKNOWN', 'An unexpected error occurred.')
  }
}

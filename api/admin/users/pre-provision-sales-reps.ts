import { authenticateAdmin } from '../../_lib/adminAuth.js'
import {
  lookupApprovedEmployeeByNormalizedEmail,
  createProfileFromApprovedEmployee,
  findProfileByUserId,
  findProfileByEmail,
  normalizeEmail,
  hasActiveAssignmentToManager,
} from '../../_lib/supabaseServiceClient.js'
import { decidePreProvisioningAction, type PreProvisioningSnapshot } from '../../_lib/salesRepPreProvisioning.js'
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
  status: 'preview' | 'skipped' | 'full_success' | 'profile_created_assignment_failed' | 'error'
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
      const managerProfileLookup = await findProfileByEmail(managerEmailNormalized)
      const managerProfile = managerProfileLookup.status === 'found' ? managerProfileLookup.profile : null

      let repProfileExists = false
      if (rep?.authUserId) {
        const repProfileLookup = await findProfileByUserId(rep.authUserId)
        repProfileExists = repProfileLookup.status === 'found'
      }

      let activeAssignmentToThisManagerExists = false
      if (rep?.authUserId && repProfileExists && managerProfile) {
        activeAssignmentToThisManagerExists = (await hasActiveAssignmentToManager(rep.authUserId, managerProfile.id)) === true
      }

      const snapshot: PreProvisioningSnapshot = {
        repEmail: entry.repEmail,
        repAuthUserId: rep?.authUserId ?? null,
        repPortalRole: rep?.portalRole ?? null,
        repIsActive: rep?.isActive ?? null,
        repProfileExists,
        managerEmail: entry.managerEmail,
        managerProfileId: managerProfile?.id ?? null,
        managerRole: managerProfile?.role ?? null,
        managerIsActive: managerProfile?.isActive ?? null,
        activeAssignmentToThisManagerExists,
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

      if (decision.action === 'skip_already_done') {
        results.push({ repEmail: entry.repEmail, managerEmail: entry.managerEmail, decision: decision.action, profileCreated: false, assigned: false, status: 'skipped', message: 'Already fully provisioned and assigned — no action taken.' })
        continue
      }
      if (decision.action === 'skip_rep_not_found_or_ineligible' || decision.action === 'skip_manager_not_found_or_ineligible') {
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
      }

      if (decision.action === 'create_profile_only') {
        results.push({ repEmail: entry.repEmail, managerEmail: entry.managerEmail, decision: decision.action, profileCreated: true, assigned: false, status: 'profile_created_assignment_failed', message: 'Profile created. Manager is not currently eligible, so no assignment was attempted — this is not a failure, assign later once resolved.' })
        continue
      }

      // create_profile_and_assign or assign_only: attempt the assignment,
      // using the CALLER's own admin-scoped client (never service-role —
      // see the function header comment for why this matters).
      try {
        const { error: assignError } = await auth.supabase.rpc('assign_sales_rep', {
          p_rep_id: rep?.authUserId,
          p_manager_id: snapshot.managerProfileId,
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

      results.push({ repEmail: entry.repEmail, managerEmail: entry.managerEmail, decision: decision.action, profileCreated, assigned: true, status: 'full_success', message: 'Profile and assignment both confirmed.' })
    }

    return res.status(200).json({ execute, total: results.length, results })
  } catch (err) {
    console.error('admin/users/pre-provision-sales-reps: unexpected error:', err)
    return sendError(res, 500, 'UNKNOWN', 'An unexpected error occurred.')
  }
}

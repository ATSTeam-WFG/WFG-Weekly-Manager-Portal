import { authenticateAdmin } from '../../_lib/adminAuth.js'
import {
  lookupApprovedEmployeeByNormalizedEmail,
  createProfileFromApprovedEmployee,
  findProfileByUserId,
  normalizeEmail,
} from '../../_lib/supabaseServiceClient.js'
import { decideManagerPreProvisioningAction, type ManagerPreProvisioningSnapshot } from '../../_lib/managerProfilePreProvisioning.js'

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

// Fixed, single target — Robert Bauchle only, never a client-supplied
// email. He already has a Manager Auth account (approved_employees row,
// auth_user_id set) but no profiles row yet, since he has not completed
// first login. This is the one prerequisite Austin Rozier's Sales Rep
// conversion needs: assign_sales_rep requires its target manager to
// already have an active profiles row with role = 'manager'.
const TARGET_EMAIL = 'rbauchle@wfgtitle.com'

// "Pre-Provision Manager Profile" — Admin-ONLY. Creates exactly one
// Manager's profiles row ahead of their first login, using the same
// createProfileFromApprovedEmployee function complete-profile.ts calls at
// real first login (never touches auth.users, never touches
// password_change_required). No assignment step — this endpoint only ever
// creates a profile, nothing else.
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

    const emailNormalized = normalizeEmail(TARGET_EMAIL)
    const employee = await lookupApprovedEmployeeByNormalizedEmail(emailNormalized)

    let profileLookup: ManagerPreProvisioningSnapshot['profileLookup'] = { status: 'not_found' }
    if (employee?.authUserId) {
      const result = await findProfileByUserId(employee.authUserId)
      profileLookup =
        result.status === 'found' ? { status: 'found' } : result.status === 'error' ? { status: 'lookup_failed' } : { status: 'not_found' }
    }

    const snapshot: ManagerPreProvisioningSnapshot = {
      employeeAuthUserId: employee?.authUserId ?? null,
      employeePortalRole: employee?.portalRole ?? null,
      employeeIsActive: employee?.isActive ?? null,
      profileLookup,
    }

    const decision = decideManagerPreProvisioningAction(snapshot)

    if (!execute) {
      return res.status(200).json({
        execute: false,
        email: TARGET_EMAIL,
        decision: decision.action,
        message: 'reason' in decision ? decision.reason : 'Would create the profile — no changes made (dry run).',
      })
    }

    if (decision.action !== 'create_profile') {
      return res.status(200).json({
        execute: true,
        email: TARGET_EMAIL,
        decision: decision.action,
        status: decision.action === 'skip_already_done' ? 'skipped' : 'error',
        message: 'reason' in decision ? decision.reason : 'Already provisioned — no action taken.',
      })
    }

    const createdProfile = await createProfileFromApprovedEmployee(employee!.authUserId as string, employee!)
    if (!createdProfile) {
      return res.status(200).json({
        execute: true,
        email: TARGET_EMAIL,
        decision: decision.action,
        status: 'error',
        message: 'Profile creation failed — see server logs.',
      })
    }

    return res.status(200).json({
      execute: true,
      email: TARGET_EMAIL,
      decision: decision.action,
      status: 'full_success',
      profileId: createdProfile.id,
      message: 'Profile created.',
    })
  } catch (err) {
    console.error('admin/users/pre-provision-manager-profile: unexpected error:', err)
    return sendError(res, 500, 'UNKNOWN', 'An unexpected error occurred.')
  }
}

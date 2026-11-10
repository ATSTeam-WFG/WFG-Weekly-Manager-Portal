// Pure decision logic for converting ONE named, existing Manager/Admin
// account to a different role (Sales Admin or Sales Rep) — distinct from
// salesRepPreProvisioning.ts, which only ever creates a NEW profile. This
// never creates anything; it only decides whether an EXISTING profile +
// roster row may safely be updated in place.

export type RoleConversionProfileLookup =
  | { status: 'found'; role: string | null }
  | { status: 'not_found' }
  | { status: 'lookup_failed' }

export interface RoleConversionSnapshot {
  rosterPortalRole: string | null
  expectedCurrentPortalRole: 'manager' | 'admin'
  newPortalRole: 'sales_rep' | 'sales_admin'
  profileLookup: RoleConversionProfileLookup
}

export type RoleConversionAction =
  | { action: 'skip_lookup_failed'; reason: string }
  | { action: 'skip_already_converted' }
  | { action: 'skip_unexpected_current_role'; reason: string }
  | { action: 'skip_no_profile_yet'; reason: string }
  | { action: 'convert' }

export function decideRoleConversionAction(snapshot: RoleConversionSnapshot): RoleConversionAction {
  if (snapshot.profileLookup.status === 'lookup_failed') {
    return { action: 'skip_lookup_failed', reason: 'Could not read the current profile — the database lookup failed.' }
  }

  // Already-converted is checked BEFORE the "unexpected role" check so a
  // second, retried call against an already-completed conversion is a
  // clean no-op, not an error.
  const rosterAlreadyConverted = snapshot.rosterPortalRole === snapshot.newPortalRole
  const profileAlreadyConverted = snapshot.profileLookup.status === 'found' && snapshot.profileLookup.role === snapshot.newPortalRole
  if (rosterAlreadyConverted && profileAlreadyConverted) {
    return { action: 'skip_already_converted' }
  }

  if (snapshot.rosterPortalRole !== snapshot.expectedCurrentPortalRole) {
    return {
      action: 'skip_unexpected_current_role',
      reason: `Roster role is '${snapshot.rosterPortalRole}', expected '${snapshot.expectedCurrentPortalRole}' — refusing to convert from an unanticipated state.`,
    }
  }

  if (snapshot.profileLookup.status === 'not_found') {
    return { action: 'skip_no_profile_yet', reason: 'No profiles row exists yet for this person — nothing to convert.' }
  }

  if (snapshot.profileLookup.role !== snapshot.expectedCurrentPortalRole) {
    return {
      action: 'skip_unexpected_current_role',
      reason: `Profile role is '${snapshot.profileLookup.role}', expected '${snapshot.expectedCurrentPortalRole}' — refusing to convert from an unanticipated state.`,
    }
  }

  return { action: 'convert' }
}

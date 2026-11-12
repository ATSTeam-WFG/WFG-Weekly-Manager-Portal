import { createClient, type SupabaseClient } from '@supabase/supabase-js'

interface ManagerAuthConfig {
  supabaseUrl: string | undefined
  supabasePublishableKey: string | undefined
  authorizationHeader: string | string[] | undefined
}

export interface ManagerAuthSuccess {
  ok: true
  supabase: SupabaseClient
  userId: string
}

export interface ManagerAuthFailure {
  ok: false
  status: number
  code: string
  message: string
}

export type ManagerAuthResult = ManagerAuthSuccess | ManagerAuthFailure

// Dedicated active-Manager authentication for future narrowly scoped
// Manager endpoints. Uses the caller's own publishable-key client, never a
// service-role client, and rechecks the profile role/active flag on each
// request. No endpoint should trust a manager id supplied by the browser.
export async function authenticateManager(config: ManagerAuthConfig): Promise<ManagerAuthResult> {
  const { supabaseUrl, supabasePublishableKey, authorizationHeader } = config
  if (!supabaseUrl || !supabasePublishableKey) {
    return { ok: false, status: 500, code: 'SERVER_MISCONFIGURED', message: 'Server is missing required configuration.' }
  }

  const header = Array.isArray(authorizationHeader) ? authorizationHeader[0] : authorizationHeader
  if (!header?.startsWith('Bearer ')) {
    return { ok: false, status: 401, code: 'UNAUTHORIZED', message: 'Missing or invalid Authorization header.' }
  }
  const token = header.slice('Bearer '.length).trim()
  if (!token) return { ok: false, status: 401, code: 'UNAUTHORIZED', message: 'Missing access token.' }

  const supabase = createClient(supabaseUrl, supabasePublishableKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false },
  })
  const { data: userData, error: userError } = await supabase.auth.getUser(token)
  if (userError || !userData.user) {
    return { ok: false, status: 401, code: 'UNAUTHORIZED', message: 'Invalid or expired session.' }
  }
  if (userData.user.app_metadata?.password_change_required === true) {
    return { ok: false, status: 403, code: 'PASSWORD_CHANGE_REQUIRED', message: 'You must set your own password before continuing.' }
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('role, is_active')
    .eq('id', userData.user.id)
    .maybeSingle()
  if (profileError) {
    console.error('managerAuth: profile lookup failed:', profileError.message)
    return { ok: false, status: 500, code: 'PROFILE_LOOKUP_FAILED', message: 'Could not verify Manager access.' }
  }
  if (!profile || profile.role !== 'manager' || profile.is_active !== true) {
    return { ok: false, status: 403, code: 'FORBIDDEN', message: 'Active Manager access is required.' }
  }

  return { ok: true, supabase, userId: userData.user.id }
}

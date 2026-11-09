import { createClient } from '@supabase/supabase-js'

const LOCAL_URL = 'http://127.0.0.1:54321'
// Read from the environment rather than hardcoding — `supabase status`
// prints this same local-stack service_role key for your own disposable
// container; export it before running this script:
//   export LOCAL_SUPABASE_SECRET_KEY=<service_role key from `supabase status`>
const LOCAL_SECRET = process.env.LOCAL_SUPABASE_SECRET_KEY

if (!LOCAL_URL.includes('127.0.0.1') && !LOCAL_URL.includes('localhost')) {
  console.error('REFUSING: this script only runs against 127.0.0.1/localhost.')
  process.exit(1)
}

if (!LOCAL_SECRET) {
  console.error(
    'REFUSING: LOCAL_SUPABASE_SECRET_KEY is not set.\n' +
      "Export your local disposable stack's own key (from `supabase status`) before running this script.",
  )
  process.exit(1)
}

const service = createClient(LOCAL_URL, LOCAL_SECRET, { auth: { persistSession: false } })

const { data: candidates, error: candidatesError } = await service
  .from('approved_employees')
  .select('full_name, email, email_normalized, portal_role, is_active, auth_user_id, submits_weekly_report')
  .in('portal_role', ['manager', 'sales_rep'])
  .eq('is_active', true)
  .not('auth_user_id', 'is', null)
  .order('portal_role', { ascending: true })
  .order('full_name', { ascending: true })
console.log('candidatesError:', candidatesError)
console.log('candidates:', candidates)

const { data: existingProfiles, error: profilesError } = await service.from('profiles').select('id')
console.log('profilesError:', profilesError)
console.log('existingProfiles count:', existingProfiles?.length)

import { supabase } from './supabaseClient'
import type { Profile } from '../types'

export async function fetchProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, role, is_active')
    .eq('id', userId)
    .maybeSingle()

  if (error) {
    console.error('Failed to fetch profile from Supabase:', error.message)
    return null
  }
  if (!data) return null

  return {
    id: data.id,
    fullName: data.full_name,
    role: data.role,
    isActive: data.is_active,
  }
}

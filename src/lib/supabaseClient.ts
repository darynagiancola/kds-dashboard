import { createClient } from '@supabase/supabase-js'

const normalizeEnvValue = (value: string | undefined): string => {
  if (!value) {
    return ''
  }

  const trimmed = value.trim()
  return trimmed.replace(/^['"]|['"]$/g, '')
}

const supabaseUrl = normalizeEnvValue(import.meta.env.VITE_SUPABASE_URL)
const supabaseAnonKey = normalizeEnvValue(import.meta.env.VITE_SUPABASE_ANON_KEY)

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey)

export const supabase =
  isSupabaseConfigured
    ? createClient(supabaseUrl, supabaseAnonKey)
    : null

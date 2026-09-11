import { createClient } from '@supabase/supabase-js';

export const supabaseUrl = String(import.meta.env.VITE_SUPABASE_URL || '').trim().replace(/\/$/, '');
export const supabaseAnonKey = String(import.meta.env.VITE_SUPABASE_ANON_KEY || '').trim();

export const supabaseConfigError =
  !supabaseUrl
    ? 'SUPABASE_CONFIG_MISSING: VITE_SUPABASE_URL est absente. Configure le GitHub Repository Secret VITE_SUPABASE_URL.'
    : !supabaseAnonKey
      ? 'SUPABASE_CONFIG_MISSING: VITE_SUPABASE_ANON_KEY est absente. Configure le GitHub Repository Secret VITE_SUPABASE_ANON_KEY.'
      : null;

export const supabase = createClient(
  supabaseUrl || 'https://placeholder.supabase.co',
  supabaseAnonKey || 'placeholder-anon-key',
  {
    auth: {
      persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    },
  },
);

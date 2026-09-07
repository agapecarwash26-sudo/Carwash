import { createClient } from '@supabase/supabase-js';

// Production Supabase configuration is injected at build time by GitHub Actions
// from Repository Secrets. Never fall back to another Supabase project.
export const supabaseUrl = String(import.meta.env.VITE_SUPABASE_URL || '').trim().replace(/\/$/, '');
export const supabaseAnonKey = String(import.meta.env.VITE_SUPABASE_ANON_KEY || '').trim();

if (!supabaseUrl) {
  throw new Error('SUPABASE_CONFIG_MISSING: VITE_SUPABASE_URL est absente. Configure le GitHub Repository Secret VITE_SUPABASE_URL.');
}

if (!supabaseAnonKey) {
  throw new Error('SUPABASE_CONFIG_MISSING: VITE_SUPABASE_ANON_KEY est absente. Configure le GitHub Repository Secret VITE_SUPABASE_ANON_KEY.');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

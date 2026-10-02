import { createClient } from '@supabase/supabase-js';

// GitHub Pages builds do not load the local .env file because .env is intentionally
// ignored by git. Keep the public Supabase project configuration available at build
// time, while still allowing Vite environment variables to override it.
const DEFAULT_SUPABASE_URL = 'https://khjsfumvdcrgfkcuhiaa.supabase.co';
const DEFAULT_SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtoanNmdW12ZGNyZ2ZrY3VoaWFhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc3MTg1ODYsImV4cCI6MjEwMzI5NDU4Nn0.L3w1JFgcoLBYpX1tUkA6i1urtzPtG4gOVim994tBkY0';

export const supabaseUrl =
  import.meta.env.VITE_SUPABASE_URL ||
  import.meta.env.SUPABASE_URL ||
  DEFAULT_SUPABASE_URL;

export const supabaseAnonKey =
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  import.meta.env.SUPABASE_ANON_KEY ||
  DEFAULT_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('SUPABASE_CONFIG_MISSING: configuration Supabase introuvable.');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

/**
 * Supabase configuration for browser code.
 *
 * Vite exposes client variables only when they use the VITE_ prefix.
 * The fallback values keep the production app from crashing when a hosting
 * provider does not inject build-time environment variables. These are the
 * public Supabase URL and anon key used by the browser; RLS remains mandatory.
 */
const FALLBACK_SUPABASE_URL = 'https://khjsfumvdcrgfkcuhiaa.supabase.co';
const FALLBACK_SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtoanNmdW12ZGNyZ2ZrY3VoaWFhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc3MTg1ODYsImV4cCI6MjEwMzI5NDU4Nn0.L3w1JFgcoLBYpX1tUkA6i1urtzPtG4gOVim994tBkY0';

export const SUPABASE_URL = String(
  import.meta.env.VITE_SUPABASE_URL || FALLBACK_SUPABASE_URL
).trim();

export const SUPABASE_ANON_KEY = String(
  import.meta.env.VITE_SUPABASE_ANON_KEY || FALLBACK_SUPABASE_ANON_KEY
).trim();

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error('Configuration Supabase absente : VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY.');
}

export function getSupabaseFunctionUrl(functionName: string) {
  return `${SUPABASE_URL}/functions/v1/${functionName}`;
}

import { createClient } from '@supabase/supabase-js';

const supabaseUrl =
  import.meta.env.VITE_SUPABASE_URL ??
  import.meta.env.SUPABASE_URL ??
  'https://khjsfumvdcrgfkcuhiaa.supabase.co';

const supabaseAnonKey =
  import.meta.env.VITE_SUPABASE_ANON_KEY ??
  import.meta.env.SUPABASE_ANON_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtoanNmdW12ZGNyZ2ZrY3VoaWFhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc3MTg1ODYsImV4cCI6MjEwMzI5NDU4Nn0.L3w1JFgcoLBYpX1tUkA6i1urtzPtG4gOVim994tBkY0';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

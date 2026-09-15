#!/usr/bin/env bash
set -euo pipefail

echo '=== Local canonical migration files ==='
find supabase/migrations -maxdepth 1 -type f -printf '%f\n' | sort

echo
if command -v supabase >/dev/null 2>&1; then
  echo '=== Supabase migration history ==='
  supabase migration list || true
else
  echo 'Supabase CLI not installed; skipping remote comparison.'
fi

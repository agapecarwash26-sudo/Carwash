#!/usr/bin/env bash
set -euo pipefail

echo '=== Local migration files ==='
find supabase/migrations -maxdepth 1 -type f -printf '%f\n' | sort

echo
echo '=== Remote vs local migration history ==='
supabase migration list

echo
echo 'If versions exist remotely but not locally, repair/fetch them before Preview.'
echo 'See docs/SUPABASE_PREVIEW_MIGRATION_REPAIR.md'

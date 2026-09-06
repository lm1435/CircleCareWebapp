#!/usr/bin/env bash
#
# FE <-> BE round trip, once per VIEWER timezone.
#
# The unit sweep (run-unit-timezones.sh) proves the conversion pair against
# Postgres' tzdata. This proves the same property through the real API, the real
# DATE/TIME columns and the backend's own recurrence materializer.
#
# The viewer zone is the PROCESS zone here too, and it matters just as much: a
# deliberately broken span rule passes this suite under America/Denver AND under
# Pacific/Midway, and only fails under Asia/Tokyo — where a Chatham or Auckland
# recipient's series comes back with 31 doses instead of 30 because NZ enters
# DST mid-series. One zone is not a test.
#
# Requires:
#   - backend on :3001            (cd ../backend && npm run dev)
#   - supabase on :55321          (supabase start)
#   - cross-timezone circles       (cd ../mobile && node scripts/seed-cross-timezone.mjs)
#
# Usage: scripts/run-integration-timezones.sh
set -uo pipefail
cd "$(dirname "$0")/.."

if ! curl -sf --max-time 3 http://localhost:3001/health >/dev/null; then
  echo "backend not answering on :3001 — start it first" >&2
  exit 2
fi

ANON="${VITE_SUPABASE_ANON_KEY:-$(grep -E '^VITE_SUPABASE_ANON_KEY' .env.development | cut -d= -f2-)}"

# Viewer zones chosen for what they expose, not for coverage: Tokyo is the one
# that catches the span rule, Midway sits west of every recipient, Kiritimati is
# +14, Chatham is a quarter-hour offset, St_Johns is -3:30 with DST.
ZONES=(
  America/Denver
  UTC
  Asia/Tokyo
  Pacific/Midway
  Pacific/Kiritimati
  Pacific/Chatham
  America/St_Johns
)

failed=()
declare -a SUMMARY
for zone in "${ZONES[@]}"; do
  printf '\n\033[1m━━━ viewer TZ=%s ━━━\033[0m\n' "$zone"
  if TZ="$zone" INTEGRATION=1 VITE_SUPABASE_ANON_KEY="$ANON" npx vitest run src/__integration__; then
    SUMMARY+=("  PASS  $zone")
  else
    SUMMARY+=("  FAIL  $zone")
    failed+=("$zone")
  fi
done

printf '\n\033[1m━━━ integration sweep ━━━\033[0m\n'
printf '%s\n' "${SUMMARY[@]}"
if [ ${#failed[@]} -gt 0 ]; then
  printf '\n\033[31m%d of %d viewer zones FAILED: %s\033[0m\n' "${#failed[@]}" "${#ZONES[@]}" "${failed[*]}"
  exit 1
fi
printf '\n\033[32mall %d viewer zones passed\033[0m\n' "${#ZONES[@]}"

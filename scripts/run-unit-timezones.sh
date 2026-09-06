#!/usr/bin/env bash
#
# Run the vitest suite once per DEVICE timezone.
#
# The device zone is the PROCESS zone, and JS cannot change it at runtime — so a
# single run only ever exercises ONE side of every device/recipient pairing. On
# mobile, the bug that generated a 31st occurrence for a "30 day" series was
# completely invisible under America/Denver and only appeared under
# Asia/Tokyo. A green single-zone run proves very little about timezone code.
#
# The zones below are chosen to cover the shapes that break naive
# implementations, not to be a broad sample:
#
#   America/Denver     the dev machine, DST, the baseline everything was
#                      written under
#   UTC                zero offset; also where `-getTimezoneOffset()` is
#                      NEGATIVE ZERO, which `Object.is` separates from 0
#   Asia/Tokyo         +9, no DST, far enough east to roll the calendar day
#   Pacific/Auckland   +12/+13, SOUTHERN-hemisphere DST (transitions in the
#                      opposite direction from the northern zones)
#   Pacific/Midway     -11, far enough WEST that a device-frame instant lands
#                      on the day AFTER the recipient's
#   Pacific/Kiritimati +14, the extreme east; the zone the old hour-of-day
#                      offset fold reported as -10
#   Pacific/Chatham    +12:45, quarter-hour offset AND southern DST
#   Asia/Kathmandu     +5:45, quarter-hour offset
#   Asia/Kolkata       +5:30, half-hour offset. NOTE: ICU resolves this to the
#                      legacy alias Asia/Calcutta, so anything keyed by the
#                      canonical name will miss — resolve zones by BEHAVIOUR
#                      (matching offsets), never by a name table
#   America/St_Johns   -3:30, a half-hour offset that ALSO observes DST
#
# Usage:
#   scripts/run-unit-timezones.sh                  # whole suite, every zone
#   scripts/run-unit-timezones.sh src/utils        # narrow to a path
#
# Exits non-zero if any zone fails, and prints a per-zone summary at the end.

set -uo pipefail
cd "$(dirname "$0")/.."

ZONES=(
  America/Denver
  UTC
  Asia/Tokyo
  Pacific/Auckland
  Pacific/Midway
  Pacific/Kiritimati
  Pacific/Chatham
  Asia/Kathmandu
  Asia/Kolkata
  America/St_Johns
)

# `set -u` treats an empty array expansion as unbound on bash 3.2 (macOS).
TARGET=("$@")
if [ $# -eq 0 ]; then TARGET=(); fi
failed=()
declare -a SUMMARY

# THE COUNTS, NOT JUST THE EXIT CODE.
#
# A green sweep proves every zone AGREED, not that anything ran. A suite renamed
# out of vitest's include globs, a path added to exclude, or a deleted file
# leaves all ten zones reporting the same smaller number while this script
# prints "all 10 zones passed". Mobile's equivalent carries this floor and
# states the rule: ADDING tests means raising these deliberately, in a diff
# someone reviews; LOSING tests fails.
#
# THE FLOOR MUST BE RE-MEASURED IN THE SAME DIFF THAT ADDS TESTS. It went stale
# once already and the slack is what makes that dangerous, not the staleness:
# at 147/1768 against an actual 151/1856 there were 88 tests of headroom, so a
# suite could lose the whole cross-zone conversion block — 42 assertions — and
# still clear the floor in all ten zones while the script printed "all 10 zones
# passed". A floor with slack is not a floor.
#
# Measured 2026-09-05 (K6/I3 source sweep, `npx vitest run`, America/Denver):
# 220 files total (219 passed, 1 skipped) / 3518 tests total (3511 passed, 7
# skipped, 0 failing). Below, MIN_FILES and MIN_TESTS are each set against the
# TOTAL just given (skips included — a skip is still a test that exists), not
# the passed count, because the parenthesised total is what `tests`/`files`
# below actually parse out of vitest's summary line and compare against:
# MIN_FILES = 220 - 5 = 215, MIN_TESTS = 3518 - 50 = 3468. Re-measure in the
# same diff that adds or removes tests; the count must not vary by zone, or
# the floor has to track the minimum and a zone-dependent skip is hiding
# inside it.
MIN_FILES="${MIN_FILES:-215}"
MIN_TESTS="${MIN_TESTS:-3468}"
low=""

for zone in "${ZONES[@]}"; do
  printf '\n\033[1m━━━ TZ=%s ━━━\033[0m\n' "$zone"
  out=$(TZ="$zone" npx vitest run ${TARGET[@]+"${TARGET[@]}"} 2>&1)
  status=$?
  printf '%s\n' "$out"
  if [ $status -eq 0 ]; then
    SUMMARY+=("  PASS  $zone")
  else
    SUMMARY+=("  FAIL  $zone")
    failed+=("$zone")
  fi

  # vitest prints "Test Files  N passed | M skipped (T)"; the parenthesised
  # total is the one that matters, since a skip is still a test that exists.
  # STRIP ANSI FIRST. vitest colours its summary when FORCE_COLOR is set even
  # though this output is captured rather than a TTY, and the counts then never
  # parse — turning a colour setting into a false "below the floor". Mobile's
  # sweep hit exactly that with FORCE_COLOR=3 in the environment.
  plain=$(printf '%s' "$out" | sed -E 's/\x1b\[[0-9;]*[A-Za-z]//g')
  files=$(printf '%s' "$plain" | grep -E '^ *Test Files' | sed -E 's/.*\(([0-9]+)\).*/\1/')
  tests=$(printf '%s' "$plain" | grep -E '^ *Tests ' | sed -E 's/.*\(([0-9]+)\).*/\1/')
  case "$tests" in ''|*[!0-9]*) low="$low $zone(no test count)";; *)
    [ "$tests" -lt "$MIN_TESTS" ] && low="$low $zone($tests tests < $MIN_TESTS)";; esac
  case "$files" in ''|*[!0-9]*) low="$low $zone(no file count)";; *)
    [ "$files" -lt "$MIN_FILES" ] && low="$low $zone($files files < $MIN_FILES)";; esac
done

printf '\n\033[1m━━━ device-timezone sweep ━━━\033[0m\n'
printf '%s\n' "${SUMMARY[@]}"

if [ ${#failed[@]} -gt 0 ]; then
  printf '\n\033[31m%d of %d zones FAILED: %s\033[0m\n' \
    "${#failed[@]}" "${#ZONES[@]}" "${failed[*]}"
  exit 1
fi
if [ -n "$low" ]; then
  printf '\n\033[31mBELOW THE COMMITTED FLOOR:%s\033[0m\n' "$low"
  echo "Every zone can agree on a number that is simply too small. If the drop"
  echo "is intentional, lower MIN_FILES/MIN_TESTS in this script in the same"
  echo "commit. If it is not, you just found the bug."
  exit 1
fi
printf '\n\033[32mall %d zones passed\033[0m\n' "${#ZONES[@]}"

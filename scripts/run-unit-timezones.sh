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
#
# RE-MEASURED 2026-09-12 (CI setup): 215/3468 -> 254/4208. The 2026-09-05 line
# above had gone stale by 39 files and 783 tests, which is the precise thing the
# paragraph above it says is dangerous — not the staleness, the SLACK. At
# 215/3468 against an actual 259/4258, seven hundred and eighty-three tests
# could have vanished in EVERY zone and this script would still have printed
# "all 10 zones passed", because the cross-zone comparison only sees a loss that
# affects SOME zones. The floor is the only check that sees a uniform loss, and
# a floor with that much headroom is not a floor.
#
# Measured under node 24.20.0 (.nvmrc), `npx vitest run`, TZ=America/Denver:
# 258 passed | 1 skipped (259) files / 4251 passed | 7 skipped (4258) tests,
# exit 0. Set against the TOTALS, per the paragraph above (skips included — a
# skip is still a test that exists, and the parenthesised total is what the
# `files`/`tests` parsing below actually reads): MIN_FILES = 259 - 5 = 254,
# MIN_TESTS = 4258 - 50 = 4208.
#
# CAVEAT recorded with that measurement, and the reason the floor was set from
# the stable number rather than the highest one seen. Confirmed by running THIS
# SCRIPT: the first EIGHT zones (America/Denver, UTC, Asia/Tokyo,
# Pacific/Auckland, Pacific/Midway, Pacific/Kiritimati, Pacific/Chatham,
# Asia/Kathmandu) all reported exactly 259 files / 4258 tests and passed. The
# last two (Asia/Kolkata, America/St_Johns) reported 260 files / 4262 tests and
# FAILED, because another agent working in this same tree created
# src/components/ui/__tests__/pickerSheet.test.tsx partway through the sweep —
# a mid-TDD file, red at the moment it was picked up. That is a concurrent-tree
# artefact, not a zone-dependent failure: the extra file appears in the two
# zones that ran after it was written and in no others, and its failures are the
# same four/three cases each time rather than anything offset-shaped. Minutes
# later that file was green and a single-zone `npm test` read 260 files / 4267
# tests. The floor was deliberately set from the 259/4258 figure instead: that
# is the one confirmed identical across eight zones, and a floor is a MINIMUM,
# so the conservative number is the safe one to commit while the tree is moving.
# That note ended "once pickerSheet.test.tsx settles, RAISE this floor" — which
# is the entry below.
#
# RE-MEASURED 2026-09-12 (tree settled): 254/4208 -> 257/4230. The tree stopped
# moving, so the conservative-while-concurrent number above is now just slack,
# and slack is the failure mode this whole comment block exists to describe: a
# cross-zone sweep can only see a loss that affects SOME zones, so the floor is
# the ONLY check that catches a uniform one, and at 254/4208 against an actual
# 262/4280 seventy-two tests could have vanished in every zone with the script
# still printing "all 10 zones passed".
#
# Measured under node 24.20.0 (.nvmrc) by running THIS SCRIPT end to end —
# cross-zone verified, not a single-zone reading. All TEN zones reported the
# identical 261 passed | 1 skipped (262) files / 4273 passed | 7 skipped (4280)
# tests and PASSED; no zone-dependent skip is hiding inside the number this
# time. Set against the TOTALS per the convention above (skips included — a skip
# is still a test that exists, and the parenthesised total is what the
# `files`/`tests` parsing below actually reads): MIN_FILES = 262 - 5 = 257,
# MIN_TESTS = 4280 - 50 = 4230.
#
# RE-MEASURED 2026-09-13 (test-hardening pass): 257/4230 -> 258/4266. Tests that
# could not fail were rewritten to fail under the mutation they claim to guard,
# which added cases and one file (posthogInitOptions.test.ts). Measured by
# running THIS SCRIPT end to end: all TEN zones reported the identical
# 262 passed | 1 skipped (263) files / 4309 passed | 7 skipped (4316) tests and
# PASSED. Set against the TOTALS per the convention above: MIN_FILES = 263 - 5 =
# 258, MIN_TESTS = 4316 - 50 = 4266.
#
# RE-MEASURED 2026-09-13 (after the independent re-audit of the hardened
# tests): 258/4266 -> 259/4346. The re-audit's fixes added cases and one file
# (sourceText.test.ts). Measured by running THIS SCRIPT end to end: all TEN
# zones reported the identical 263 passed | 1 skipped (264) files / 4389 passed |
# 7 skipped (4396) tests and PASSED. MIN_FILES = 264 - 5 = 259, MIN_TESTS =
# 4396 - 50 = 4346.
#
# RE-MEASURED 2026-09-13 (final run after the unhappy-path e2e + consent/toast/
# first-run fixes): 259/4346 -> 264/4496. Measured by running THIS SCRIPT end to
# end: all TEN zones reported the identical 268 passed | 1 skipped (269) files /
# 4539 passed | 7 skipped (4546) tests and PASSED. MIN_FILES = 269 - 5 = 264,
# MIN_TESTS = 4546 - 50 = 4496.
#
# RE-MEASURED 2026-09-13 (after the auth/invite/toast-inline follow-up fixes):
# 264/4496 -> 265/4510. Measured by running THIS SCRIPT end to end: all TEN zones
# reported the identical 269 passed | 1 skipped (270) files / 4553 passed |
# 7 skipped (4560) tests and PASSED. MIN_FILES = 270 - 5 = 265, MIN_TESTS =
# 4560 - 50 = 4510.
#
# RE-MEASURED 2026-09-13 (after the Home over-fetch fix + presence tests):
# 265/4510 -> 266/4532. Measured by running THIS SCRIPT end to end: all TEN zones
# reported the identical 270 passed | 1 skipped (271) files / 4575 passed |
# 7 skipped (4582) tests and PASSED. MIN_FILES = 271 - 5 = 266, MIN_TESTS =
# 4582 - 50 = 4532.
MIN_FILES="${MIN_FILES:-266}"
MIN_TESTS="${MIN_TESTS:-4532}"
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

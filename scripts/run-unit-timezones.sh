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
# THE ZONES come from ONE list shared by webapp, mobile and backend:
# ../scripts/timezones.txt (CircleCare/scripts/timezones.txt), one line per
# zone with the EDGE CLASS it is there for — every region (North America, Latin
# America, EMEA, APAC), both extremes (+14, -11), every fractional offset shape
# (+5:30, +5:45, +12:45, -3:30 with DST, +9:30 with DST), a 30-minute DST shift
# (Australia/Lord_Howe), DST abolished (Sao_Paulo 2019, Mexico_City 2022,
# Tehran 2022) and restored (Cairo 2023), midnight transitions (Santiago,
# Cairo), a dateline jump (Apia 2011), and the ICU legacy-alias traps
# (Asia/Kolkata -> Asia/Calcutta, Europe/Kyiv -> Europe/Kiev): anything keyed
# by the canonical name will miss, so resolve zones by BEHAVIOUR. Read that file
# for the per-zone reasons; they are not repeated here so they cannot drift.
#
# Before 2026-10-27 this script hard-coded 11 zones, mobile 12 and backend 6 —
# three different sets. The list now has one home.
#
# Usage:
#   scripts/run-unit-timezones.sh                  # whole suite, the `core` zones (default)
#   TZ_TIER=all scripts/run-unit-timezones.sh      # whole suite, EVERY zone (npm run test:timezones:full)
#   scripts/run-unit-timezones.sh src/utils        # narrow to a path (floor OFF)
#   TZ_LIST_FILE=/path/to/list scripts/...         # a different zone list
#
# Exits non-zero if any zone fails, and prints a per-zone summary at the end.

set -uo pipefail
cd "$(dirname "$0")/.."

# THE ZONE LIST, resolved relative to this repo (we cd'd to its root above), so
# the sweep runs standalone from webapp/. TZ_LIST_FILE overrides the path;
# TZ_TIER=core (the default here) or TZ_TIER=all (see the RUNTIME note below).
#
# The top-level CircleCare/ directory is NOT a git repo, so a fresh clone of
# this repo alone has no list. Then the sweep falls back — LOUDLY, at the top
# and again in the verdict — to a six-zone smoke set, rather than refusing to
# run or passing a thinner matrix off as the real one.
TZ_LIST_FILE="${TZ_LIST_FILE:-$PWD/../scripts/timezones.txt}"

# RUNTIME, AND WHY THE DEFAULT IS THE CORE TIER (2026-10-27). The full 30-zone
# list measured 2516s (42 min, 71-110s a zone on a loaded machine) — past the
# point where anyone runs it before calling work done, which is how a sweep
# rots. So `npm run test:timezones` runs the `core` tier (the 11 zones this
# script swept before the shared list: ~15 min), and
# `npm run test:timezones:full` (TZ_TIER=all) runs all 30. Nothing is dropped:
# the full set is one flag away, mobile and backend always run all 30, and the
# Postgres fixture test asserts coverage of ALL 30 zones in every run. Run the
# full set when touching anything timezone-adjacent and before a release.
TIER="${TZ_TIER-core}"
[ "$TIER" = "all" ] && TIER=""
FALLBACK_ZONES=(America/Denver UTC Pacific/Kiritimati Pacific/Midway Pacific/Chatham Asia/Kolkata)
usingFallback=0
ZONES=()
if [ -f "$TZ_LIST_FILE" ]; then
  while IFS= read -r z; do ZONES+=("$z"); done < <(
    awk -v tier="$TIER" '/^[[:space:]]*(#|$)/ {next} tier == "" || $2 == tier {print $1}' "$TZ_LIST_FILE"
  )
fi
if [ ${#ZONES[@]} -eq 0 ]; then
  usingFallback=1
  ZONES=("${FALLBACK_ZONES[@]}")
  echo "!! ZONE LIST NOT FOUND at $TZ_LIST_FILE (or empty for tier ${TIER:-all})."
  echo "!! Falling back to a SIX-ZONE SMOKE SET: ${FALLBACK_ZONES[*]}"
  echo "!! This is NOT the cross-timezone matrix."
fi
# Tells the Postgres fixture test it is under the sweep: a sweep zone whose
# fixture row cannot be found must FAIL, never skip (src/test/sweepZones.ts).
export CC_TZ_SWEEP=1
export TZ_LIST_FILE

# PREFLIGHT: every zone must actually BECOME the process zone. An unknown or
# misspelt `TZ` does not error — the runtime silently runs in UTC (or
# Etc/Unknown) and the sweep would report a pass for a zone it never visited.
badZones=""
for tz in "${ZONES[@]}"; do
  got=$(TZ="$tz" node -e '
    const named = process.argv[1];
    let canon;
    try { canon = new Intl.DateTimeFormat("en", { timeZone: named }).resolvedOptions().timeZone; }
    catch { canon = "<unknown to ICU>"; }
    const proc = Intl.DateTimeFormat().resolvedOptions().timeZone;
    process.stdout.write(canon === proc ? "ok" : `${proc} (named ${canon})`);
  ' "$tz" 2>&1)
  [ "$got" = "ok" ] || badZones="$badZones $tz=>$got"
done
if [ -n "$badZones" ]; then
  echo "ZONES THAT DO NOT TAKE EFFECT AS THE PROCESS ZONE:$badZones"
  echo "Fix the spelling in $TZ_LIST_FILE; nothing was run."
  exit 1
fi

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
#
# RE-MEASURED 2026-09-20 (web checkout country gate): 266/4532 -> 279/4947.
# The gate added three files (lib/checkoutCountry, its test, and
# hooks/useAccountTimezone + test) and cases across UpgradePage's two suites.
# The floor had also gone stale again by 415 tests, which is the slack this
# comment block exists to warn about.
#
# THIS ENTRY MATTERS MORE THAN THE USUAL RAISE, because the gate is the first
# thing in the app whose BEHAVIOUR depends on the process zone: it reads
# `Intl.DateTimeFormat().resolvedOptions().timeZone` and refuses checkout for
# anything off the US/CA/AU/NZ allowlist. Unpinned, UpgradePage's suites would
# pass under America/Denver and fail under the other nine zones. Both suites
# therefore patch `Intl.DateTimeFormat.prototype.resolvedOptions` to a fixed
# zone; this sweep is what proves that patch actually holds — the counts being
# IDENTICAL across all ten zones is the evidence, not just the green.
#
# Measured by running THIS SCRIPT end to end: all TEN zones reported the
# identical 283 passed | 1 skipped (284) files / 4990 passed | 7 skipped (4997)
# tests and PASSED. Set against the TOTALS per the convention above:
# MIN_FILES = 284 - 5 = 279, MIN_TESTS = 4997 - 50 = 4947.
#
# RE-MEASURED 2026-10-27 (shared 30-zone list): 279/4947 -> 507/9034. Stale
# again, by 228 files and ~4,100 tests. Measured by running THIS SCRIPT with
# TZ_TIER=all, floor disabled for the measurement: all 30 zones reported the
# identical 511 passed | 1 skipped (512) files / 9077 passed | 7 skipped (9084)
# tests — 7 skips in EVERY zone, now enforced by the cross-zone count check
# (the eventDateConversions fixture used to add an 8th skip in any zone it
# lacked: every US zone outside Denver). 29 zones passed first time;
# America/Los_Angeles failed one pickerPopover test on a 1s findByRole timeout
# under load and passed on a full re-run (3/3 in isolation too) — load, not
# zone. MIN_FILES = 512 - 5 = 507, MIN_TESTS = 9084 - 50 = 9034, per the
# convention above. This change's own tests: +1 (viewer-side tzdata
# confinement) in recipientEventDate.fixture.test.ts.
MIN_FILES="${MIN_FILES:-507}"
MIN_TESTS="${MIN_TESTS:-9034}"
low=""

# THE COUNTS MUST BE IDENTICAL ACROSS ZONES — files, tests AND skips. The floor
# above only sees a loss that happens everywhere; this sees one that happens
# SOMEWHERE. Added 2026-10-27 with the shared list: the fixture test's
# no-row-for-this-zone path turns 9 tests into 1 skip, which still exits 0, so
# before this check a zone missing from the Postgres fixture reported PASS with
# the whole conversion block unasserted. A skip count that varies by zone is a
# zone-dependent skip, and that is a hole, not noise.
expectedCounts=""
mismatch=""

for zone in "${ZONES[@]}"; do
  printf '\n\033[1m━━━ TZ=%s ━━━\033[0m\n' "$zone"
  zoneStart=$(date +%s)
  out=$(TZ="$zone" npx vitest run ${TARGET[@]+"${TARGET[@]}"} 2>&1)
  status=$?
  zoneSecs=$(( $(date +%s) - zoneStart ))
  printf '%s\n' "$out"

  # vitest prints "Test Files  N passed | M skipped (T)"; the parenthesised
  # total is the one that matters, since a skip is still a test that exists.
  # STRIP ANSI FIRST. vitest colours its summary when FORCE_COLOR is set even
  # though this output is captured rather than a TTY, and the counts then never
  # parse — turning a colour setting into a false "below the floor". Mobile's
  # sweep hit exactly that with FORCE_COLOR=3 in the environment.
  plain=$(printf '%s' "$out" | sed -E 's/\x1b\[[0-9;]*[A-Za-z]//g')
  filesLine=$(printf '%s' "$plain" | grep -E '^ *Test Files' | tail -1)
  testsLine=$(printf '%s' "$plain" | grep -E '^ *Tests ' | tail -1)
  files=$(printf '%s' "$filesLine" | sed -E 's/.*\(([0-9]+)\).*/\1/')
  tests=$(printf '%s' "$testsLine" | sed -E 's/.*\(([0-9]+)\).*/\1/')
  skipped=$(printf '%s' "$testsLine" | sed -nE 's/.*[^0-9]([0-9]+) skipped.*/\1/p')
  skipped=${skipped:-0}

  if [ $status -eq 0 ]; then
    SUMMARY+=("$(printf '  PASS  %-22s %s files / %s tests / %s skipped  %ss' "$zone" "$files" "$tests" "$skipped" "$zoneSecs")")
  else
    SUMMARY+=("$(printf '  FAIL  %-22s %s files / %s tests / %s skipped  %ss' "$zone" "$files" "$tests" "$skipped" "$zoneSecs")")
    failed+=("$zone")
  fi

  counts="$files/$tests/$skipped"
  if [ -z "$expectedCounts" ]; then
    expectedCounts="$counts"
  elif [ "$counts" != "$expectedCounts" ]; then
    mismatch="$mismatch $zone($counts vs $expectedCounts)"
  fi

  # The floor only means something for the whole suite; a narrowed run (a path
  # argument) is checked for cross-zone agreement only.
  if [ ${#TARGET[@]} -eq 0 ]; then
    case "$tests" in ''|*[!0-9]*) low="$low $zone(no test count)";; *)
      [ "$tests" -lt "$MIN_TESTS" ] && low="$low $zone($tests tests < $MIN_TESTS)";; esac
    case "$files" in ''|*[!0-9]*) low="$low $zone(no file count)";; *)
      [ "$files" -lt "$MIN_FILES" ] && low="$low $zone($files files < $MIN_FILES)";; esac
  fi
done

printf '\n\033[1m━━━ device-timezone sweep ━━━\033[0m\n'
printf '%s\n' "${SUMMARY[@]}"

if [ ${#failed[@]} -gt 0 ]; then
  printf '\n\033[31m%d of %d zones FAILED: %s\033[0m\n' \
    "${#failed[@]}" "${#ZONES[@]}" "${failed[*]}"
  exit 1
fi
if [ -n "$mismatch" ]; then
  printf '\n\033[31mCOUNTS DIFFER BY ZONE (files/tests/skipped):%s\033[0m\n' "$mismatch"
  echo "No test failed, but some zone ran or skipped a different set. A zone-dependent"
  echo "skip is a hole in the matrix: find it and make it run everywhere."
  exit 1
fi
if [ -n "$low" ]; then
  printf '\n\033[31mBELOW THE COMMITTED FLOOR:%s\033[0m\n' "$low"
  echo "Every zone can agree on a number that is simply too small. If the drop"
  echo "is intentional, lower MIN_FILES/MIN_TESTS in this script in the same"
  echo "commit. If it is not, you just found the bug."
  exit 1
fi
printf '\n\033[32mall %d zones passed (%s files/tests/skipped, identical in every zone)\033[0m\n' \
  "${#ZONES[@]}" "$expectedCounts"
if [ -n "$TIER" ] && [ "$usingFallback" = "0" ]; then
  echo "Tier '$TIER' only. The full matrix: npm run test:timezones:full (TZ_TIER=all)."
fi
if [ "$usingFallback" = "1" ]; then
  echo "!! ...but only the FALLBACK smoke set: $TZ_LIST_FILE was missing."
  echo "!! The full cross-timezone matrix was NOT run."
fi

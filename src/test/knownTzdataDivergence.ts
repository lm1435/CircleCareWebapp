/**
 * Zones where the committed Postgres fixtures and the runtime's ICU legitimately
 * DISAGREE, because the two carry different releases of the IANA database.
 *
 * The fixtures (`src/test/fixtures/*.json`) were generated from the local
 * Supabase Postgres, which bundles tzdata 2025b. Node 24.20 ships ICU 78.3 with
 * tzdata 2026c (`node -p process.versions.tz`). Between those releases IANA
 * changed the FUTURE rules for two classes of zone (data.iana.org NEWS):
 *
 *   2026b  British Columbia moved to permanent -07 on 2026-03-09
 *          -> America/Vancouver, Canada/Pacific
 *   2026c  Alberta moved to permanent -06 on 2026-06-18
 *          -> America/Edmonton, Canada/Mountain, America/Yellowknife (linked)
 *   2026c  Morocco moved to permanent +00 on 2026-09-20
 *          -> Africa/Casablanca, Africa/El_Aaiun
 *
 * Both Canadian changes landed while clocks were already on daylight time, so
 * the first OBSERVABLE divergence is the 2026-11-01 fall-back the old rules
 * still perform: fixture samples before that date agree, the three on or after
 * it differ by exactly one hour. Morocco differs at every sample from
 * 2026-09-27 on.
 *
 * This is NOT a list of tolerated bugs, and it is not only a test concern.
 * Production Postgres is on the same stale data, and every scheduling cron
 * converts wall-clock with `AT TIME ZONE` there — so from 2026-11-01 reminders
 * for anyone in BC or Alberta fire one hour late until Postgres is upgraded.
 * The mobile repo tracks that incident in
 * `mobile/src/__tests__/utils/timezoneOffsetAgainstPostgres.test.ts`; this
 * list mirrors its `KNOWN_TZDATA_DIVERGENCE` so both suites read the same way.
 *
 * WHY PIN RATHER THAN REGENERATE: regenerating from a Postgres still on 2025b
 * would encode the stale answer as ground truth and destroy the only automated
 * signal that the two clocks have diverged.
 *
 * WHY PIN RATHER THAN SKIP THE FILE: a permanently-red suite trains you to
 * ignore red. Pinning keeps the other ~546 zones asserted, and an eighth
 * diverging zone still fails loudly.
 *
 * ONLY WHEN THE RUNTIME IS AHEAD. On a Node whose tzdata predates 2026b, both
 * sides answer from the same old rules and every zone is compared normally —
 * agreement there still validates the arithmetic model, which is what these
 * fixtures exist to check. (Mobile takes the stricter line and pins Node in
 * `.nvmrc` so two stale clocks can never agree for the wrong reason.)
 *
 * SELF-DESTRUCT: each fixture test asserts that every pinned zone still
 * diverges under a 2026c runtime. Once production Postgres carries 2026c and
 * the fixtures are regenerated, that assertion fails and this list must be
 * emptied — it cannot rot silently.
 */
const PINNED_ZONES = [
  'Africa/Casablanca',
  'Africa/El_Aaiun',
  'America/Edmonton',
  'America/Vancouver',
  'America/Yellowknife',
  'Canada/Mountain',
  'Canada/Pacific',
] as const;

/** IANA release names sort lexically: '2025b' < '2026b' < '2026c'. */
const FIRST_DIVERGING_RELEASE = '2026b';

/** The tzdata release the running Node/ICU carries, e.g. '2026c'. */
export const RUNTIME_TZDATA: string = process.versions.tz ?? '';

/** True when the runtime carries rules the fixtures' Postgres does not. */
export const RUNTIME_IS_AHEAD_OF_FIXTURES = RUNTIME_TZDATA >= FIRST_DIVERGING_RELEASE;

/**
 * Zones to exclude from per-case fixture comparison on THIS runtime. Empty when
 * the runtime is not ahead, so nothing is skipped there.
 */
export const KNOWN_TZDATA_DIVERGENCE: ReadonlySet<string> = new Set(
  RUNTIME_IS_AHEAD_OF_FIXTURES ? PINNED_ZONES : []
);

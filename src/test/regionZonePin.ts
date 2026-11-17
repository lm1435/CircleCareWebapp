import type * as RegionResolver from '@/lib/regionResolver';

/**
 * Pins the time zone the browser REGION resolver sees, for suites that assume a US browser.
 *
 * `browserRegion()` reads the process zone (step 2 of `resolveRegion`: an "en-US" browser in
 * Europe/Berlin is in Germany). That is product behaviour, but it made every suite that assumes
 * the jsdom default (en-US -> US: Sunday-first weeks, a +1 phone seed) fail under the timezone
 * sweep in any non-US zone it knows (London, Berlin, Santiago, Sao_Paulo, Mexico_City, St_Johns...).
 * The suite's languages still decide; only the zone step is pinned to a US zone. Date maths and
 * the viewer's clock keep the real process zone, so the sweep still exercises them.
 *
 * Usage (module-level, hoisted):
 *   vi.mock('@/lib/regionResolver', async (orig) =>
 *     (await import('@/test/regionZonePin')).withPinnedRegionZone(await orig()));
 *
 * Suites that test the zone step itself stub the zone explicitly instead
 * (calendar/__tests__/recurrenceLabel.test.ts).
 */
export const PINNED_REGION_ZONE = 'America/Denver';

export function withPinnedRegionZone(mod: typeof RegionResolver): typeof RegionResolver {
  return {
    ...mod,
    browserRegion: () =>
      typeof navigator === 'undefined'
        ? null
        : mod.resolveRegion({
            languageTag: mod.browserLanguageTag(),
            timeZone: PINNED_REGION_ZONE,
          }),
  };
}

/**
 * 1.4.3 item 3 — GUARD: lib/regionResolver.ts is the ONLY web module that derives a REGION.
 *
 * Scans every non-test source file under src/ (comments stripped; __tests__, *.test.*, *.spec.*
 * and the src/test/ harness skipped) for the ways a region gets derived, and fails on any hit
 * outside the resolver:
 *   os-region-read     `.regionCode` (an OS Region setting; mobile only, kept for parity)
 *   resolver-call      `resolveRegion(` / `countryForTimeZone(` (callers use browserRegion)
 *   intl-locale-region `new Intl.Locale(..).region` / `.maximize().region`
 *   tag-region-parse   the inline "first two-letter subtag" parse (use regionFromLocale)
 *   zone-country-table an IANA zone -> country literal ('Europe/Berlin': 'DE')
 *   region-reader-def  a second `browserRegion` definition
 *   device-zone-read   reading the BROWSER time zone (`resolvedOptions().timeZone`) outside
 *                      DEVICE_ZONE_ALLOWLIST below
 *
 * DEVICE_ZONE_ALLOWLIST: files that read the browser zone for SCHEDULING / ACCOUNT / TAX, never for
 * "which country's conventions". A new entry needs a reason that is not "where is the user".
 * Mobile twin: mobile/src/__tests__/utils/regionResolverGuard.test.ts.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

const SRC = resolve(__dirname, '../..');
const RESOLVER = 'lib/regionResolver.ts';

export const DEVICE_ZONE_ALLOWLIST: Readonly<Record<string, string>> = {
  [RESOLVER]: 'the resolver itself (zone as region evidence)',
  'utils/timezone.ts': 'scheduling: the viewer zone fallback; zone-alias equality',
  'pages/SignUpPage.tsx': 'account: the new account is created in the browser zone',
  'lib/checkoutCountry.ts':
    'tax: the web-checkout gate is a fail-closed ZONE allowlist (merchant of record), deliberately not the language-aware region',
};

type Rule = { id: string; re: RegExp };
const RULES: readonly Rule[] = [
  { id: 'os-region-read', re: /\.regionCode\b/ },
  { id: 'resolver-call', re: /\b(?:resolveRegion|countryForTimeZone)\s*\(/ },
  { id: 'intl-locale-region', re: /Intl\.Locale\s*\([^;]*?\)\s*(?:\.maximize\(\)\s*)?\.region\b|\.maximize\(\)\s*\.region\b/ },
  { id: 'tag-region-parse', re: /\.slice\(1\)\s*\.find\(\s*\(?\s*\w+\s*\)?\s*=>\s*\/\^\[A-Za-z\]\{2\}\$\/\.test/ },
  { id: 'zone-country-table', re: /['"](?:Europe|America|Asia|Africa|Australia|Pacific|Atlantic|US)\/[A-Za-z_/]+['"]\s*:\s*['"][A-Z]{2}['"]/ },
  { id: 'region-reader-def', re: /\b(?:function|const|let)\s+(?:browserRegion|getDeviceRegion|deviceRegion)\b/ },
];
const DEVICE_ZONE_RE = /resolvedOptions\(\)\s*\.timeZone\b/;

/** Comments out: a doc that NAMES `resolvedOptions().timeZone` is not a read. */
export function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
}

/** Every rule a file breaks (relative path under src/, its source). Pure: tested on strings. */
export function findRegionDerivations(rel: string, source: string): string[] {
  if (rel === RESOLVER) return [];
  const code = stripComments(source);
  const hits = RULES.filter((r) => r.re.test(code)).map((r) => r.id);
  if (DEVICE_ZONE_RE.test(code) && !Object.prototype.hasOwnProperty.call(DEVICE_ZONE_ALLOWLIST, rel)) {
    hits.push('device-zone-read');
  }
  return hits;
}

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
      if (full === join(SRC, 'test')) continue; // the vitest harness (regionZonePin, viewerZone)
      sourceFiles(full, out);
    } else if (/\.(ts|tsx|js|jsx)$/.test(entry.name) && !/\.(test|spec)\.[jt]sx?$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

const rel = (full: string) => relative(SRC, full).split(sep).join('/');

describe('regionResolver guard — the source tree', () => {
  it('P: no module other than lib/regionResolver.ts derives a region', () => {
    const offenders = sourceFiles(SRC)
      .map((f) => ({ file: rel(f), hits: findRegionDerivations(rel(f), readFileSync(f, 'utf8')) }))
      .filter((o) => o.hits.length > 0);
    expect(offenders).toEqual([]);
  });

  it('P: the resolver really is a reader (the detector would flag it anywhere else)', () => {
    const resolver = readFileSync(join(SRC, RESOLVER), 'utf8');
    expect(findRegionDerivations('lib/somewhereElse.ts', resolver)).toEqual(
      expect.arrayContaining(['resolver-call', 'zone-country-table', 'region-reader-def', 'device-zone-read'])
    );
  });

  it('N: every allowlisted file still exists (a stale entry is a hole)', () => {
    for (const file of Object.keys(DEVICE_ZONE_ALLOWLIST)) {
      expect(existsSync(join(SRC, file))).toBe(true);
    }
  });
});

describe('regionResolver guard — the detector (synthetic sources)', () => {
  const F = 'components/Planted.tsx';
  it.each([
    ['os-region-read', 'const r = locales[0]?.regionCode;'],
    ['resolver-call', 'return resolveRegion({ languageTag: navigator.language, timeZone: z });'],
    ['resolver-call', 'const c = countryForTimeZone(zone);'],
    ['intl-locale-region', 'const r = new Intl.Locale(navigator.language).region;'],
    ['intl-locale-region', 'const r = new Intl.Locale(tag).maximize().region;'],
    ['tag-region-parse', 'const region = parts.slice(1).find((p) => /^[A-Za-z]{2}$/.test(p));'],
    ['zone-country-table', "const T = { 'Europe/Berlin': 'DE' };"],
    ['region-reader-def', 'export function browserRegion() { return null; }'],
    ['device-zone-read', 'const z = Intl.DateTimeFormat().resolvedOptions().timeZone;'],
    ['device-zone-read', 'const z = new Intl.DateTimeFormat().resolvedOptions().timeZone ?? null;'],
  ])('N: detects %s in a planted duplicate', (id, code) => {
    expect(findRegionDerivations(F, code)).toContain(id);
  });

  it.each([
    ['the formatting locale', "const browserLocale = typeof navigator !== 'undefined' ? navigator.language : '';"],
    ['a timezone-group field', '<div key={group.region} />'],
    ['a fixed-zone formatter', "new Intl.DateTimeFormat('en', { timeZone: 'UTC', weekday: 'short' })"],
    ['Intl.Locale week info', 'const l = new Intl.Locale(normalizeLocale(language)); l.getWeekInfo?.();'],
    ['a doc comment naming the API', '/** `Intl.resolvedOptions().timeZone` */\n// resolveRegion(x)\nconst a = 1;'],
    ["the resolver's public API", 'const r = browserRegion(); const tag = browserLanguageTag(); regionFromLocale(tag);'],
    ['a URL in a string', "const u = 'https://example.com/a'; const b = 2;"],
  ])('P: does not flag %s', (_label, code) => {
    expect(findRegionDerivations(F, code)).toEqual([]);
  });

  it('P: an allowlisted file may read the browser zone, nothing more', () => {
    const zone = 'const z = Intl.DateTimeFormat().resolvedOptions().timeZone;';
    expect(findRegionDerivations('utils/timezone.ts', zone)).toEqual([]);
    expect(findRegionDerivations('utils/timezone.ts', `${zone}\nconst c = countryForTimeZone(z);`)).toEqual([
      'resolver-call',
    ]);
  });
});

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { scanSource, stripComments, type AllowEntry } from './localeLiteralScanner';

const SRC = join(__dirname, '..', '..');

/**
 * No binary language branching outside an explicit, commented allowlist.
 *
 * `i18n.language.startsWith('es') ? 'es' : 'en'` and `lang === 'es'` were fine
 * with two languages and are silent bugs with six: fr-CA reads as English, an
 * 'est' tag reads as Spanish. Decisions about "which language" go through the
 * registry (`@/i18n/locales`: normalizeLocale / baseLanguage / DEFAULT_LOCALE)
 * or a per-locale table keyed by it.
 */
export const ALLOWLIST: AllowEntry[] = [
  {
    file: 'pdf/shared/adherenceReportTemplate.ts',
    contains: "langCode === 'es' ? 'es' : 'en'",
    reason:
      'Shared PDF template, edited in mobile/src/pdf/shared and synced by sync-pdf-shared.sh. ' +
      'The webapp adapter (pdf/pdfEnv.ts) already resolves lang through baseLanguage(), so this is ' +
      'harmless until a locale is added; the mobile owner replaces it with the registry helper.',
    transient: true,
  },
  {
    file: 'pdf/shared/careSummaryTemplate.ts',
    contains: "langCode === 'es' ? 'es' : 'en'",
    reason: 'Same shared-template debt as adherenceReportTemplate.ts (two sites in this file).',
    transient: true,
  },
  {
    file: 'components/calendar/dateMath.ts',
    contains: "normalizeLocale(language) === 'en' ? 0 : 1",
    reason:
      'Week-start FALLBACK only, reached when Intl.Locale cannot resolve weekInfo (every ' +
      'supported browser can). English = Sunday (0), else Monday (1). Known gap: fr-CA, pt and ' +
      'pt-PT are Sunday-first in CLDR, so a runtime WITHOUT weekInfo would start them on Monday; ' +
      'mobile carries a per-locale `firstDayFallback` table for that, web would need the same.',
  },
];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === '__tests__' || name === 'test') continue;
      walk(p, out);
    } else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) {
      out.push(p);
    }
  }
  return out;
}

function violations(): Array<{ file: string; line: number; text: string }> {
  const out: Array<{ file: string; line: number; text: string }> = [];
  for (const abs of walk(SRC)) {
    const file = relative(SRC, abs);
    for (const v of scanSource(readFileSync(abs, 'utf8'))) {
      out.push({ file, line: v.line, text: v.text });
    }
  }
  return out;
}

describe('no binary locale branching in src/', () => {
  it('every allowlist entry carries a reason', () => {
    for (const e of ALLOWLIST) expect(e.reason.trim().length).toBeGreaterThan(20);
  });

  it('every hit is covered by a commented allowlist entry', () => {
    const unallowed = violations().filter(
      (v) => !ALLOWLIST.some((e) => e.file === v.file && v.text.includes(e.contains))
    );
    expect(
      unallowed.map((v) => `${v.file}:${v.line}  ${v.text}`),
      'Use normalizeLocale/baseLanguage from @/i18n/locales (or a per-locale table) instead'
    ).toEqual([]);
  });

  it('has no stale (non-transient) allowlist entries', () => {
    const hits = violations();
    const stale = ALLOWLIST.filter(
      (e) => !e.transient && !hits.some((v) => v.file === e.file && v.text.includes(e.contains))
    );
    expect(stale.map((e) => `${e.file}: ${e.contains}`)).toEqual([]);
  });
});

describe('scanner (falsification on synthetic input)', () => {
  const hit = (src: string) => scanSource(src).map((v) => v.rule);

  it.each([
    ["if (lang === 'es') {}", 'strict-compare'],
    ['if (lang !== "es") {}', 'strict-compare'],
    ["if (lang == 'en') {}", 'strict-compare'],
    ["if ('en' !== lang) {}", 'strict-compare'],
    ["const l = x ? 'en' : 'es';", 'binary-ternary'],
    ["const l = x ? 'es' : 'en';", 'binary-ternary'],
    ["tag.toLowerCase().startsWith('es')", 'starts-with'],
    ['lng.startsWith("en")', 'starts-with'],
  ])('flags %s', (src, rule) => {
    expect(hit(src)).toContain(rule);
  });

  it.each([
    "const l = normalizeLocale(tag);",
    "// lang === 'es' is banned",
    "/* x ? 'en' : 'es' */ const a = 1;",
    "const code = 'es';",
    "if (kind === 'estimate') {}",
    "if (x === 'fr') {}",
    "const l = x ? 'en-US' : 'es-MX';",
  ])('does not flag %s', (src) => {
    expect(hit(src)).toEqual([]);
  });

  it('reports 1-based line numbers across block comments', () => {
    const src = "/* a\n b */\nif (l === 'es') {}\n";
    expect(scanSource(src)[0]?.line).toBe(3);
  });

  it('keeps string contents while stripping comments', () => {
    expect(stripComments("const s = '// not a comment'; // real")).toBe(
      "const s = '// not a comment';        "
    );
  });
});

/**
 * Static translation-key audit.
 *
 * `t('calendar:discontinueMed.foo')` is just a string — TypeScript cannot catch a
 * typo, a rename, or a deleted key, and the user is shown the raw key. This test
 * walks `src/` for translation-key references, resolves each one against the
 * locale JSON under `src/i18n/en` and `src/i18n/es`, and fails listing
 * `key -> file:line` for anything missing from either locale.
 *
 * NAMESPACE RESOLUTION STRATEGY (per-file declared namespaces, with a weak fallback)
 *
 *   1. Explicit `t('calendar:eventDetail.date')` -> resolved EXACTLY in `calendar`.
 *      An unknown namespace prefix is itself a failure.
 *   2. Implicit `t('eventDetail.date')` in a file that calls
 *      `useTranslation(['calendar', 'common'])` -> resolved against the UNION of
 *      every namespace list declared anywhere in that file, in declaration order.
 *      That mirrors i18next, which walks the `ns` array and returns the first hit.
 *   3. Implicit key in a file with NO `useTranslation(...)` at all (helper modules
 *      that receive a bound `t` from their caller — `activityFormat.ts`,
 *      `recurrenceLabel.ts`, ...) -> resolved against ALL namespaces, failing only
 *      when the key exists in none.
 *
 * WHAT THIS THEREFORE CANNOT CATCH
 *
 *   - Case 3 files: a key that exists in SOME namespace but not the one the caller
 *     actually binds. `t('today')` in `activityFormat.ts` passes as long as `today`
 *     lives in any namespace.
 *   - Case 2 files that declare several different namespace lists (the union is
 *     wider than any single `useTranslation` call site's).
 *   - Dynamic keys (`t(`calendar:status.${medStatus}`)`, `t(someVar)`). These are
 *     unresolvable statically; they are counted and the count is asserted below so
 *     that a silent skip cannot grow unnoticed.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC_DIR = join(HERE, '..', '..');
const I18N_DIR = join(HERE, '..');
const LOCALES = ['en', 'es'] as const;
type Locale = (typeof LOCALES)[number];

// i18next plural suffixes. A bare reference `foo` is satisfied by `foo_one` +
// `foo_other`; both are then REQUIRED in both locales (a missing `_one` in ES
// renders the raw key at runtime).
const REQUIRED_PLURAL_SUFFIXES = ['_one', '_other'] as const;

// ---------------------------------------------------------------------------
// Locale resources
// ---------------------------------------------------------------------------

type Json = string | number | boolean | null | Json[] | { [k: string]: Json };

function loadLocale(locale: Locale): Record<string, Json> {
  const dir = join(I18N_DIR, locale);
  const out: Record<string, Json> = {};
  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.json')) continue;
    out[file.replace(/\.json$/, '')] = JSON.parse(readFileSync(join(dir, file), 'utf8')) as Json;
  }
  return out;
}

const resources: Record<Locale, Record<string, Json>> = {
  en: loadLocale('en'),
  es: loadLocale('es'),
};

const ALL_NAMESPACES = Object.keys(resources.en).sort();

/** Resolve a dotted path inside one namespace. Returns `undefined` when absent. */
function lookup(locale: Locale, ns: string, path: string): Json | undefined {
  let node: Json | undefined = resources[locale][ns];
  for (const segment of path.split('.')) {
    if (node === null || typeof node !== 'object' || Array.isArray(node)) return undefined;
    node = (node as { [k: string]: Json })[segment];
    if (node === undefined) return undefined;
  }
  return node;
}

/**
 * The concrete key(s) a reference resolves to in a namespace, or `null` if the
 * namespace has no form of it. A plain key wins; otherwise the plural forms do.
 */
function resolvedForms(locale: Locale, ns: string, path: string): string[] | null {
  if (lookup(locale, ns, path) !== undefined) return [path];
  const plural = REQUIRED_PLURAL_SUFFIXES.map((s) => `${path}${s}`);
  if (plural.some((p) => lookup(locale, ns, p) !== undefined)) return plural;
  return null;
}

/** i18next interpolation variable names: `{{count}}`, `{{count, number}}`. */
function placeholders(value: Json | undefined): Set<string> {
  const out = new Set<string>();
  if (typeof value !== 'string') return out;
  for (const m of value.matchAll(/\{\{\s*([^},\s]+)/g)) out.add(m[1]);
  return out;
}

// ---------------------------------------------------------------------------
// Source scan
// ---------------------------------------------------------------------------

interface Reference {
  key: string;
  file: string;
  line: number;
  /** Namespaces to try, in order. Empty = the file declared none. */
  declaredNs: string[];
}

function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === '__tests__' || entry === 'node_modules') continue;
      sourceFiles(full, acc);
      continue;
    }
    if (!/\.tsx?$/.test(entry)) continue;
    if (/\.(test|spec)\.tsx?$/.test(entry)) continue;
    acc.push(full);
  }
  return acc;
}

/** Every namespace named by any `useTranslation(...)` in the file, in order. */
function declaredNamespaces(content: string): string[] {
  const out: string[] = [];
  for (const m of content.matchAll(/useTranslation\(\s*(\[[^\]]*\]|'[^']*'|"[^"]*")?/g)) {
    const arg = m[1];
    if (arg === undefined) {
      // `useTranslation()` -> defaultNS
      if (!out.includes('common')) out.push('common');
      continue;
    }
    for (const q of arg.matchAll(/['"]([^'"]+)['"]/g)) {
      if (!out.includes(q[1])) out.push(q[1]);
    }
  }
  return out;
}

const lineOf = (content: string, index: number): number =>
  content.slice(0, index).split('\n').length;

// Bare `t('key')` or `i18n.t('key')`. The lookbehind keeps `format(`, `.at(`,
// `useEffect(` and friends out.
const STATIC_CALL = /(?<![\w$])(?:i18n\.)?t\(\s*(['"])([^'"\n]*)\1/g;
// Same call shape, but with a template literal or a variable as the key.
const DYNAMIC_CALL = /(?<![\w$])(?:i18n\.)?t\(\s*(`|[A-Za-z_$][\w$]*\s*[,)])/g;
// <Trans i18nKey="..." />
const TRANS_KEY = /i18nKey=\s*(['"])([^'"\n]+)\1/g;

/** Pinned so a growing blind spot cannot hide behind a green run. */
const EXPECTED_DYNAMIC_KEY_CALL_SITES = 62;

/**
 * Comments are stripped before scanning — a `t(key)` inside a JSDoc block is
 * documentation, not a call site.
 */
const stripComments = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

const references: Reference[] = [];
const dynamicSites: string[] = [];

for (const file of sourceFiles(SRC_DIR)) {
  const content = stripComments(readFileSync(file, 'utf8'));
  if (!/(?<![\w$])(?:i18n\.)?t\(|i18nKey=/.test(content)) continue;
  const rel = relative(SRC_DIR, file);
  const declaredNs = declaredNamespaces(content);

  for (const re of [STATIC_CALL, TRANS_KEY]) {
    re.lastIndex = 0;
    for (const m of content.matchAll(re)) {
      const key = m[2];
      if (!key || !/^[\w.:-]+$/.test(key)) continue; // not a translation key
      references.push({ key, file: rel, line: lineOf(content, m.index), declaredNs });
    }
  }

  DYNAMIC_CALL.lastIndex = 0;
  for (const m of content.matchAll(DYNAMIC_CALL)) {
    dynamicSites.push(`${rel}:${lineOf(content, m.index)}`);
  }
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

interface Problem {
  message: string;
  site: string;
}

const missing: Problem[] = [];
const placeholderMismatch: Problem[] = [];
const unknownNamespace: Problem[] = [];

for (const ref of references) {
  const site = `${ref.file}:${ref.line}`;
  const colon = ref.key.indexOf(':');

  let candidates: string[];
  let path: string;
  if (colon > 0) {
    const ns = ref.key.slice(0, colon);
    path = ref.key.slice(colon + 1);
    if (!ALL_NAMESPACES.includes(ns)) {
      unknownNamespace.push({ message: `unknown namespace "${ns}" in ${ref.key}`, site });
      continue;
    }
    candidates = [ns];
  } else {
    path = ref.key;
    candidates = ref.declaredNs.length > 0 ? ref.declaredNs : ALL_NAMESPACES;
  }
  candidates = candidates.filter((ns) => ALL_NAMESPACES.includes(ns));
  if (candidates.length === 0) continue;

  // The namespace i18next would land on, decided by EN (the source locale);
  // fall back to ES so an EN-only omission still names a concrete namespace.
  let ns = candidates.find((c) => resolvedForms('en', c, path) !== null);
  if (ns === undefined) ns = candidates.find((c) => resolvedForms('es', c, path) !== null);
  if (ns === undefined) {
    missing.push({
      message: `${ref.key} -> missing from BOTH locales (tried ns: ${candidates.join(', ')})`,
      site,
    });
    continue;
  }

  // The exact concrete keys required — plural refs expand to _one + _other.
  const forms = resolvedForms('en', ns, path) ?? resolvedForms('es', ns, path)!;

  for (const form of forms) {
    for (const locale of LOCALES) {
      if (lookup(locale, ns, form) === undefined) {
        missing.push({ message: `${ns}:${form} -> missing from "${locale}"`, site });
      }
    }
    const en = lookup('en', ns, form);
    const es = lookup('es', ns, form);
    if (en === undefined || es === undefined) continue;
    const enVars = placeholders(en);
    const esVars = placeholders(es);
    const onlyEn = [...enVars].filter((v) => !esVars.has(v));
    const onlyEs = [...esVars].filter((v) => !enVars.has(v));
    if (onlyEn.length || onlyEs.length) {
      placeholderMismatch.push({
        message:
          `${ns}:${form} -> placeholder mismatch` +
          (onlyEn.length ? ` (en only: ${onlyEn.join(', ')})` : '') +
          (onlyEs.length ? ` (es only: ${onlyEs.join(', ')})` : ''),
        site,
      });
    }
  }
}

const format = (problems: Problem[]): string => {
  const seen = new Map<string, string[]>();
  for (const p of problems) {
    const sites = seen.get(p.message) ?? [];
    if (!sites.includes(p.site)) sites.push(p.site);
    seen.set(p.message, sites);
  }
  return [...seen.entries()].map(([m, sites]) => `  ${m}\n      ${sites.join('\n      ')}`).join('\n');
};

// ---------------------------------------------------------------------------

describe('translation keys referenced in src/', () => {
  it('scans a meaningful number of call sites', () => {
    // Guards against a regex/glob change quietly reducing this to a no-op.
    expect(references.length).toBeGreaterThan(900);
  });

  it('every referenced key exists in BOTH en and es', () => {
    expect(missing.length === 0 ? '' : `\n${format(missing)}\n`).toBe('');
  });

  it('never references an unknown namespace', () => {
    expect(unknownNamespace.length === 0 ? '' : `\n${format(unknownNamespace)}\n`).toBe('');
  });

  it('en and es use the same interpolation placeholders', () => {
    expect(
      placeholderMismatch.length === 0 ? '' : `\n${format(placeholderMismatch)}\n`
    ).toBe('');
  });

  it('pins the number of statically unresolvable (dynamic) key call sites', () => {
    // Dynamic keys — `t(`calendar:status.${x}`)` / `t(someVar)` — cannot be
    // resolved here and are NOT covered by the checks above. If this number
    // moves, a human has to look at the new call site and decide whether the
    // key it builds is safe.
    expect(`${dynamicSites.length}\n${dynamicSites.join('\n')}`).toBe(
      `${EXPECTED_DYNAMIC_KEY_CALL_SITES}\n${dynamicSites.join('\n')}`
    );
  });
});

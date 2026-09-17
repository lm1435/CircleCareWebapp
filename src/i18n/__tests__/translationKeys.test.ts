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
import { mapPdfKey } from '@/pdf/pdfEnv';
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

/**
 * `src/pdf/shared/` is a byte-identical MIRROR of mobile's platform-pure PDF
 * templates (`pdf/__tests__/pdfSharedMirror.test.ts` pins it). By design those
 * files call `t` in MOBILE's flat key space (`careSummary.*`,
 * `medicationHistory.export.*`, `vitals.types.*`); the web adapter
 * (`src/pdf/pdfEnv.ts`) rewrites the prefixes onto the web namespaces at
 * render time. The scans below apply THE SAME rewrite (imported, not copied)
 * to every literal and template found under that folder, so the mirrored
 * templates are audited against the keys they actually resolve to — and a
 * template key the adapter does not map shows up here as missing.
 */
const MIRRORED_MOBILE_KEY_DIR = 'pdf/shared/';
const webKeyFor = (rel: string, key: string): string =>
  rel.startsWith(MIRRORED_MOBILE_KEY_DIR) ? mapPdfKey(key) : key;

// Bare `t('key')` or `i18n.t('key')`. The lookbehind keeps `format(`, `.at(`,
// `useEffect(` and friends out.
const STATIC_CALL = /(?<![\w$])(?:i18n\.)?t\(\s*(['"])([^'"\n]*)\1/g;
// Same call shape, but with a template literal or a variable as the key.
const DYNAMIC_CALL = /(?<![\w$])(?:i18n\.)?t\(\s*(`|[A-Za-z_$][\w$]*\s*[,)])/g;
// <Trans i18nKey="..." />
const TRANS_KEY = /i18nKey=\s*(['"])([^'"\n]+)\1/g;

/**
 * Pinned so a growing blind spot cannot hide behind a green run.
 *
 * 62 -> 61 when `utils/timezone.ts` stopped naming zones from a locale key. Its
 * private `translate(key, lng, defaultValue)` helper called `i18n.t(key, …)`
 * with a VARIABLE key — the one dynamic call site in that file — to read
 * `common:timezoneLabels.<IANA>`. A zone is now named by the city inside its
 * IANA id, so there is no key to build and the blind spot is gone rather than
 * merely moved.
 *
 * 61 -> 62 (Task W5): `AuthShell.tsx`'s new hero value-prop list renders
 * `VALUE_PROP_KEYS.map((key) => t(key))` — a new VARIABLE-key call site,
 * validated statically instead by the W5 (c) string-constant guard below.
 *
 * 62 -> 62 (Wave 2, Task 10) — the total is unchanged, but its COMPOSITION
 * is not, so read the arithmetic rather than the number:
 *   +2  `components/layout/AddMenu.tsx`. The create pill builds BOTH of its
 *       strings from the option type it is iterating: the accessible name
 *       (full word) and the visible 10px label (mobile's short form, so the
 *       four options fit one row). Not a real blind spot: the option list is
 *       a closed four-element const in that file, and both templates ARE
 *       resolved by the W5 (a) sweep below (`BACKTICK_CALL` -> `markPattern`
 *       expands `addMenu.<x>` and `addMenu.<x>Short`), so all eight keys are
 *       proven live and present in both locales.
 *   -1  `components/circles/CircleCard.tsx` lost one dynamic site in the
 *       parallel circle-picker task.
 *   -1  `components/layout/CreateMenu.tsx` was deleted in Task 11; the pill
 *       above replaces it.
 *
 * 62 -> 64 (Wave 3, Task 16): `pages/TasksPage.tsx`'s status/sort filter
 * pills each name the CURRENT selection in their trigger label
 * (`t('filter.statusPillLabel', { value: t(\`filter.status.${status}\`) })`
 * and the sort equivalent) — two new template-keyed call sites. Not a real
 * blind spot: `filter.status.*` / `filter.sort.*` were already resolved by
 * the W5 (a) `BACKTICK_CALL` sweep below via the pre-existing MoreMenu-item
 * `.map()` call sites in the same file, so both are proven live and present
 * in both locales.
 *
 * 64 -> 65 (mobile-parity, Documents starter kit): `pages/DocumentsPage.tsx`
 * names the ACTIVE category in the per-category empty state
 * (`t('documents:emptyCategory.title', { category: t(\`documents:categories.${category}\`) })`)
 * — one new template-keyed call site. Not a real blind spot: `categories.*`
 * is already resolved by the W5 (a) `BACKTICK_CALL` sweep via the
 * `CategoryFilter` `.map()` call site, so every key is proven live and
 * present in both locales.
 *
 * 65 -> 66 (PDF export parity, Stage B1): `pdf/shared/adherenceReportTemplate.ts`
 * — a byte-identical mirror of mobile's template — labels the summary trend
 * with `t(trendKey)`, where `trendKey` is a ternary over the three literal
 * `medicationHistory.export.{improving,declining,stable}` keys two lines
 * above. Not a real blind spot: the W5 (a) sweep below resolves all three
 * literals (rewritten onto `meds:export.*` by `webKeyFor`), so each is proven
 * live and present in both locales. The file cannot be edited here — it is
 * owned by mobile and synced (see `MIRRORED_MOBILE_KEY_DIR`).
 */
const EXPECTED_DYNAMIC_KEY_CALL_SITES = 66;

/**
 * Comments are stripped before scanning — a `t(key)` inside a JSDoc block is
 * documentation, not a call site.
 */
const stripComments = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

/**
 * Same idea as `stripComments` above, but with the two replacements in the
 * OPPOSITE order — used by the two W5 guards below. `stripComments` strips
 * block comments first, so a slash-star sequence sitting inside a `//` line
 * comment (e.g. a route glob like "/invite/star" written with the real
 * punctuation) opens a "block comment" that runs to the next stray
 * star-slash anywhere later in the file, silently eating real code in
 * between. Stripping `//` lines first avoids that trap. Kept separate from
 * `stripComments` rather than fixing it in place: `stripComments` feeds
 * `references`/`dynamicSites`, whose pinned counts (900+, 62) were measured
 * against its current (imperfect) behavior — reordering it would shift those
 * counts as a side effect of an unrelated guard.
 */
const stripCommentsSafe = (src: string): string =>
  src.replace(/^[ \t]*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');

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
      const key = m[2] ? webKeyFor(rel, m[2]) : m[2];
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

// ---------------------------------------------------------------------------
// Task W5 (a): dead EN keys — the OTHER direction from the scan above.
// ---------------------------------------------------------------------------
//
// Everything above resolves a REAL call site to a key. It says nothing about
// copy nobody uses at all. This is a best-effort sweep for that, deliberately
// built MORE inclusive than the scan above — it should under-report dead
// keys rather than ever call a live key dead:
//
//   - every `t('literal')` / `i18nKey="literal"` call site (as above)
//   - every backtick template passed straight to `t(...)`, resolved as a
//     PATTERN (`t(\`calendar:status.${x}\`)` marks every `calendar:status.*`
//     key referenced, since `x` can't be known statically)
//   - the same pattern matching applied to a KEY-BUILDER template: a
//     `...Key`-named binding one call-hop from `t()` — this codebase's own
//     convention for exactly that indirection (`errorKey`, `titleKeyForPath`,
//     `labelKey`, `altKey`, `fallbackMessageKey`, ...). Because the binding
//     and its eventual `t(...)` call can live in different files (`errorKey`
//     is built in `useAiChat.ts`, called in `AIChatModal.tsx`), it is
//     resolved against every namespace rather than the defining file's own.
//   - any other quoted, dotted (`foo.bar`) or `ns:foo.bar` literal ANYWHERE
//     in the file — covers ternary branches, helper-function returns, and
//     the plain string-CONSTANT arrays validated individually in guard (c)
//     below (`APPOINTMENT_TITLE_KEYS`, `RELATIONSHIP_KEYS`, ...).
describe('W5: no unreferenced en keys', () => {
  function flattenLeaves(node: Json | undefined, prefix: string, ns: string, acc: Set<string>): void {
    if (node === undefined) return;
    if (node === null || typeof node !== 'object' || Array.isArray(node)) {
      acc.add(`${ns}:${prefix}`);
      return;
    }
    for (const [k, v] of Object.entries(node)) {
      flattenLeaves(v, prefix ? `${prefix}.${k}` : k, ns, acc);
    }
  }

  const allEnKeys = new Set<string>();
  for (const ns of ALL_NAMESPACES) flattenLeaves(resources.en[ns], '', ns, allEnKeys);

  const QUOTED_KEYSHAPED =
    /'([A-Za-z_][\w-]*(?:\.[A-Za-z_][\w-]*)+)'|"([A-Za-z_][\w-]*(?:\.[A-Za-z_][\w-]*)+)"/g;
  const QUOTED_NS_KEY = /'([a-z]+:[A-Za-z_][\w.-]*)'|"([a-z]+:[A-Za-z_][\w.-]*)"/g;
  const BACKTICK_CALL = /(?<![\w$])(?:i18n\.)?t\(\s*`([^`]*)`/g;
  // Object-property (`errorKey: ...`) or `const`/`let` declaration
  // (`const errorKey = ...`) ONLY — deliberately excludes bare `key={...}`
  // (a JSX `key` attribute assignment, e.g. `key={\`${event.id}_${i}\`}`,
  // matches neither shape here and must not be swept in as a translation key).
  const KEY_BUILDER_TEMPLATE =
    /(?:[\w$]*[Kk]ey[\w$]*\s*:|(?:const|let)\s+[\w$]*[Kk]ey[\w$]*\s*=)\s*[^`\n]{0,80}?`([^`]*)`/g;

  const referenced = new Set<string>();

  function markExact(literal: string): void {
    const colon = literal.indexOf(':');
    if (colon > 0 && ALL_NAMESPACES.includes(literal.slice(0, colon))) {
      const ns = literal.slice(0, colon);
      const path = literal.slice(colon + 1);
      const forms = resolvedForms('en', ns, path);
      if (forms) for (const form of forms) referenced.add(`${ns}:${form}`);
      return;
    }
    for (const ns of ALL_NAMESPACES) {
      const forms = resolvedForms('en', ns, literal);
      if (forms) for (const form of forms) referenced.add(`${ns}:${form}`);
    }
  }

  function markPattern(tpl: string, declaredNs: string[]): void {
    const parts = tpl.split(/\$\{[^}]*\}/);
    if (parts.length < 2 || !parts.every((p) => /^[\w.:-]*$/.test(p))) return;
    let ns: string | null = null;
    const firstPart = parts[0];
    const colon = firstPart.indexOf(':');
    const escaped = parts.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    if (colon > 0 && ALL_NAMESPACES.includes(firstPart.slice(0, colon))) {
      ns = firstPart.slice(0, colon);
      escaped[0] = escaped[0].slice(firstPart.slice(0, colon + 1).length);
    }
    let regex: RegExp;
    try {
      regex = new RegExp(`^${escaped.join('[^.]+')}$`);
    } catch {
      return;
    }
    const tryNamespaces = (namespaces: string[]): number => {
      let matched = 0;
      for (const candNs of namespaces) {
        for (const key of allEnKeys) {
          if (!key.startsWith(`${candNs}:`)) continue;
          if (regex.test(key.slice(candNs.length + 1))) {
            referenced.add(key);
            matched++;
          }
        }
      }
      return matched;
    };
    const tier1 = ns ? [ns] : declaredNs.length > 0 ? declaredNs : ALL_NAMESPACES;
    if (tryNamespaces(tier1) === 0 && !ns) tryNamespaces(ALL_NAMESPACES);
  }

  for (const file of sourceFiles(SRC_DIR)) {
    const content = stripCommentsSafe(readFileSync(file, 'utf8'));
    const rel = relative(SRC_DIR, file);
    const declaredNs = declaredNamespaces(content);

    for (const re of [STATIC_CALL, TRANS_KEY]) {
      re.lastIndex = 0;
      for (const m of content.matchAll(re)) {
        const key = m[2];
        if (key && /^[\w.:-]+$/.test(key)) markExact(webKeyFor(rel, key));
      }
    }
    BACKTICK_CALL.lastIndex = 0;
    for (const m of content.matchAll(BACKTICK_CALL)) markPattern(webKeyFor(rel, m[1]), declaredNs);
    // Key-builders are resolved against every namespace (see block comment
    // above) — pass no declared namespaces so tier1 IS "every namespace".
    KEY_BUILDER_TEMPLATE.lastIndex = 0;
    for (const m of content.matchAll(KEY_BUILDER_TEMPLATE)) markPattern(webKeyFor(rel, m[1]), []);
    for (const re of [QUOTED_KEYSHAPED, QUOTED_NS_KEY]) {
      re.lastIndex = 0;
      for (const m of content.matchAll(re)) markExact(webKeyFor(rel, m[1] ?? m[2]));
    }
  }

  const dead = [...allEnKeys].filter((k) => !referenced.has(k)).sort();

  /**
   * PINNED, computed by the sweep above as of Task W5 (2026-09-04) — copy
   * nobody references, dynamically or statically, anywhere in `src/`.
   *
   * This is an UPPER BOUND, not an exact match: the assertion below only
   * requires today's dead set to be CONTAINED in this list, so deleting one
   * of these keys (or wiring it up to real UI) needs no test change. A key
   * going dead that is NOT already here does — that's the guard.
   */
  const DEAD_KEY_ALLOWLIST = [
    // Task 15 — `AddEventModal`'s Create/Save-changes button now renders
    // through `Button`'s own `loading` prop (a spinner over the resting
    // label, per spec §6.4's Modal footer convention) instead of manually
    // swapping the label to this "Saving…" copy. Genuinely dead now, not
    // merely unwired.
    'calendar:addEvent.creating',
    // Mobile-parity Wave 2, Task 9. Added ahead of the UI that consumes them so
    // both locales land in one reviewable change:
    //   `addMenu.*` -> Task 10 `AddMenu`
    // Being an upper bound, every one of these can be wired up (or deleted)
    // with no change here. (The Task 9 header's own orphan, `nav.circles`
    // ("My Circles"; the switcher now says `nav.allCircles`), was deleted
    // outright in Task 24 rather than carried here.)
    //
    // Wave 2, Task 11 CLOSED the rest of this block rather than carrying it:
    //   `nav.{new,careShort,healthShort,aiShort}` are now live — the sidebar's
    //     New button and the FloatingNavBar's five cells read them.
    //   `nav.health` ("Health") is DELETED from both locales; the sidebar
    //     eyebrow and the nav cell both say `nav.healthShort`, so the two
    //     spellings of one word collapsed into one.
    //   `menu.*` is DELETED: the hamburger went in Task 9 and the drawer it
    //     opened (with its close button) went in Task 11, so neither
    //     `menu.toggle` nor `menu.close` has a control left to name.
    //   `create.*` is DELETED with `CreateMenu.tsx`; the create surface is now
    //     `addMenu.*`, which carries four options rather than six (document
    //     upload and invite moved onto their own pages, spec §5.2).
    //   `downloadBanner.*` is DELETED with `AppDownloadBanner.tsx` (spec §5.5:
    //     install promotion lives in the sidebar Sheet, Help, Profile,
    //     EmptyCircles and the invite landing page — never a top banner).
    'common:addMenu.appointment',
    'common:addMenu.medication',
    'common:addMenu.note',
    'common:addMenu.task',
    'calendar:addEvent.hints.timesShownIn',
    'calendar:addEvent.schedulePresets.onceDaily',
    'calendar:addEvent.timePresets.bedtime',
    'calendar:addEvent.timePresets.evening',
    'calendar:addEvent.timePresets.label',
    'calendar:addEvent.timePresets.morning',
    'calendar:addEvent.timePresets.noon',
    'calendar:addEvent.viewOnly',
    'calendar:eventDetail.title',
    'calendar:moreEvents',
    'circles:join.or',
    'emergency:atAGlance.allergies',
    // Task 18: per-card actions collapsed into one MoreMenu (spec §6.6); its
    // items render the item-specific `editXAria`/`deleteXAria` strings instead
    // of this generic pair, so the old CardActions button text (`edit.edit`,
    // deleted outright in Task 24) had no call site left. `edit.add` and
    // `edit.delete` stay alive — the latter as the shared per-item
    // ConfirmDialog's confirm label.
    'emergency:edit.add',
    'emergency:edit.editPrimaryDoctor',
    'emergency:edit.medical.bloodTypePlaceholder',
    'emergency:edit.medical.listHint',
    'emergency:edit.optional',
    'emergency:edit.removePrimaryDoctor',
    'emergency:edit.required',
    'emergency:empty.medicalInfo',
    'emergency:medicalInfo.bloodType',
    'emergency:medicalInfo.conditions',
    'freemium:circleSelection.cancel',
    'invite:appStore',
    'invite:googlePlay',
    'meds:dialog.dayToday',
    'members:invite.errors.roleRequired',
    'members:list.joined',
    'members:picker.caringFor',
    'members:picker.memberCount_one',
    'members:picker.memberCount_other',
    'members:picker.open',
    'tasks:row.completedOn',
    'tasks:row.noDueDate',
    'tasks:row.undoLabel',
    'tasks:toast.completed',
    'tasks:toast.reopened',
    'vitals:fields.timesShownIn',
    // Task 23 — UpgradePage's CTA now renders through `Button`'s own `loading`
    // prop (a spinner over the resting "Subscribe"/"Start free trial" label,
    // per spec §6.7) instead of manually swapping the label to this
    // "Opening checkout…" copy. Genuinely dead now, not merely unwired.
    'upgrade:subscribing',
    // PDF export parity (docs/plans/pdf-export-parity.md), Stage B1. Mobile's
    // `careSummary` and `medicationHistory.export` subtrees are copied
    // VERBATIM into `emergency.json` / `meds.json` — `pdf/__tests__/i18nParity.test.ts`
    // fails on any key drift, so nothing here may be pruned. Two groups:
    //
    //   (1) UI strings for the hooks and controls B3/B4 add next (the Export
    //       PDF masthead action + privacy confirm, the adherence period
    //       chooser, spinners and toasts). Being an upper bound, wiring them up
    //       needs no change here.
    'emergency:careSummary.shareAsPdf',
    'emergency:careSummary.shareAsText',
    'emergency:careSummary.shareTitle',
    'emergency:careSummary.subtitle',
    //   (2) Keys the shared templates no longer read on EITHER platform (the
    //       recurrence label now comes from each app's own formatter via
    //       `PdfEnv.formatRecurrence`; a few section/field labels were
    //       superseded in mobile's 2026-09-14 layout pass). Carried for
    //       verbatim parity with mobile, which owns the subtree.
    'emergency:careSummary.empty.noInfo',
    'emergency:careSummary.empty.noMedicalInfo',
    'emergency:careSummary.fields.medicalConditions',
    'emergency:careSummary.fields.primaryDoctor',
    'emergency:careSummary.frequency.custom',
    'emergency:careSummary.frequency.custom_unknown',
    'emergency:careSummary.frequency.cycle',
    'emergency:careSummary.frequency.daily',
    'emergency:careSummary.frequency.every_other_day',
    'emergency:careSummary.frequency.monthly',
    'emergency:careSummary.frequency.weekly',
    'emergency:careSummary.frequency.yearly',
    'emergency:careSummary.sections.medicalInfo',
    'meds:export.trend',
  ];

  it('has no unreferenced en keys beyond the pinned dead-key allowlist', () => {
    const unexpected = dead.filter((k) => !DEAD_KEY_ALLOWLIST.includes(k));
    expect(unexpected).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Task W5 (b): no hardcoded-English `defaultValue` fallback.
// ---------------------------------------------------------------------------
//
// `t('validation.invalid', { defaultValue: 'Invalid value' })` would silently
// show English to a Spanish reader whenever the key is missing, instead of
// the raw key (which at least LOOKS broken and gets reported). The codebase's
// actual pattern is `{ defaultValue: t('validation.invalid') }` — a second,
// itself-translated key — never a literal string.
describe('W5: no hardcoded-English defaultValue fallback', () => {
  it('never falls back to a hardcoded English string', () => {
    // Scanned over STRIPPED source, not raw: a comment merely mentioning the
    // pattern (e.g. documenting why NOT to write `defaultValue: 'foo'`, the
    // way `src/api/calendarEvents.ts` talks about its own `defaultValue`
    // fallback nearby) must not trip this — only a real `defaultValue:`
    // followed directly by a quote in CODE is a hardcoded string. A
    // `defaultValue: SOME_CONST` (a non-literal reference) is also out of
    // scope here — this only catches an inline string literal, the actual
    // silent-English-fallback shape; a named constant is at least a single
    // place to audit by hand if one ever shows up.
    const HARDCODED_DEFAULT_VALUE = /defaultValue:\s*['"`]/g;
    const offenders: string[] = [];
    for (const file of sourceFiles(SRC_DIR)) {
      const content = stripCommentsSafe(readFileSync(file, 'utf8'));
      HARDCODED_DEFAULT_VALUE.lastIndex = 0;
      for (const m of content.matchAll(HARDCODED_DEFAULT_VALUE)) {
        offenders.push(`${relative(SRC_DIR, file)}:${lineOf(content, m.index)}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Task W5 (c): translation-key string CONSTANTS used outside t().
// ---------------------------------------------------------------------------
//
// Some files hand a key to `t()` indirectly through a plain string constant
// resolved elsewhere — a route→title lookup table, a quick-pick option list,
// an image-alt key picked at random. None of that is a `t('literal')` call
// site, so the scan at the top of this file never sees these keys at all.
describe('W5: string-constant translation keys used outside t()', () => {
  function extractKeys(relPath: string, pattern: RegExp): string[] {
    const content = readFileSync(join(SRC_DIR, relPath), 'utf8');
    const out: string[] = [];
    pattern.lastIndex = 0;
    for (const m of content.matchAll(pattern)) out.push(m[1]);
    return out;
  }

  function missingFrom(ns: string, keys: string[]): string[] {
    return keys.filter(
      (k) => lookup('en', ns, k) === undefined || lookup('es', ns, k) === undefined
    );
  }

  it('validates RouteTitle.tsx page-title keys against both locales', () => {
    // STATIC_TITLES + CIRCLE_SUBTITLES values — both map pathnames to
    // `common:pageTitles.*` keys, then call `t(key)` with the VARIABLE
    // result (a dynamic call site, invisible to the scan above).
    const keys = extractKeys('components/RouteTitle.tsx', /'(pageTitles\.\w+)'/g);
    expect(keys.length).toBeGreaterThanOrEqual(21);
    expect(missingFrom('common', keys)).toEqual([]);
  });

  it('validates quickPicks.ts title-suggestion keys against both locales', () => {
    // APPOINTMENT_TITLE_KEYS + TASK_TITLE_KEYS — mapped through `t(key)` at
    // the call site (AddEventModal), so also invisible to the scan above.
    const keys = extractKeys(
      'lib/quickPicks.ts',
      /'(addEvent\.titleSuggestions\.[\w.]+)'/g
    );
    expect(keys.length).toBeGreaterThanOrEqual(10);
    expect(missingFrom('calendar', keys)).toEqual([]);
  });

  it('validates AuthShell.tsx hero image alt keys against both locales', () => {
    // HERO_IMAGES.altKey — picked at random per mount, then `t(hero.altKey)`.
    const keys = extractKeys('components/auth/AuthShell.tsx', /altKey:\s*'([\w.]+)'/g);
    expect(keys.length).toBeGreaterThanOrEqual(3);
    expect(missingFrom('common', keys)).toEqual([]);
  });

  it('validates AuthShell.tsx hero value-prop keys against both locales', () => {
    // VALUE_PROP_KEYS — mapped through `t(key)` (the new dynamic call site
    // pinned in EXPECTED_DYNAMIC_KEY_CALL_SITES above).
    const keys = extractKeys(
      'components/auth/AuthShell.tsx',
      /'(authHero\.valueProps\.\w+)'/g
    );
    expect(keys.length).toBeGreaterThanOrEqual(3);
    expect(missingFrom('common', keys)).toEqual([]);
  });
  /**
   * THE SHORT ADD-MENU LABELS HAVE TO BE SHORT.
   *
   * `addMenu.<type>Short` exists for exactly one reason: four options share
   * ONE row in the Add menu, so the pill shows the short label. It is also the
   * button's ACCESSIBLE NAME — `AddMenu.tsx` deliberately sets no aria-label,
   * because naming a button "Appointment" over a visible "Appt" fails WCAG
   * 2.5.3 Label in Name — so a short label that is not actually shorter is not
   * a harmless duplicate: it is the layout the key was added to prevent, in the
   * one language whose words are longest.
   *
   * Spanish shipped `medicationShort: "Medicamento"`, identical to the full
   * label (English is "Med"), so the row it was meant to fit was never fitted.
   */
  it('keeps every addMenu short label no longer than its full label, and abbreviates the long one', () => {
    for (const locale of ['en', 'es'] as const) {
      const addMenu = (resources[locale].common as { addMenu: Record<string, string> }).addMenu;
      for (const [key, full] of Object.entries(addMenu)) {
        if (key.endsWith('Short')) continue;
        const short = addMenu[`${key}Short`];
        expect(short, `${locale} addMenu.${key}Short`).toBeTruthy();
        expect(
          short.length,
          `${locale} addMenu.${key}Short ("${short}") must not be longer than "${full}"`
        ).toBeLessThanOrEqual(full.length);
      }
      // "Task"/"Note" are already short in both languages, so an equal-length
      // short label is fine for them. `medication` is the long one everywhere
      // and is the reason the short variants exist at all — if it is not
      // abbreviated, nothing is.
      expect(
        addMenu.medicationShort.length,
        `${locale} addMenu.medicationShort ("${addMenu.medicationShort}")`
      ).toBeLessThan(addMenu.medication.length);
    }
  });
});

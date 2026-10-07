/**
 * Scanner behind `noBinaryLocaleBranching.test.ts`: finds the "two languages
 * only" idioms that silently mis-handle every locale after es.
 *
 *   x === 'es' / x !== 'es' / x === 'en' / x !== 'en'   (either operand order)
 *   cond ? 'en' : 'es'  /  cond ? 'es' : 'en'
 *   tag.startsWith('es') / startsWith('en')
 *
 * Language decisions go through the registry helpers in `@/i18n/locales`
 * (`normalizeLocale`, `baseLanguage`, `DEFAULT_LOCALE`, per-locale tables).
 *
 * Comments are stripped first (they may legitimately QUOTE these idioms), string
 * contents are kept. Pure functions, so the test can falsify the scanner on
 * synthetic input.
 */

export type RuleId = 'strict-compare' | 'binary-ternary' | 'starts-with';

export interface Violation {
  line: number;
  rule: RuleId;
  text: string;
}

const RULES: ReadonlyArray<{ id: RuleId; re: RegExp }> = [
  { id: 'strict-compare', re: /[!=]==?\s*['"](?:es|en)['"]/ },
  { id: 'strict-compare', re: /['"](?:es|en)['"]\s*[!=]==?/ },
  { id: 'binary-ternary', re: /\?\s*['"](?:en|es)['"]\s*:\s*['"](?:es|en)['"]/ },
  { id: 'starts-with', re: /\.startsWith\(\s*['"](?:es|en)['"]\s*\)/ },
];

/** Replace comment text with spaces (newlines kept so line numbers survive). */
export function stripComments(source: string): string {
  let out = '';
  let i = 0;
  let quote: string | null = null;
  while (i < source.length) {
    const c = source[i] as string;
    const n = source[i + 1];
    if (quote) {
      out += c;
      if (c === '\\') {
        out += n ?? '';
        i += 2;
        continue;
      }
      if (c === quote) quote = null;
      i += 1;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      quote = c;
      out += c;
      i += 1;
    } else if (c === '/' && n === '/') {
      while (i < source.length && source[i] !== '\n') {
        out += ' ';
        i += 1;
      }
    } else if (c === '/' && n === '*') {
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) {
        out += source[i] === '\n' ? '\n' : ' ';
        i += 1;
      }
      out += '  ';
      i += 2;
    } else {
      out += c;
      i += 1;
    }
  }
  return out;
}

export function scanSource(source: string): Violation[] {
  const lines = stripComments(source).split('\n');
  const found: Violation[] = [];
  lines.forEach((text, idx) => {
    for (const { id, re } of RULES) {
      if (re.test(text)) found.push({ line: idx + 1, rule: id, text: text.trim() });
    }
  });
  return found;
}

export interface AllowEntry {
  /** Path relative to `src/`. */
  file: string;
  /** A substring of the offending (comment-stripped) line. */
  contains: string;
  /** WHY this is allowed; required. */
  reason: string;
  /**
   * The entry may legitimately disappear (another owner is removing the site).
   * Non-transient entries that no longer match FAIL the test (stale allowlist).
   */
  transient?: boolean;
}

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Spec §4.6: "no hand-written `rounded-* border bg-*` card may remain (test
 * greps)".
 *
 * A card shell is the co-occurrence of a radius, a border and a paper
 * background in ONE class-name expression. That combination is what
 * `<Card>` / `<Sheet>` exist to own; drawing it by hand is how the 47 divergent
 * radii in E-system.md §3d happened.
 *
 * `src/components/ui/` is exempt — those files DEFINE the shells.
 */

const ROOT = join(__dirname, '..', '..');

const RADIUS = /\brounded-/;
const BORDER = /\bborder\b/;
const PAPER = /\bbg-(cream|bg|bg-2|white)\b/;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === '__tests__' || name === 'test') continue;
      walk(p, out);
    } else if (name.endsWith('.tsx') && !name.includes('.test.')) {
      out.push(p);
    }
  }
  return out;
}

/**
 * Scans src[openBraceIndex] (which MUST be `{`) forward and returns the
 * content between it and its matching `}`, tracking nesting depth so a
 * `className={cn('a', { b: c })}` — an object literal argument, say — doesn't
 * end the scan at its own inner `}`.
 */
function extractBalanced(src: string, openBraceIndex: number): string | null {
  let depth = 0;
  for (let i = openBraceIndex; i < src.length; i++) {
    const ch = src[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return src.slice(openBraceIndex + 1, i);
    }
  }
  return null;
}

/**
 * Every `className=…` expression in the source, resolved to the STATIC class
 * text a Tailwind scan would actually see:
 *   - `className="literal"` — the literal itself.
 *   - `className={`template`}` — the template's static text; a `${…}`
 *     interpolation is invisible to Tailwind (it compiles to nothing), so it
 *     is stripped rather than treated as class text.
 *   - `className={<anything else>}` — `cn(...)`, string concatenation, a
 *     ternary — a balanced-brace scan finds the full expression, then every
 *     quoted/backtick string segment INSIDE it is pulled out and joined; a
 *     bare identifier or a `${…}` interpolation contributes nothing, same
 *     reasoning as the template-literal case.
 */
function classNameExpressions(src: string): { text: string; index: number }[] {
  const out: { text: string; index: number }[] = [];

  for (const m of src.matchAll(/className="([^"]*)"/g)) {
    out.push({ text: m[1], index: m.index! });
  }

  const attrRe = /className=\{/g;
  let m: RegExpExecArray | null;
  while ((m = attrRe.exec(src))) {
    const openBraceIndex = attrRe.lastIndex - 1; // the '{' itself
    const content = extractBalanced(src, openBraceIndex);
    if (content == null) continue;
    const pieces: string[] = [];
    for (const lit of content.matchAll(/`([^`]*)`|'([^']*)'|"([^"]*)"/g)) {
      const raw = lit[1] ?? lit[2] ?? lit[3] ?? '';
      pieces.push(raw.replace(/\$\{[\s\S]*?\}/g, ' '));
    }
    out.push({ text: pieces.join(' '), index: m.index });
  }

  return out;
}

/** Every card-shell class expression in the source, resolved per the above. */
export function cardShellLiterals(src: string): string[] {
  const out: string[] = [];
  for (const { text: cls, index } of classNameExpressions(src)) {
    if (!(RADIUS.test(cls) && BORDER.test(cls) && PAPER.test(cls))) continue;
    // Escape hatch for a bordered, rounded, paper-coloured element that is NOT
    // a card (a brand button, a decorative badge): the line before the literal
    // carries `card-shell-ok: <reason>`. Reviewers judge the reason.
    const before = src.slice(0, index).split('\n').slice(-3).join('\n');
    if (/card-shell-ok:/.test(before)) continue;
    out.push(cls);
  }
  return out;
}

describe('hand-written card shells (spec §4.6)', () => {
  const files = walk(ROOT).filter((p) => !p.includes(join('components', 'ui')));

  it.each(files)('%s draws no card shell by hand', (file) => {
    expect(cardShellLiterals(readFileSync(file, 'utf8'))).toEqual([]);
  });
});

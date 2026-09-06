import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..');
const ALLOW_11PX = ['components/calendar/WeekView.tsx', 'components/calendar/MonthView.tsx'];
// Files allowed to use arbitrary text-[...] sizes because they DEFINE the scale/primitives:
const ALLOW_ARBITRARY = ['components/ui/Text.tsx', 'components/ui/Button.tsx'];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(tsx?|css)$/.test(name) && !p.includes('__tests__') && !p.includes('/test/') && !p.endsWith('styles/globals.css'))
      out.push(p);
  }
  return out;
}

describe('type scale bans (spec §4.2)', () => {
  const files = walk(ROOT);
  it.each(files)('%s uses no banned type utilities', (file) => {
    const src = readFileSync(file, 'utf8');
    const rel = file.slice(ROOT.length + 1);
    expect(src).not.toMatch(/\btext-3xl\b/);
    // The Tailwind utility is banned; the CSS token (`--font-serif`, `var(--font-serif)`)
    // is not — the signed-out hero wordmark uses it via an inline style.
    expect(src).not.toMatch(/(?<!-)\bfont-serif\b/);
    expect(src).not.toMatch(/className="[^"]*\bserif\b/);
    // Arbitrary-value durations are banned — use the `duration-fast/normal/slow`
    // utilities instead (globals.css `@utility` rules over the `--dur-*` theme
    // tokens), so every transition timing stays centrally controlled and a
    // future rename of the tokens is a one-line CSS edit, not a source sweep.
    expect(src).not.toMatch(/\bduration-\[\d+m?s\]/);
    const arbitrary = src.match(/\btext-\[\d[\d.]*(?:px|rem|em)\]/g) ?? [];
    const illegal = arbitrary.filter(
      (m) => !(ALLOW_11PX.includes(rel) && m === 'text-[11px]') && !ALLOW_ARBITRARY.includes(rel)
    );
    expect(illegal).toEqual([]);
  });
});

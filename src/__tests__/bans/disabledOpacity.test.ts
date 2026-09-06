import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..');

/**
 * Spec §4.5: disabled is always 50% opacity. `opacity-40` / `opacity-60` and
 * any `disabled:opacity-<n>` where n ≠ 50 are the pre-parity dim levels.
 */
const BANNED = /(?<![a-z]:)\bopacity-(40|60)\b|disabled:opacity-(?!50\b)\d+/;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === '__tests__' || name === 'test') continue;
      walk(p, out);
    } else if (name.endsWith('.tsx')) {
      out.push(p);
    }
  }
  return out;
}

describe('disabled opacity ban (spec §4.5)', () => {
  const files = walk(ROOT);

  it.each(files)('%s uses no banned disabled-opacity level', (file) => {
    const src = readFileSync(file, 'utf8');
    const offenders = src
      .split('\n')
      .map((line, i) => ({ line, n: i + 1 }))
      .filter(({ line }) => BANNED.test(line))
      .map(({ line, n }) => `${n}: ${line.trim()}`);
    expect(offenders).toEqual([]);
  });
});

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// <Eyebrow> renders an inline <span> by default, and browsers ignore vertical margins on inline
// elements: `className="mb-3"` alone left "NEXT UP" / "QUICK ACCESS" touching the card below
// (owner report 2026-11-10). Any Eyebrow given a vertical margin must also be `block` (or render
// as a block element via `as`).
const SRC = join(__dirname, '../../..');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name !== '__tests__' && name !== 'node_modules') walk(p, out);
    } else if (p.endsWith('.tsx')) out.push(p);
  }
  return out;
}

describe('Eyebrow vertical margins', () => {
  it('every <Eyebrow> with a vertical margin is display:block', () => {
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      const src = readFileSync(file, 'utf8');
      for (const m of src.matchAll(/<Eyebrow\b[^>]*>/g)) {
        const tag = m[0];
        const cls = /className="([^"]*)"/.exec(tag)?.[1] ?? '';
        const hasVertical = /(^|\s)(m[bty]|my)-\S+/.test(cls);
        const isBlock = /(^|\s)(block|flex|grid)(\s|$)/.test(cls) || /\bas="(p|div|h[1-6])"/.test(tag);
        if (hasVertical && !isBlock) offenders.push(`${file.replace(SRC, 'src')}: ${tag}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

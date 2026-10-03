import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..');

/**
 * a11y audit 2026-09-29 (WCAG 2.3.3, reduced motion): globals.css turns
 * `scroll-behavior` to `auto` under `prefers-reduced-motion`, but a JS
 * `scrollIntoView({ behavior: 'smooth' })` bypasses CSS and animates anyway.
 * A hard-coded `'smooth'` is banned; pick it through `prefersReducedMotion()`.
 */
const BANNED = /behavior:\s*['"]smooth['"]/;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === '__tests__' || name === 'test') continue;
      walk(p, out);
    } else if (/\.tsx?$/.test(name)) {
      out.push(p);
    }
  }
  return out;
}

describe('no hard-coded smooth scrolling (reduced motion)', () => {
  it.each(walk(ROOT))('%s', (file) => {
    expect(readFileSync(file, 'utf8')).not.toMatch(BANNED);
  });
});

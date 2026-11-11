import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// RouteFocus moves focus to the new page's title (tabindex="-1") for screen readers. iOS Safari
// matched :focus-visible on that programmatic focus and drew the 2px ring as a box around
// "Today for …" (owner report 2026-11-10). Programmatically focused titles are never Tab stops,
// so they carry no ring; real controls keep theirs.
describe('route-focused page titles have no focus ring', () => {
  const css = readFileSync(join(__dirname, '../styles/globals.css'), 'utf8');

  it('removes the outline on tabindex=-1 h1/h2 for :focus and :focus-visible', () => {
    expect(css).toMatch(
      /:is\(h1, h2\)\[tabindex='-1'\]:focus,\s*:is\(h1, h2\)\[tabindex='-1'\]:focus-visible\s*\{\s*outline:\s*none;/
    );
  });

  it('keeps the keyboard ring for everything else', () => {
    expect(css).toMatch(/\*:focus-visible\s*\{\s*outline:\s*2px solid var\(--color-ink\);/);
  });
});

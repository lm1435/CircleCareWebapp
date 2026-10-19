import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Print and PDF ALWAYS render light (owner decision 2026-10-18). Two mechanisms,
// both pinned here: the dark tokens are SCREEN-ONLY (`@media screen` wrapper in
// globals.css), and nothing in print.css / src/pdf reads the theme.

const SRC = join(__dirname, '..');
const read = (...p: string[]): string => readFileSync(join(SRC, ...p), 'utf8');

describe('print and PDF stay light', () => {
  it('print.css never reads the theme', () => {
    const css = read('styles', 'print.css');
    expect(css).not.toMatch(/data-theme|prefers-color-scheme|color-scheme:\s*dark/);
  });

  it('src/pdf/shared (the shared PDF templates) never reads the theme', () => {
    const dir = join(SRC, 'pdf', 'shared');
    const files = readdirSync(dir).filter((f) => f.endsWith('.ts'));
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      expect(readFileSync(join(dir, f), 'utf8'), f).not.toMatch(
        /data-theme|prefers-color-scheme|themeCore|lib\/theme|getComputedStyle/
      );
    }
  });

  it('the PDF palette is literal light hex (not var(--color-*), which dark would re-point)', () => {
    expect(read('pdf', 'shared', 'palette.ts')).not.toContain('var(--');
  });

  it('every dark rule in globals.css sits inside @media screen', () => {
    const css = read('styles', 'globals.css');
    const first = css.indexOf(":root[data-theme='dark']");
    expect(first).toBeGreaterThan(-1);
    expect(css.lastIndexOf('@media screen', first)).toBeGreaterThan(-1);
    // The only other mentions of the dark attribute are comments.
    const code = css.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(code.match(/data-theme='dark'/g)).toHaveLength(1);
  });

  it('printing resets the root colour-scheme to light', () => {
    const css = read('styles', 'globals.css');
    expect(css).toMatch(/@media print\s*\{\s*:root\s*\{\s*color-scheme:\s*light;/);
  });
});

describe('components read role tokens, not the hues they replaced', () => {
  it('no stopgap attribute-selector rules remain', () => {
    const css = read('styles', 'globals.css');
    expect(css).not.toMatch(/\[class\*=|\[style\*=|\[data-testid=/);
  });
});

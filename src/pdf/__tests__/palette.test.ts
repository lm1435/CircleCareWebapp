/**
 * `shared/palette.ts` embeds the CircleCare colours as literals so the
 * platform-pure templates need neither mobile's `CC` object nor the web's
 * `--color-*` custom properties. This pins each literal to the matching token
 * in `src/styles/globals.css` (mobile has the twin test against `CC`), so a
 * token that changes in one place fails here rather than drifting silently
 * in a printed document.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { PDF_PALETTE, type PdfPaletteKey } from '../shared/palette';

const HERE = dirname(fileURLToPath(import.meta.url));
const GLOBALS_CSS = readFileSync(resolve(HERE, '..', '..', 'styles', 'globals.css'), 'utf8');

/**
 * Palette key → `--color-*` token. `mossInk` maps to `--color-moss-deep`
 * (globals.css: "--color-moss-deep already = mobile mossInk").
 */
const TOKEN_FOR: Record<Exclude<PdfPaletteKey, 'hair' | 'hairStrong'>, string> = {
  ink: '--color-ink',
  inkSoft: '--color-ink-2',
  inkMute: '--color-ink-3',
  moss: '--color-moss',
  mossWash: '--color-moss-wash',
  mossLine: '--color-moss-line',
  mossMuted: '--color-moss-muted',
  mossInk: '--color-moss-deep',
  terracotta: '--color-terracotta',
  terracottaSoft: '--color-terracotta-soft',
  amber: '--color-amber',
  amberDeep: '--color-amber-deep',
  duskDeep: '--color-dusk-deep',
  paper: '--color-bg',
  paperDeep: '--color-bg-2',
};

function cssToken(name: string): string {
  const escaped = name.replace(/[-]/g, '\\-');
  const match = new RegExp(`^\\s*${escaped}:\\s*([^;]+);`, 'm').exec(GLOBALS_CSS);
  if (!match) throw new Error(`${name} is not defined in globals.css`);
  return match[1].trim();
}

describe('PDF_PALETTE matches the web --color-* tokens', () => {
  for (const [key, token] of Object.entries(TOKEN_FOR) as [keyof typeof TOKEN_FOR, string][]) {
    it(`${key} === ${token}`, () => {
      expect(PDF_PALETTE[key].toLowerCase()).toBe(cssToken(token).toLowerCase());
    });
  }

  it('hair / hairStrong are defined rgba hairlines', () => {
    expect(PDF_PALETTE.hair).toMatch(/^rgba\(/);
    expect(PDF_PALETTE.hairStrong).toMatch(/^rgba\(/);
  });

  it('every palette key is covered by this test', () => {
    const covered = new Set<string>([...Object.keys(TOKEN_FOR), 'hair', 'hairStrong']);
    expect(Object.keys(PDF_PALETTE).sort()).toEqual([...covered].sort());
  });
});

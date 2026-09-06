import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..');

/**
 * Spec §3.1: Instrument Serif survives ONLY for the signed-out hero wordmark.
 * Every other in-app surface is Inter. Exactly two places legitimately name
 * the face:
 *   - `main.tsx` imports the font FILE — the 400 upright face only (no bold,
 *     no italic weight/style is ever bundled).
 *   - `styles/globals.css` defines the `--font-serif` TOKEN
 *     (`'Instrument Serif', Georgia, serif`) that `AuthShell.tsx`'s wordmark
 *     rule reads via `var(--font-serif)` — the wordmark's own source never
 *     spells the family name, only the token.
 * A second import path, or a second declaration naming the face, is exactly
 * the leak this test exists to catch (the original version of this test only
 * ever read main.tsx, so a second importer anywhere else would pass silently).
 */
const ALLOWED = [
  { file: 'main.tsx', text: "import '@fontsource/instrument-serif/400.css';" },
  {
    file: 'styles/globals.css',
    text: "--font-serif: 'Instrument Serif', Georgia, serif;",
  },
];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === '__tests__' || name === 'test') continue;
      walk(p, out);
    } else if (/\.(tsx?|css)$/.test(name)) {
      out.push(p);
    }
  }
  return out;
}

// A side-effect (or named) import whose path contains the package name.
const IMPORT_PATTERN = /import\s+['"][^'"]*instrument-serif[^'"]*['"];?/gi;
// Any CSS declaration — `font-family` itself, or a custom property like this
// codebase's `--font-serif` — whose value names the face literally.
const FONT_DECLARATION_PATTERN = /(?:font-family|--[\w-]*serif[\w-]*)\s*:[^;]*Instrument Serif[^;]*;?/gi;

describe('serif font (spec §3.1)', () => {
  it('only main.tsx imports Instrument Serif, and only the 400 upright face', () => {
    const main = readFileSync(join(ROOT, 'main.tsx'), 'utf8');
    expect(main).toContain('@fontsource/instrument-serif/400.css');
    expect(main).not.toContain('400-italic');
  });

  it('no second import path or font declaration leaks Instrument Serif beyond the two allowed spots', () => {
    const files = walk(ROOT);
    const offenders: string[] = [];
    for (const file of files) {
      const rel = file.slice(ROOT.length + 1);
      const src = readFileSync(file, 'utf8');
      const matches = [
        ...(src.match(IMPORT_PATTERN) ?? []),
        ...(src.match(FONT_DECLARATION_PATTERN) ?? []),
      ];
      for (const raw of matches) {
        const m = raw.trim();
        const allowed = ALLOWED.some((a) => a.file === rel && m === a.text);
        if (!allowed) offenders.push(`${rel}: ${m}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

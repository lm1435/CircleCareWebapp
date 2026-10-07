/**
 * `src/i18n/format/index.ts` is the central index of per-locale format modules. Guards:
 * every registered locale has a module; every module present (even an unregistered lane
 * module) is well-formed; a module file exists for every map key and vice versa; MERIDIEM
 * stays the legacy en/es table.
 */
// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { LOCALE_REGISTRY } from '../locales';
import { LOCALE_FORMATS, resolveMeridiem } from '../format';

const FORMAT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'format');
const files = readdirSync(FORMAT_DIR)
  .filter((f) => /^[a-z]{2,3}(-[A-Z]{2})?\.ts$/.test(f))
  .map((f) => f.replace(/\.ts$/, ''));

describe('format index', () => {
  it('every registered locale has a format module', () => {
    for (const { code } of LOCALE_REGISTRY) expect(LOCALE_FORMATS[code], code).toBeDefined();
  });

  it('map keys and module files agree (a lane adds both)', () => {
    expect(Object.keys(LOCALE_FORMATS).sort()).toEqual([...files].sort());
  });

  it('each module is well-formed; a BASE locale carries a full meridiem', () => {
    for (const [code, fmt] of Object.entries(LOCALE_FORMATS)) {
      const isVariant = code.includes('-');
      if (fmt.meridiem) {
        expect(fmt.meridiem.am.length, `${code}.am`).toBeGreaterThan(0);
        expect(fmt.meridiem.pm.length, `${code}.pm`).toBeGreaterThan(0);
      } else {
        expect(isVariant, `${code} is a base locale and needs meridiem`).toBe(true);
      }
      for (const [k, v] of Object.entries(fmt.placeNames ?? {})) {
        expect(k.length).toBeGreaterThan(0);
        expect(v.length).toBeGreaterThan(0);
      }
    }
  });

  it('index has exactly one import and one entry per module (no extra wiring)', () => {
    const src = readFileSync(join(FORMAT_DIR, 'index.ts'), 'utf8');
    const imports = [...src.matchAll(/^import \{ format as \w+ \} from '\.\/([\w-]+)';$/gm)];
    expect(imports.map((m) => m[1]).sort()).toEqual([...files].sort());
  });

  it('meridiem is frozen for the shipped set', () => {
    expect(resolveMeridiem('en')).toEqual({ am: 'AM', pm: 'PM' });
    expect(resolveMeridiem('es')).toEqual({ am: 'a. m.', pm: 'p. m.' });
    expect(resolveMeridiem('xx')).toEqual({ am: 'AM', pm: 'PM' });
  });
});

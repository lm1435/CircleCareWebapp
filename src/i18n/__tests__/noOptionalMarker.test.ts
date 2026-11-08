import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

// Owner 2026-11-07 (mobile parity): required fields carry a red asterisk, so the "(optional)"
// marker on every other field is gone, in EVERY web locale. A parenthesized optional word in any
// locale value is a regression.

const I18N = join(__dirname, '..');
const MARKER =
  /\(\s*(optional|opcional|facultati(f|ve|vo|va)|optionnel(le)?|facoltativ[oa]|freiwillig|wahlweise)\s*\)/i;

function* values(node: unknown, path: string): Generator<[string, string]> {
  if (typeof node === 'string') yield [path, node];
  else if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) yield* values(v, path ? `${path}.${k}` : k);
  }
}

describe('no "(optional)" marker in any web locale', () => {
  const locales = readdirSync(I18N).filter(
    (d) => statSync(join(I18N, d)).isDirectory() && !['__tests__', 'format'].includes(d)
  );

  it('found the locale folders', () => {
    expect(locales).toEqual(expect.arrayContaining(['en', 'es', 'fr', 'fr-CA', 'de', 'it', 'pt', 'pt-PT']));
  });

  it.each(locales)('%s', (locale) => {
    const offenders: string[] = [];
    for (const file of readdirSync(join(I18N, locale)).filter((f) => f.endsWith('.json'))) {
      const json = JSON.parse(readFileSync(join(I18N, locale, file), 'utf8'));
      for (const [key, value] of values(json, '')) {
        if (MARKER.test(value)) offenders.push(`${file}:${key} = ${value}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

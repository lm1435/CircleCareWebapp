/**
 * 1.4.0 owner decision: the medication dose action says "Taken" EVERYWHERE, the same
 * word as Today's Next up button (`overview:today.nextUp.taken`). The Meds page row
 * (`meds:taken`) and the calendar event detail (`calendar:eventDetail.taken`) carry their
 * own copies of that word, so this pins all three equal in every base locale: a later
 * retranslation of one surface cannot drift from the others.
 *
 * Their accessible names stay actions that say WHICH medication ("Mark {{name}} as
 * taken"), not a status read-out like "Taken, Metformin". Label-in-name (the visible
 * word inside the name) is pinned separately by labelInName.test.ts.
 */
// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { LOCALE_REGISTRY } from '../locales';

const I18N_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
type Json = Record<string, any>;
const load = (code: string, ns: string): Json =>
  JSON.parse(readFileSync(join(I18N_DIR, code, `${ns}.json`), 'utf8')) as Json;

const BASE = LOCALE_REGISTRY.filter((l) => !('base' in l && l.base)).map((l) => l.code);

describe('dose action word = Today\'s "Taken" (1.4.0)', () => {
  it('covers every base locale', () => {
    expect(BASE).toEqual(expect.arrayContaining(['en', 'es', 'fr', 'de', 'it', 'pt']));
  });

  for (const code of BASE) {
    it(`${code}: Meds page and calendar detail use Today's word, with an action name`, () => {
      const today = load(code, 'overview').today.nextUp.taken as string;
      const meds = load(code, 'meds');
      const cal = load(code, 'calendar').eventDetail;

      expect(meds.taken).toBe(today);
      expect(cal.taken).toBe(today);
      for (const label of [meds.takenLabel as string, cal.takenLabel as string]) {
        expect(label).toContain('{{name}}');
        expect(label.toLowerCase().startsWith(today.toLowerCase())).toBe(false);
      }
      expect(meds.takenLabel).toBe(cal.takenLabel);
    });
  }

  it('en reads "Taken" / "Mark {{name}} as taken"', () => {
    expect(load('en', 'meds').taken).toBe('Taken');
    expect(load('en', 'meds').takenLabel).toBe('Mark {{name}} as taken');
  });
});

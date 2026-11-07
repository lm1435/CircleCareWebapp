// @vitest-environment node
/**
 * Spanish 12-hour clocks end in a period ("8:00 p. m."), so a copy string that puts a period straight
 * after a time placeholder renders "p. m..". Mobile hit it on the days-on/off hint (shifts:form.cycleHint24).
 * Rule: in `es`, a time placeholder is never directly followed by ".". Reword so it ends mid-sentence.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const DIR = join(process.cwd(), 'src', 'i18n', 'es');
const TIME = /\{\{(time|endTime|startTime|start|end|clock)\}\}\./;

function walk(node: unknown, path: string, out: Array<[string, string]>): void {
  if (typeof node === 'string') out.push([path, node]);
  else if (node && typeof node === 'object')
    for (const [k, v] of Object.entries(node)) walk(v, path ? `${path}.${k}` : k, out);
}

describe('es: no period directly after a time placeholder', () => {
  const strings: Array<[string, string]> = [];
  for (const f of readdirSync(DIR).filter((n) => n.endsWith('.json'))) {
    walk(JSON.parse(readFileSync(join(DIR, f), 'utf8')), f.replace('.json', ''), strings);
  }
  it('finds none', () => {
    expect(strings.filter(([, v]) => TIME.test(v)).map(([k]) => k)).toEqual([]);
  });
  it('the days-on/off back-to-back hint ends "uno tras otro." without touching the clock', () => {
    const hint = strings.find(([k]) => k === 'shifts.form.cycleHint24')?.[1];
    expect(hint).toBe('Cada día es un turno de {{start}} a {{end}}, uno tras otro.');
  });
});

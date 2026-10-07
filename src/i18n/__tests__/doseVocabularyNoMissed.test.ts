/**
 * Dose-status vocabulary ban (owner decision 2026-10-04): Taken / Taken late /
 * Skipped / Not marked. Never "missed" / "not taken" in user-facing dose copy.
 *
 * Only allowed hit: the activity-feed phrase table (`activity.json`
 * `phrases.missed`), wire-matched by the client substring translator
 * (project_activity_feed_localization) and therefore frozen.
 * Mobile twin: mobile/src/__tests__/bans/doseVocabularyNoMissed.test.ts.
 */
import * as fs from 'fs';
import * as path from 'path';

const BANNED =
  /\b(missed|not taken|did not take|didn't take|hasn't taken|no tomad[oa]s?|perdid[oa]s?)\b/i;
const ALLOWED = new Set(['activity.json:phrases.missed']);

function* leaves(o: unknown, p = ''): Generator<[string, string]> {
  if (typeof o === 'string') yield [p, o];
  else if (o && typeof o === 'object') {
    for (const [k, v] of Object.entries(o)) yield* leaves(v, p ? `${p}.${k}` : k);
  }
}

function scan(lng: string): { offenders: string[]; keys: Set<string> } {
  const dir = path.join(__dirname, '..', lng);
  const offenders: string[] = [];
  const keys = new Set<string>();
  for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.json'))) {
    const json = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    for (const [k, v] of leaves(json)) {
      const id = `${f}:${k}`;
      keys.add(id);
      if (BANNED.test(v) && !ALLOWED.has(id)) offenders.push(`${id}: ${v}`);
    }
  }
  return { offenders, keys };
}

describe('dose-status vocabulary: no "missed" in user-facing copy', () => {
  it.each(['en', 'es'])('%s namespaces have no banned dose wording', (lng) => {
    expect(scan(lng).offenders).toEqual([]);
  });

  it('the allowlist is not stale', () => {
    const { keys } = scan('en');
    for (const k of ALLOWED) expect(keys.has(k)).toBe(true);
  });

  it('the ban regex catches the old wordings (falsifier)', () => {
    for (const old of [
      "no one will be alerted if it's missed.",
      'the first alert would be the missed-dose follow-up',
      'Days with a missed or unmarked dose',
      'Marcado como no tomado al eliminar',
    ]) {
      expect(BANNED.test(old)).toBe(true);
    }
    expect(BANNED.test('Dismissed')).toBe(false);
  });
});

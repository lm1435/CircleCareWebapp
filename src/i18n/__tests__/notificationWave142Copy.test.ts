/**
 * 1.4.2 notification wave copy (grouped dose alerts, split switch, quiet-circle back-off):
 * every key in every base locale, the plurals render at 1 and 2 in every locale (through the
 * real fallback chain variant -> base -> en), and never "missed" in any language.
 */
// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import i18next from 'i18next';
import { describe, expect, it } from 'vitest';

const DIR = join(process.cwd(), 'src', 'i18n');
const LOCALES = ['en', 'es', 'de', 'fr', 'fr-CA', 'it', 'pt', 'pt-PT'] as const;
const BASES = ['en', 'es', 'de', 'fr', 'it', 'pt'] as const;
const read = (code: string, ns: string): Record<string, unknown> =>
  JSON.parse(readFileSync(join(DIR, code, `${ns}.json`), 'utf8'));

function flatten(o: unknown, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  if (!o || typeof o !== 'object') return out;
  for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object') Object.assign(out, flatten(v, key));
    else out[key] = String(v);
  }
  return out;
}

/** The new strings of one locale (only what that locale's files carry). */
function waveStrings(code: string): Record<string, string> {
  const meds = read(code, 'meds') as { doseAlerts?: unknown };
  const common = read(code, 'common') as { inbox?: { slot?: unknown }; pageTitles?: { routineCheckIn?: string } };
  const profile = read(code, 'profile') as { notifications?: { groups?: Record<string, string> } };
  const groups = profile.notifications?.groups ?? {};
  return {
    ...flatten(meds.doseAlerts, 'meds:doseAlerts'),
    ...flatten(common.inbox?.slot, 'common:inbox.slot'),
    ...(common.pageTitles?.routineCheckIn ? { 'common:pageTitles.routineCheckIn': common.pageTitles.routineCheckIn } : {}),
    ...Object.fromEntries(
      Object.entries(groups)
        .filter(([k]) => k.startsWith('doses'))
        .map(([k, v]) => [`profile:notifications.groups.${k}`, v])
    ),
  };
}

const MISSED = /\b(miss|missed|missing)\b|perdid|olvidad|verpasst|versäumt|manqu|dimenticat|perse\b|perso\b|esquecid|perdeu/i;

describe('1.4.2 notification wave copy', () => {
  const en = waveStrings('en');

  it('en carries the full set', () => {
    expect(Object.keys(en).length).toBeGreaterThanOrEqual(40);
    expect(en['meds:doseAlerts.notice.title']).toBe('Follow-up alerts are paused');
    expect(en['profile:notifications.groups.dosesNotMarked']).toBe('Doses not marked');
  });

  it.each(BASES)('%s has every key en has (base locales are complete)', (code) => {
    const mine = waveStrings(code);
    expect(Object.keys(en).filter((k) => !(k in mine))).toEqual([]);
  });

  it.each(LOCALES)('N %s never says "missed" (Taken / Skipped / Not marked vocabulary)', (code) => {
    for (const [key, value] of Object.entries(waveStrings(code))) {
      expect(`${key}: ${value}`).not.toMatch(MISSED);
    }
  });

  it.each(LOCALES)('N %s: no emojis and no day count in the paused copy', (code) => {
    for (const value of Object.values(waveStrings(code))) {
      expect(value).not.toMatch(/\p{Extended_Pictographic}/u);
    }
    const notice = waveStrings(code)['meds:doseAlerts.notice.body'] ?? en['meds:doseAlerts.notice.body'];
    expect(notice).not.toMatch(/\d/);
  });

  it.each(LOCALES)('P %s: slot plurals render at 1 and at 2 through the real fallback chain', async (code) => {
    const instance = i18next.createInstance();
    const base = code.split('-')[0];
    const chain = code === base ? [code, 'en'] : [code, base, 'en'];
    await instance.init({
      lng: code,
      fallbackLng: chain.slice(1),
      ns: ['common'],
      defaultNS: 'common',
      resources: Object.fromEntries(chain.map((c) => [c, { common: read(c, 'common') }])),
      interpolation: { escapeValue: false },
    });
    for (const key of ['due', 'notMarked', 'allTaken', 'taken', 'skipped']) {
      const one = instance.t(`inbox.slot.${key}`, { count: 1 });
      const two = instance.t(`inbox.slot.${key}`, { count: 2 });
      expect(one).not.toBe(`inbox.slot.${key}`);
      expect(two).not.toBe(`inbox.slot.${key}`);
      expect(two).toContain('2');
      expect(one).not.toBe(two);
      // `allTaken` at 1 is the bare status word ("Taken"); the rest name the count.
      if (key !== 'allTaken') expect(one).toContain('1');
    }
  });
});

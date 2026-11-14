/**
 * 1.4.2 copy pass (docs/plans/cognitive-overload-1-4-2.md item 7). Mobile parity:
 * mobile/src/__tests__/i18n/cognitiveOverloadCopy142.test.ts.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '..');
function load(lang: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (o: unknown, p: string) => {
    if (typeof o === 'string') out[p] = o;
    else if (o && typeof o === 'object')
      for (const [k, v] of Object.entries(o)) walk(v, p ? `${p}.${k}` : k);
  };
  for (const f of fs.readdirSync(path.join(root, lang)).filter((x) => x.endsWith('.json'))) {
    walk(JSON.parse(fs.readFileSync(path.join(root, lang, f), 'utf8')), f.replace('.json', ''));
  }
  return out;
}
const EN = load('en');
const ES = load('es');
// The activity feed is matched by substring across locales: its strings are never renamed.
const isFeed = (k: string) => k.startsWith('activity.');

describe('copy pass 1.4.2 (web)', () => {
  it('POSITIVE: the escalation title reads "If nobody marks the dose" (EN) / "Si nadie marca la dosis" (ES, PT, DE already plain)', () => {
    expect(EN['calendar.settings.notificationInfo.escalationTitle'] ?? Object.entries(EN).find(([k]) => k.endsWith('escalationTitle'))![1]).toBe('If nobody marks the dose');
    expect(Object.entries(ES).find(([k]) => k.endsWith('escalationTitle'))![1]).toBe('Si nadie marca la dosis');
    expect(Object.entries(load('pt')).find(([k]) => k.endsWith('escalationTitle'))![1]).toBe('Se ninguém marcar a dose');
  });

  it('POSITIVE: the EN medication action is "Stop"', () => {
    expect(EN['meds.medications.actions.discontinue'] ?? Object.entries(EN).find(([k]) => k.startsWith('meds.') && k.endsWith('.discontinue'))![1]).toBe('Stop');
    expect(Object.entries(EN).find(([k]) => k === 'calendar.discontinueMed.discontinue')![1]).toBe('Stop');
  });

  it('NEGATIVE: no user-facing EN string says "Escalation alerts", "adherence log" or the verb "Discontinue"', () => {
    const bad = Object.entries(EN).filter(
      ([k, v]) => !isFeed(k) && /escalation alerts|adherence log|\bdiscontinue\b/i.test(v)
    );
    expect(bad).toEqual([]);
  });

  it('NEGATIVE: the touched labels never use "missed"', () => {
    for (const [k, v] of Object.entries(EN)) {
      if (/escalationTitle|discontinue(Med)?\.(title|discontinue)$/.test(k)) expect(v).not.toMatch(/\bmissed\b/i);
    }
  });

  it('NEGATIVE: Spanish never calls the owner role "dueño" or "propietario"', () => {
    const bad = Object.entries(ES).filter(([, v]) => /dueñ|propietari/i.test(v));
    expect(bad).toEqual([]);
  });

  it('NEGATIVE: the Spanish invite errors say "persona cuidada", never "receptor de cuidado" (activity feed excepted)', () => {
    const bad = Object.entries(ES).filter(
      ([k, v]) => k.startsWith('members.') && /receptor de cuidado/i.test(v)
    );
    expect(bad).toEqual([]);
    expect(ES['invite.roles.care_recipient']).toBe('Persona cuidada');
  });
});

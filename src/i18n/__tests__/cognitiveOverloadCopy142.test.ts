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

  it('POSITIVE: the EN medication action stays "Discontinue" (owner decision 2026-11-13)', () => {
    expect(EN['meds.medications.actions.discontinue'] ?? Object.entries(EN).find(([k]) => k.startsWith('meds.') && k.endsWith('.discontinue'))![1]).toBe('Discontinue');
    expect(Object.entries(EN).find(([k]) => k === 'calendar.discontinueMed.discontinue')![1]).toBe('Discontinue');
  });

  it('NEGATIVE: no user-facing EN string says "Escalation alerts" or "adherence log"', () => {
    const bad = Object.entries(EN).filter(
      ([k, v]) => !isFeed(k) && /escalation alerts|adherence log/i.test(v)
    );
    expect(bad).toEqual([]);
  });

  it('NEGATIVE: the discontinue action and its confirm/toast never say "Stop"', () => {
    for (const k of ['calendar.discontinueMed.discontinue', 'calendar.discontinueMed.title', 'calendar.discontinueMed.discontinuedToast']) {
      const v = EN[k];
      if (v !== undefined) expect(v).not.toMatch(/^Stop\b|stopped$/);
    }
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

  it('POSITIVE: Spanish join flow, delete dialog, FAQ and activity feed say "persona cuidada"', () => {
    expect(ES['circles.joinModal.careRecipientExists']).toMatch(/una persona cuidada/);
    expect(ES['circles.create.recipientName']).toBe('Nombre de la persona cuidada');
    expect(ES['invite.acceptRecipientExists']).toMatch(/una persona cuidada/);
    expect(
      Object.values(ES).some((v) => /La Persona cuidada es quien recibe el cuidado/.test(v))
    ).toBe(true);
    expect(ES['activity.phrases.joinedAsCareRecipient']).toBe('se unió al círculo como persona cuidada');
    expect(ES['activity.entries.memberJoined.careRecipient']).toBe(
      '{{name}} se unió al círculo como persona cuidada'
    );
  });

  it('NEGATIVE: no user-facing Spanish string (app, FAQ, help articles) says "receptor de cuidado", feed included', () => {
    const bad = Object.entries(ES).filter(([, v]) => /receptor(a)? de cuidado/i.test(v));
    expect(bad).toEqual([]);
    const help = fs.readFileSync(path.resolve(__dirname, '../../help/content.json'), 'utf8');
    expect(help).not.toMatch(/receptor(a)? de cuidado/i);
  });
});

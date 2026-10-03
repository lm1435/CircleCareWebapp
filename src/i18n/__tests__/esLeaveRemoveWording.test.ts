/**
 * LEAVING A CIRCLE, REMOVING A MEMBER, AND THE CARE RECIPIENT: ONE SPANISH
 * VOCABULARY ACROSS WEB AND MOBILE.
 *
 * Twin of mobile/src/__tests__/i18n/esLeaveRemoveWording.test.ts (which also
 * compares the two platforms string for string). Mobile used to say "Abandonar
 * círculo", "Remover miembro" and "como paciente"; this side says "Salir",
 * "Eliminar" and "receptor de cuidado", and the activity feed on both clients
 * says "salió del círculo" / "Se eliminó a … del círculo". This pins the web
 * half so it cannot drift back.
 *
 * Also pinned: the access-lost screen says "Acceso eliminado" / "te haya
 * eliminado" (it used to say "removido", a gendered participle aimed at a
 * person, and the backend push and e-mail said "Has sido removido"), and the
 * emergency-info feed entry is one sentence with mobile.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ES_DIR = join(HERE, '..', 'es');
const EN_DIR = join(HERE, '..', 'en');

type Bundle = Record<string, unknown>;

function flatten(bundle: Bundle, prefix = ''): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const [key, value] of Object.entries(bundle)) {
    const dotted = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object') out.push(...flatten(value as Bundle, dotted));
    else if (typeof value === 'string') out.push([dotted, value]);
  }
  return out;
}

const namespaces = readdirSync(ES_DIR)
  .filter((f) => f.endsWith('.json'))
  .map((f) => f.replace(/\.json$/, ''));
const read = (ns: string): Bundle => JSON.parse(readFileSync(join(ES_DIR, `${ns}.json`), 'utf8'));
const readEn = (ns: string): Bundle => JSON.parse(readFileSync(join(EN_DIR, `${ns}.json`), 'utf8'));
const ALL = namespaces.flatMap((ns) => flatten(read(ns), ns));
const ALL_EN = namespaces.flatMap((ns) => flatten(readEn(ns), ns));

describe('web ES: the retired words are absent', () => {
  it.each([
    ['Abandonar / abandonó / abandonado ...', /\babandon/i],
    ['Remover (the verb)', /\bremover\b/i],
    ['removido / removida (a person taken out of a circle)', /\bremovid[oa]s?\b/i],
    ['paciente', /\bpaciente/i],
  ])('no string contains %s', (_label, pattern) => {
    expect(ALL.filter(([, value]) => pattern.test(value)).map(([key]) => key)).toEqual([]);
  });
});

describe('web EN: the care recipient is never a "patient"', () => {
  it('no string contains patient', () => {
    expect(ALL_EN.filter(([, value]) => /\bpatients?\b/i.test(value)).map(([key]) => key)).toEqual([]);
  });
});

describe('web ES: leaving says "salir", removing a member says "eliminar"', () => {
  const manage = (read('members') as any).manage;

  it('leave', () => {
    expect(manage.leave).toBe('Salir del círculo');
    expect(manage.leaveConfirmTitle).toBe('¿Salir de este círculo?');
    expect(manage.leaveSuccess).toBe('Saliste del círculo.');
  });

  it('remove member', () => {
    expect(manage.remove).toBe('Eliminar');
    expect(manage.removeMemberLabel).toBe('Eliminar a {{name}}');
    expect(manage.removeConfirmTitle).toBe('¿Eliminar miembro?');
    expect(manage.removeSuccess).toBe('Se eliminó a {{name}} de este círculo.');
  });

  it('losing access says "eliminar", impersonal and gender-neutral', () => {
    const lost = (read('circles') as any).accessLost;
    expect(lost.removedTitle).toBe('Acceso eliminado');
    expect(lost.removedBody).toBe(
      'Ya no tienes acceso a este círculo. Es posible que el dueño te haya eliminado de él o que haya eliminado el círculo.'
    );
  });

  it('the emergency-info feed entry is verb-first, EN and ES', () => {
    expect((read('activity') as any).phrases.updatedEmergencyInfo).toBe(
      'Actualizó la información de emergencia'
    );
    expect((readEn('activity') as any).phrases.updatedEmergencyInfo).toBe('Updated emergency info');
  });

  it('the care recipient is the care recipient in the legacy feed phrases', () => {
    const phrases = (read('activity') as any).phrases;
    expect(phrases.joinedAsCareRecipient).toBe('se unió al círculo como receptor de cuidado');
    expect(phrases.toJoinAsCareRecipient).toBe('a unirse como receptor de cuidado');
  });
});

/**
 * 1.4.2: the in-app help (shared with mobile) tells people they can mark a dose from the reminder
 * notification: "I took it" / "Skip", press and hold on iPhone, expand on Android, and only the
 * reminder itself (plus the 15-minute follow-up to the care recipient) has them. Web has no push
 * notifications and no reminders explainer, so the help is the only web surface.
 * Button titles are the mobile app's notifications.actions.taken / .skip in each language.
 * Mobile parity: mobile/src/__tests__/i18n/notificationActionsTip.test.ts.
 */
import { describe, expect, it } from 'vitest';
import help from '../content.json';

type Article = { slug: string; body: string };
const ARTICLES = (help as unknown as { articles: Record<string, Article[]> }).articles;

const L: Record<
  string,
  { taken: string; skip: string; hold: RegExp; expand: RegExp; buttons: RegExp; others: RegExp; none: string }
> = {
  en: { taken: 'I took it', skip: 'Skip', hold: /press and hold/, expand: /expand the notification/, buttons: /buttons/, others: /caregivers|other people|everyone/i, none: 'have no buttons' },
  es: { taken: 'Lo tomé', skip: 'Omitir', hold: /mantén presionada/, expand: /despliega la notificación/, buttons: /botones/, others: /cuidadores|otras personas|todos/i, none: 'no tienen botones' },
  de: { taken: 'Eingenommen', skip: 'Auslassen', hold: /gedrückt/, expand: /Klappen Sie die Benachrichtigung auf/, buttons: /Schaltflächen/, others: /Pflegepersonen|andere Personen|alle im Kreis/i, none: 'haben keine Schaltflächen' },
  fr: { taken: 'Je l’ai pris', skip: 'Sauter', hold: /appuyez longuement/, expand: /développez la notification/, buttons: /boutons/, others: /aidants|autres membres|tout le cercle/i, none: 'n’ont pas de boutons' },
  it: { taken: "L'ho presa", skip: 'Salta', hold: /tieni premuta/, expand: /espandi la notifica/, buttons: /pulsanti/, others: /caregiver|altre persone|tutti/i, none: 'non hanno pulsanti' },
  pt: { taken: 'Tomei', skip: 'Pular', hold: /toque e segure/, expand: /expanda a notificação/, buttons: /botões/, others: /cuidadores|outras pessoas|todos/i, none: 'não têm botões' },
};

const sentences = (body: string) => body.split(/(?<=[.!?])\s+|\n+/).filter(Boolean);
/** A sentence about the buttons AND about alerts for other people must say they have none. */
const claimsButtonsForOthers = (body: string, l: (typeof L)[string]) =>
  sentences(body).some(
    (s) => (l.buttons.test(s) || s.includes(l.taken)) && l.others.test(s) && !s.includes(l.none)
  );
const body = (lng: string) => ARTICLES[lng].find((a) => a.slug === 'reminders-and-alerts')!.body;

describe('help: mark a dose from the reminder notification (web bundle, 1.4.2)', () => {
  it('covers every help language in the bundle', () => {
    expect(Object.keys(ARTICLES).sort()).toEqual(Object.keys(L).sort());
  });

  it.each(Object.keys(L))(
    'POSITIVE (%s): names both buttons, press and hold on iPhone, expand on Android',
    (lng) => {
      const l = L[lng];
      expect(body(lng)).toContain(`**${l.taken}**`);
      expect(body(lng)).toContain(`**${l.skip}**`);
      expect(body(lng)).toMatch(new RegExp(`\\*\\*iPhone\\s?:\\*\\*[^\\n]*${l.hold.source}`));
      expect(body(lng)).toMatch(new RegExp(`\\*\\*Android\\s?:\\*\\*[^\\n]*${l.expand.source}`));
      expect(body(lng)).toContain(l.none);
    }
  );

  it.each(Object.keys(L))('NEGATIVE (%s): never says the alerts to other people have the buttons', (lng) => {
    expect(claimsButtonsForOthers(body(lng), L[lng])).toBe(false);
  });

  it('NEGATIVE: the detector catches a sentence that gives caregivers the buttons', () => {
    expect(claimsButtonsForOthers('The alerts to caregivers have the same buttons.', L.en)).toBe(true);
  });

  it('NEGATIVE: the 1.4.2 dose-switch text (CircleCareWeb 9a95cca) is still in the export', () => {
    expect(body('en')).toContain('**Doses taken** and **Doses not marked**');
  });
});

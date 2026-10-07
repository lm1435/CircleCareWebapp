/**
 * French (fr) activity word-order twin (from activityTranslationSnapshot.template.test.ts.template).
 * Writes its OWN snapshot; reviewed against the concatenation sites in activityTranslation.ts
 * (skippedEvent + title + onDate + date, stoppedRecurrence + title + fromDate + date, prefix
 * phrases + English-order remainder, parenthesised markers). Reads src/i18n/fr/activity.json
 * (fr-CA is overlaid on fr), so it runs before the registry flip.
 *
 * HARNESS GAP (shared helper not edited; same workaround as the de / it / pt twins): i18next's
 * LanguageUtil caches supportedLngs (['en','es']) at init, so a dormant code resolves to the
 * English fallback and the template alone snapshots ENGLISH. Admit the code (and its base) for
 * this file, and pin French lines first so an English snapshot can never be written again.
 */
import { afterAll, beforeAll, expect, it } from 'vitest';
import i18n from '@/i18n';
import { translateActivityDescription } from '@/components/activity/activityTranslation';
import { activityTFor, defineActivityLocaleTwin } from './helpers/activityLocaleTwin';

const LOCALE = 'fr';
const ADMIT = ['fr', LOCALE];
const N = '\u202F';

type Lu = { supportedLngs: string[] | false; options: { supportedLngs?: string[] | false } };
const lu = (): Lu => (i18n.services as unknown as { languageUtils: Lu }).languageUtils;
let saved: { cached: string[] | false; opt: string[] | false | undefined } | null = null;
beforeAll(() => {
  saved = { cached: lu().supportedLngs, opt: lu().options.supportedLngs };
  const cur = Array.isArray(saved.cached) ? saved.cached : [];
  const add = ADMIT.filter((c) => !cur.includes(c));
  if (cur.length && add.length) {
    lu().supportedLngs = [...cur, ...add];
    lu().options.supportedLngs = [...cur, ...add];
  }
});
afterAll(() => {
  if (saved) {
    lu().supportedLngs = saved.cached;
    lu().options.supportedLngs = saved.opt;
  }
});

it('renders French, not the English fallback', () => {
  expect(translateActivityDescription('Confirmed Medication: Aspirin (taken)', activityTFor(LOCALE), LOCALE)).toBe(
    `Médicament confirmé${N}: Aspirin (dose prise)`
  );
  expect(translateActivityDescription('Invited a@b.co to join as Caregiver', activityTFor(LOCALE), LOCALE)).toBe(
    'Invitation envoyée à a@b.co pour rejoindre le cercle en tant qu’aidant'
  );
});

defineActivityLocaleTwin(LOCALE);

/**
 * German (de) activity word-order twin (from activityTranslationSnapshot.template.test.ts.template).
 * Writes its OWN snapshot (`__snapshots__/activityTranslationSnapshot.de.test.ts.snap`); review it
 * against the concatenation sites in activityTranslation.ts (skippedEvent + title + onDate + date,
 * stoppedRecurrence + title + fromDate + date, prefix phrases + English-order remainder,
 * parenthesised markers). Reads src/i18n/de/activity.json, so it runs before the registry flip.
 *
 * HARNESS GAP (reported, shared helper not edited): `activityTFor` registers the bundle, but
 * i18next's LanguageUtil caches `supportedLngs` (['en','es']) at init, so a dormant code
 * resolves to the English fallback and the template alone snapshots ENGLISH. Admit `de` for the
 * duration of this file (same workaround as the it / pt twins) and pin one German line first so
 * an English snapshot can never be written again.
 */
import { afterAll, beforeAll, expect, it } from 'vitest';
import i18n from '@/i18n';
import { translateActivityDescription } from '@/components/activity/activityTranslation';
import { activityTFor, defineActivityLocaleTwin } from './helpers/activityLocaleTwin';

const LOCALE = 'de';

type Lu = { supportedLngs: string[] | false; options: { supportedLngs?: string[] | false } };
const lu = (): Lu => (i18n.services as unknown as { languageUtils: Lu }).languageUtils;
let saved: { cached: string[] | false; opt: string[] | false | undefined } | null = null;
beforeAll(() => {
  saved = { cached: lu().supportedLngs, opt: lu().options.supportedLngs };
  const cur = Array.isArray(saved.cached) ? saved.cached : [];
  if (cur.length && !cur.includes(LOCALE)) {
    lu().supportedLngs = [...cur, LOCALE];
    lu().options.supportedLngs = [...cur, LOCALE];
  }
});
afterAll(() => {
  if (saved) {
    lu().supportedLngs = saved.cached;
    lu().options.supportedLngs = saved.opt;
  }
});

it('renders German, not the English fallback', () => {
  expect(translateActivityDescription('Confirmed Medication: Aspirin (taken)', activityTFor(LOCALE), LOCALE)).toBe(
    'Medikament bestätigt: Aspirin (eingenommen)'
  );
  expect(translateActivityDescription('Invited a@b.co to join as Caregiver', activityTFor(LOCALE), LOCALE)).toBe(
    'Einladung an a@b.co zum Beitritt als Pflegeperson'
  );
});

defineActivityLocaleTwin(LOCALE);

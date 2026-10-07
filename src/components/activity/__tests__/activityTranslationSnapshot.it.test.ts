/**
 * Italian activity-feed word-order twin (from
 * activityTranslationSnapshot.template.test.ts.template). Writes its OWN snapshot;
 * reads src/i18n/it/activity.json, so it runs before the registry flip.
 *
 * PRE-FLIP WORKAROUND (lane-local): `@/i18n` is initialised with
 * `supportedLngs: SUPPORTED_LOCALES` (en, es), so i18next silently resolves an
 * unregistered `it` to the `en` fallback and the twin snapshotted ENGLISH. The
 * shared harness cannot see it (es is registered). Admit `it` for the duration of
 * this file only, and assert the output really is Italian so the trap cannot
 * recur silently. Drop the workaround at the flip.
 */
import { afterAll, beforeAll, expect, it } from 'vitest';
import i18n from '@/i18n';
import { translateActivityDescription } from '@/components/activity/activityTranslation';
import { activityTFor, defineActivityLocaleTwin } from './helpers/activityLocaleTwin';

const LOCALE = 'it';

// i18next's LanguageUtil caches its own `supportedLngs` copy at init.
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

it('renders Italian, not the English fallback', () => {
  expect(translateActivityDescription('Confirmed Medication: Aspirin (taken)', activityTFor(LOCALE), LOCALE)).toBe(
    'Farmaco confermato: Aspirin (dose presa)'
  );
});

defineActivityLocaleTwin(LOCALE);

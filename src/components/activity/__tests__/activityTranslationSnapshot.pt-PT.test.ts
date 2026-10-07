/**
 * European Portuguese activity-feed word-order twin (from
 * activityTranslationSnapshot.template.test.ts.template). Writes its OWN snapshot;
 * reads src/i18n/pt-PT/activity.json (a variant is overlaid on its base file), so it
 * runs before the registry flip.
 *
 * PRE-FLIP WORKAROUND (lane-local, same as the it twin): `@/i18n` is initialised
 * with `supportedLngs: SUPPORTED_LOCALES` (en, es), so i18next silently resolves an
 * unregistered `pt-PT` to the `en` fallback and the twin snapshots ENGLISH. Admit the
 * locale for the duration of this file only, and assert the output really is
 * Portuguese so the trap cannot recur silently. Drop the workaround at the flip.
 */
import { afterAll, beforeAll, expect, it } from 'vitest';
import i18n from '@/i18n';
import { translateActivityDescription } from '@/components/activity/activityTranslation';
import { activityTFor, defineActivityLocaleTwin } from './helpers/activityLocaleTwin';

const LOCALE = 'pt-PT';
const ADMIT = [...new Set(['pt', LOCALE])];

// i18next's LanguageUtil caches its own `supportedLngs` copy at init.
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

it('renders Portuguese, not the English fallback', () => {
  expect(translateActivityDescription('Confirmed Medication: Aspirin (taken)', activityTFor(LOCALE), LOCALE)).toBe(
    'Medicamento confirmado: Aspirin (tomado)'
  );
  expect(translateActivityDescription('Not taken: Aspirin on 2026-01-15', activityTFor(LOCALE), LOCALE)).toMatch(
    /^Dose saltada: Aspirin /
  );
});

defineActivityLocaleTwin(LOCALE);

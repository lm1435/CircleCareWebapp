/**
 * HARNESS for a per-locale activity-feed word-order twin.
 *
 * A language lane creates `activityTranslationSnapshot.<code>.test.ts` (copy the
 * `.template` next to it) containing only:
 *
 *   import { defineActivityLocaleTwin } from './helpers/activityLocaleTwin';
 *   const LOCALE = '<code>';
 *   defineActivityLocaleTwin(LOCALE);
 *
 * It renders every probe in `activityLocaleProbes.ts` through the locale's `activity.json`
 * read STRAIGHT FROM DISK (`src/i18n/<code>/activity.json`; a variant is layered over its
 * base's file), so it runs BEFORE the registry flip. Output is locked with
 * `toMatchSnapshot()` into the twin's OWN `__snapshots__/activityTranslationSnapshot.<code>.test.ts.snap`;
 * the en/es lock is never touched. The translator reviews that snapshot against the
 * concatenation sites (see docs/plans/stage1-language-lanes.md).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import i18n from '@/i18n';
import { isSupportedLocale } from '@/i18n/locales';
import { translateActivityDescription } from '@/components/activity/activityTranslation';
import {
  DATED_CASES,
  KEYED_CASES,
  KEYED_TIME_CASES,
  NOW,
  PHRASE_CASES,
  SENTENCE_CASES,
  probeSet,
} from './activityLocaleProbes';

const I18N_DIR = join(process.cwd(), 'src', 'i18n');

type Bundle = Record<string, unknown>;
const deepMerge = (a: Bundle, b: Bundle): Bundle => {
  const out: Bundle = { ...a };
  for (const [k, v] of Object.entries(b)) {
    const cur = out[k];
    out[k] =
      v && typeof v === 'object' && cur && typeof cur === 'object'
        ? deepMerge(cur as Bundle, v as Bundle)
        : v;
  }
  return out;
};

/** The locale's `activity` bundle from disk (variant = base file overlaid by its own sparse file). */
export function loadActivityBundle(code: string): Bundle {
  const read = (c: string): Bundle => {
    const f = join(I18N_DIR, c, 'activity.json');
    if (!existsSync(f)) throw new Error(`activity twin: missing ${f}`);
    return JSON.parse(readFileSync(f, 'utf8')) as Bundle;
  };
  const base = code.includes('-') ? code.split('-')[0] : null;
  return base && existsSync(join(I18N_DIR, base, 'activity.json'))
    ? deepMerge(read(base), read(code))
    : read(code);
}

/**
 * A fixed `t` for `code`.
 *
 * A REGISTERED locale (every Stage 1 code since the 1.2.2 flip) renders through the
 * app's real i18n instance: the bundle the loader map ships and the real fallback
 * chain (fr-CA -> fr -> en), so the snapshot is what a user sees, and the time
 * helpers (meridiem, place names) resolve the variant's own rows instead of the
 * English fallback an unregistered tag got. The bundle is asserted equal to the
 * on-disk file first, so a loader serving the wrong chunk fails here. Only an
 * UNREGISTERED tag (a future lane, pre-flip) is still injected from disk.
 */
export function activityTFor(code: string) {
  if (isSupportedLocale(code)) {
    const live = i18n.getResourceBundle(code, 'activity') as Bundle | undefined;
    const own = JSON.parse(readFileSync(join(I18N_DIR, code, 'activity.json'), 'utf8')) as Bundle;
    expect(live, `${code} activity bundle is not loaded from its locale chunk`).toEqual(own);
    return i18n.getFixedT(code, 'activity');
  }
  i18n.addResourceBundle(code, 'activity', loadActivityBundle(code), true, true);
  return i18n.getFixedT(code, 'activity');
}

/** Same pinned frame as the en/es lock: viewer zone Denver, now = 2026-10-06 18:00Z. */
export function installActivityFrame(): void {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({
      timeZone: 'America/Denver',
    } as Intl.ResolvedDateTimeFormatOptions);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });
}

export function defineActivityLocaleTwin(code: string): void {
  installActivityFrame();
  const t = () => activityTFor(code);

  describe(`activity word order (${code})`, () => {
    it('SENTENCE_RULES', () => {
      expect(probeSet(SENTENCE_CASES, t(), code)).toMatchSnapshot();
    });
    it('legacy phrase substitution', () => {
      expect(probeSet(PHRASE_CASES, t(), code)).toMatchSnapshot();
    });
    it('dated / regex forms', () => {
      expect(probeSet(DATED_CASES, t(), code)).toMatchSnapshot();
    });
    it('KEY_RENDERERS 12h', () => {
      expect(probeSet(KEYED_CASES, t(), code)).toMatchSnapshot();
    });
    it('KEY_RENDERERS 24h', () => {
      expect(probeSet(KEYED_TIME_CASES, t(), code, { hourCycle: '24h' })).toMatchSnapshot();
    });
    it('zone-labelled time, recipient zone differs (Tokyo)', () => {
      expect(probeSet(KEYED_TIME_CASES, t(), code, { timezone: 'Asia/Tokyo' })).toMatchSnapshot();
    });
    it('Today/Yesterday in the recipient frame (Tokyo)', () => {
      const cases = KEYED_CASES.filter(([n]) => n.startsWith('not taken'));
      expect(probeSet(cases, t(), code, { timezone: 'Asia/Tokyo' })).toMatchSnapshot();
    });
    it('null timezone fallback', () => {
      const cases = KEYED_CASES.filter(([n]) => n === 'rescheduled' || n === 'joined caregiver');
      expect(probeSet(cases, t(), code, { timezone: null })).toMatchSnapshot();
    });
    it('phrase dates (formatDateShort) and the stopped-recurrence concat site', () => {
      expect([
        translateActivityDescription('Not taken: Aspirin on 2026-01-15', t(), code),
        translateActivityDescription('Stopped recurrence for Aspirin from 2026-01-15', t(), code),
      ]).toMatchSnapshot();
    });
  });
}

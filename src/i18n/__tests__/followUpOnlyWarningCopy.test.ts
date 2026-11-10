/**
 * FOLLOW-UP-ONLY WARNING COPY (owner 2026-11-09, copy LOCKED, web + mobile).
 *
 * A medication with the master switch on, "at the scheduled time" off and all
 * four earlier reminders off still gets the 15 / 30 / 60 minute missed-dose
 * alerts. AddEventModal warns about it with `calendar:addEvent.reminders.
 * followUpOnly{Title,Body}`. This pins:
 *   1. the locked EN copy, verbatim;
 *   2. every web base locale carries both keys, translated (not English);
 *   3. PARITY WITH MOBILE: wherever mobile's en.json holds the same locked EN
 *      title/body, each mobile locale's string at that path must equal web's.
 *      Mobile's key path is found by VALUE, so this needs no edit when the
 *      mobile lane lands (and is a no-op until it does).
 */
// @vitest-environment node
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const TITLE = 'Reminders are off — follow-up alerts are not';
const BODY =
  "If a dose isn't marked as taken, CircleCare still alerts the circle: after 15 minutes, 30 minutes, and 1 hour. Turn off Notifications above to silence everything for this medication.";

const WEB = join(process.cwd(), 'src', 'i18n');
const MOBILE = join(process.cwd(), '..', 'mobile', 'src', 'i18n', 'locales');
/** Web base locales that own a full calendar.json (fr-CA / pt-PT are overlays). */
const WEB_LOCALES = ['en', 'es', 'de', 'fr', 'it', 'pt'] as const;
/** Mobile locale file for each web locale (mobile writes overlays as full bundles). */
const PARITY_LOCALES = ['es', 'de', 'fr', 'it', 'pt', 'pt-PT', 'fr-CA'] as const;

type Json = Record<string, unknown>;
const read = (path: string): Json => JSON.parse(readFileSync(path, 'utf8')) as Json;

function webReminders(code: string): Json | undefined {
  const path = join(WEB, code, 'calendar.json');
  if (!existsSync(path)) return undefined;
  const addEvent = read(path).addEvent as Json | undefined;
  return addEvent?.reminders as Json | undefined;
}

/** Web's effective string: the overlay's own value, else its base locale's. */
function webString(code: string, key: string): string | undefined {
  const own = webReminders(code)?.[key];
  if (typeof own === 'string') return own;
  const base = code.split('-')[0];
  return base !== code ? (webReminders(base)?.[key] as string | undefined) : undefined;
}

function findPath(node: unknown, value: string, path: string[] = []): string[] | null {
  if (typeof node === 'string') return node === value ? path : null;
  if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node as Json)) {
      const hit = findPath(v, value, [...path, k]);
      if (hit) return hit;
    }
  }
  return null;
}

function at(node: unknown, path: string[]): unknown {
  return path.reduce<unknown>((n, k) => (n && typeof n === 'object' ? (n as Json)[k] : undefined), node);
}

describe('follow-up-only warning copy', () => {
  it('EN is the locked copy, verbatim', () => {
    expect(webReminders('en')?.followUpOnlyTitle).toBe(TITLE);
    expect(webReminders('en')?.followUpOnlyBody).toBe(BODY);
  });

  it.each(WEB_LOCALES.filter((c) => c !== 'en'))('%s carries both keys, translated', (code) => {
    for (const key of ['followUpOnlyTitle', 'followUpOnlyBody']) {
      const value = webReminders(code)?.[key];
      expect(typeof value === 'string' && value.trim().length > 0, `${code} ${key}`).toBe(true);
      expect(value, `${code} ${key} is untranslated`).not.toBe(webReminders('en')?.[key]);
    }
  });

  it('matches mobile wherever mobile has landed the same locked copy', () => {
    const mobileEnPath = join(MOBILE, 'en.json');
    if (!existsSync(mobileEnPath)) return;
    const mobileEn = read(mobileEnPath);
    const pairs = [
      ['followUpOnlyTitle', findPath(mobileEn, TITLE)],
      ['followUpOnlyBody', findPath(mobileEn, BODY)],
    ] as const;
    const mismatches: string[] = [];
    for (const [key, path] of pairs) {
      if (!path) continue; // mobile has not landed this string yet
      for (const code of PARITY_LOCALES) {
        const file = join(MOBILE, `${code}.json`);
        if (!existsSync(file)) continue;
        const mobileValue = at(read(file), path);
        if (typeof mobileValue !== 'string') continue; // overlay without an override
        const web = webString(code, key);
        if (web !== mobileValue) mismatches.push(`${code} ${key}: web "${web}" ≠ mobile "${mobileValue}"`);
      }
    }
    expect(mismatches).toEqual([]);
  });
});

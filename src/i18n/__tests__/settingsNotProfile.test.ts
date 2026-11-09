/**
 * The design pass (2026-11-08) turned the old Profile page into "Settings"
 * (`profile:settingsList.title`, `common:pageTitles.profile`; rows Alerts,
 * Quiet hours, Subscription, Privacy & security, Account...). Copy that sends
 * people somewhere to change a setting must name THAT page. The medication
 * form's quiet-hours note still said "in Profile" (2026-11-09), and so did the
 * help answers, the sign-up analytics detail and the upgrade page.
 *
 * Ban: no string in any locale names the profile page, except the keys where
 * "Profile" is the header account-menu entry itself (`common:nav.profile`) or
 * the person's own profile (the "You" group, the trial line).
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const DIR = path.join(__dirname, '..');
const LOCALES = fs
  .readdirSync(DIR, { withFileTypes: true })
  .filter((d) => d.isDirectory() && !d.name.startsWith('__') && d.name !== 'format')
  .map((d) => d.name);

const PROFILE_WORD = /(^|[^\p{L}])(profile|perfil|profil|profilo)/iu;

/** `namespace:key` where the word is the profile itself, not a pointer to Settings. */
const GENUINE_PROFILE = new Set([
  'common:nav.profile', // header account-menu entry (its own label decision)
  'profile:settingsList.groups.you', // pt-PT "O seu perfil"
]);

function strings(obj: unknown, prefix = ''): Array<[string, string]> {
  if (typeof obj === 'string') return [[prefix, obj]];
  if (!obj || typeof obj !== 'object') return [];
  return Object.entries(obj as Record<string, unknown>).flatMap(([k, v]) =>
    strings(v, prefix ? `${prefix}.${k}` : k),
  );
}

function localeStrings(locale: string): Array<[string, string]> {
  const dir = path.join(DIR, locale);
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .flatMap((f) =>
      strings(JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))).map(
        ([k, v]) => [`${f.replace('.json', '')}:${k}`, v] as [string, string],
      ),
    );
}

const read = (locale: string, ns: string) => {
  const file = path.join(DIR, locale, `${ns}.json`);
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
};

describe('copy that points at Settings never says Profile', () => {
  it('finds every locale', () => {
    expect(LOCALES).toEqual(expect.arrayContaining(['en', 'es', 'fr', 'fr-CA', 'de', 'it', 'pt', 'pt-PT']));
  });

  it.each(LOCALES)('%s', (locale) => {
    const offenders = localeStrings(locale).filter(
      ([key, value]) => !GENUINE_PROFILE.has(key) && !key.endsWith('profileEnds') && PROFILE_WORD.test(value),
    );
    expect(offenders).toEqual([]);
  });
});

describe('the medication form quiet-hours note names the Settings page', () => {
  it.each(LOCALES)('%s', (locale) => {
    const parent = locale.split('-')[0];
    const warning: string =
      read(locale, 'calendar').addEvent?.quietHoursDoseWarning ?? read(parent, 'calendar').addEvent.quietHoursDoseWarning;
    const title: string =
      read(locale, 'profile').settingsList?.title ?? read(parent, 'profile').settingsList.title;
    expect(warning).toContain(title);
  });
});

// The upgrade page's "back" leaves for /profile, which is titled Settings. A
// regional locale (pt-PT) must not fall back to its parent's Settings word.
describe('the upgrade page back link names the Settings page', () => {
  it.each(LOCALES)('%s', (locale) => {
    const parent = locale.split('-')[0];
    const back: string = read(locale, 'upgrade').back ?? read(parent, 'upgrade').back;
    const title: string =
      read(locale, 'profile').settingsList?.title ?? read(parent, 'profile').settingsList.title;
    expect(back.toLowerCase()).toContain(title.toLowerCase());
  });
});

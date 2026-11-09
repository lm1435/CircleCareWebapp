/**
 * The design pass (2026-11-08) turned the old Profile page into "Settings"
 * (`profile:settingsList.title`, `common:pageTitles.profile`; rows Alerts,
 * Quiet hours, Subscription, Privacy & security, Account...). Copy that sends
 * people somewhere to change a setting must name THAT page. The medication
 * form's quiet-hours note still said "in Profile" (2026-11-09), and so did the
 * help answers, the sign-up analytics detail and the upgrade page.
 *
 * Ban: no string in any locale names the profile page, except the keys where
 * "Profile" is the person's own profile (the "You" group, the trial line).
 * Since 2026-11-09 the header account-menu entry (`common:nav.profile`) reads
 * Settings too: it opens /profile, whose page title is Settings.
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

// The account-menu entry opens /profile, whose page title is Settings, so it says Settings in
// every locale (owner decision 2026-11-09). A regional locale (pt-PT) must not fall back to its
// parent's word ("Configurações").
describe('the account-menu entry that opens /profile names the Settings page', () => {
  it.each(LOCALES)('%s', (locale) => {
    const parent = locale.split('-')[0];
    const entry: string = read(locale, 'common').nav?.profile ?? read(parent, 'common').nav.profile;
    const title: string =
      read(locale, 'profile').settingsList?.title ?? read(parent, 'profile').settingsList.title;
    expect(entry).toBe(title);
  });
});

// The help articles (exported from CircleCareWeb into src/help/content.json) sent people to
// "Profile" for quiet hours, alerts, export, units and the subscription until 2026-11-09, and
// named the web account menu's "Profile" entry until that entry became "Settings" the same day.
// No help string says Profile now.
describe('help articles point at Settings, never at Profile', () => {
  const helpStrings = (o: unknown, p = ''): Array<[string, string]> => {
    if (typeof o === 'string') return [[p, o]];
    if (Array.isArray(o)) return o.flatMap((v, i) => helpStrings(v, `${p}[${i}]`));
    if (o && typeof o === 'object') return Object.entries(o).flatMap(([k, v]) => helpStrings(v, `${p}.${k}`));
    return [];
  };
  it('content.json', () => {
    const json = JSON.parse(fs.readFileSync(path.join(__dirname, '../../help/content.json'), 'utf8'));
    const offenders = helpStrings(json)
      .filter(([, s]) => PROFILE_WORD.test(s))
      .map(([p]) => p);
    expect(offenders).toEqual([]);
  });
});

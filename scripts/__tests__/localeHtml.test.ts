// @vitest-environment node
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  EN_DESCRIPTION,
  EN_TITLE,
  LOCALE_DOCS,
  checkLocaleTable,
  parseRegistryCodes,
  renderLocaleDoc,
  // @ts-expect-error plain .mjs module without type declarations
} from '../localeHtml.mjs';
import { LOCALE_REGISTRY } from '../../src/i18n/locales';

/**
 * The pure half of scripts/build-locale-html.mjs: the per-locale table and the
 * registry-driven checks that make the build FAIL (rather than ship the English
 * card) when a registry locale has no document entry or no og asset.
 */
const here = (rel: string): string => fileURLToPath(new URL(rel, import.meta.url));
const localesSource = readFileSync(here('../../src/i18n/locales.ts'), 'utf8');
const publicDir = here('../../public/');
const realAssetExists = (f: string): boolean => existsSync(`${publicDir}${f}`);

describe('parseRegistryCodes', () => {
  it('reads the same code list the app registry exports', () => {
    expect(parseRegistryCodes(localesSource)).toEqual(LOCALE_REGISTRY.map((l) => l.code));
  });

  it('throws when the registry block cannot be found', () => {
    expect(() => parseRegistryCodes('export const nothing = 1;')).toThrow(/LOCALE_REGISTRY/);
  });
});

describe('checkLocaleTable', () => {
  it('passes for the real registry: only es is built, its assets exist', () => {
    expect(checkLocaleTable(parseRegistryCodes(localesSource), LOCALE_DOCS, realAssetExists)).toEqual(
      ['es']
    );
  });

  it('fails naming a registry locale with no table entry (en is never built)', () => {
    expect(() => checkLocaleTable(['en', 'es', 'fr'], LOCALE_DOCS, () => true)).toThrow(
      /no LOCALE_DOCS entry for registry locale "fr"/
    );
  });

  it('fails naming a missing og asset instead of shipping the EN one', () => {
    const exists = (f: string): boolean => f !== 'og-image-es.jpg';
    expect(() => checkLocaleTable(['en', 'es'], LOCALE_DOCS, exists)).toThrow(
      /og asset public\/og-image-es\.jpg \(locale "es"\) does not exist/
    );
  });

  it('fails on an incomplete entry (missing field)', () => {
    const table = { es: { ...LOCALE_DOCS.es, ogLocale: '' } };
    expect(() => checkLocaleTable(['en', 'es'], table, () => true)).toThrow(
      /LOCALE_DOCS\.es\.ogLocale is missing/
    );
  });
});

describe('renderLocaleDoc', () => {
  const fixture = [
    '<html lang="en">',
    `<title>${EN_TITLE}</title>`,
    `<meta name="description" content="${EN_DESCRIPTION}" />`,
    `<meta property="og:title" content="${EN_TITLE}" />`,
    `<meta property="og:description" content="${EN_DESCRIPTION}" />`,
    `<meta name="twitter:title" content="${EN_TITLE}" />`,
    `<meta name="twitter:description" content="${EN_DESCRIPTION}" />`,
    '<meta property="og:image" content="https://my.circlecare.app/og-invite-en.jpg" />',
    '<meta name="twitter:image" content="https://my.circlecare.app/og-invite-en.jpg" />',
    '<meta property="og:image:alt" content="Invitation to a care circle — free for you, no download needed. The CircleCare activity feed shown on a phone." />',
    '<meta property="og:locale" content="en_US" />',
    '<meta property="og:locale:alternate" content="es_419" />',
    '<meta property="og:locale:alternate" content="fr_CA" />',
  ].join('\n');

  it('renders a hypothetical fr locale from its own table entry', () => {
    const fr = {
      htmlLang: 'fr',
      ogLocale: 'fr_CA',
      title: 'CircleCare — FR',
      description: 'desc fr',
      imageAlt: 'alt fr',
      invitePreviewImage: 'og-invite-fr.jpg',
      ogImageFile: 'og-image-fr.jpg',
    };
    const { html, rewrites } = renderLocaleDoc(fixture, 'fr', fr, 'fixture.html');
    expect(rewrites).toBe(7);
    expect(html).toContain('<html lang="fr">');
    expect(html).toContain('https://my.circlecare.app/og-invite-fr.jpg');
    expect(html).toContain('<meta property="og:locale" content="fr_CA" />');
    expect(html).not.toContain('og-invite-en.jpg');
    // Its own alternate became en_US; the OTHER locale's alternate (es_419) is untouched.
    expect(html).toContain('<meta property="og:locale:alternate" content="en_US" />');
    expect(html).toContain('<meta property="og:locale:alternate" content="es_419" />');
  });

  it('throws naming the string when the source copy drifted', () => {
    expect(() =>
      renderLocaleDoc(fixture.replaceAll(EN_TITLE, 'Other'), 'es', LOCALE_DOCS.es, 'fixture.html')
    ).toThrow(/expected 3 occurrence\(s\) of the page title .* string in fixture\.html, found 0/);
  });
});

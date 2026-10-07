// Pure helpers for build-locale-html.mjs (kept side-effect free so
// scripts/__tests__/localeHtml.test.ts can exercise them without a build).
//
// The ES copy is deliberately assembled from wording the app already ships in
// src/i18n/es/common.json (authHero.headline / authHero.tagline), so the card
// and the login screen a Spanish invitee lands on speak the same sentence.

export const EN_TITLE = 'CircleCare — Care for them together';
export const EN_DESCRIPTION =
  "CircleCare brings families together to coordinate care — a shared calendar, medications everyone can confirm, and who's doing what. So no one carries it alone.";
const EN_IMAGE = 'https://my.circlecare.app/og-invite-en.jpg';
const EN_IMAGE_ALT =
  'Invitation to a care circle — free for you, no download needed. The CircleCare activity feed shown on a phone.';

/**
 * Per-locale document table. EVERY non-EN registry locale must have an entry
 * with every field (`checkLocaleTable`); a missing entry or a missing og asset
 * fails the build instead of shipping the English card to that locale's senders.
 *
 * `ogLocale` is the Open Graph locale of the document; `invitePreviewImage` /
 * `ogImageFile` are files under public/ (og-invite-<code>.jpg = the invite
 * preview card, og-image-<code>.jpg = the site share image).
 */
import { LOCALE_DOCS } from './localeDocs/index.mjs';
export { LOCALE_DOCS };

const REQUIRED_FIELDS = [
  'htmlLang',
  'ogLocale',
  'title',
  'description',
  'imageAlt',
  'invitePreviewImage',
  'ogImageFile',
];

/** Registry codes out of the TS source text of src/i18n/locales.ts. */
export function parseRegistryCodes(localesSource) {
  const block = /LOCALE_REGISTRY\s*=\s*\[([\s\S]*?)\]\s*as const/.exec(localesSource);
  if (!block) throw new Error('build-locale-html: cannot find LOCALE_REGISTRY in src/i18n/locales.ts');
  return [...block[1].matchAll(/code:\s*'([^']+)'/g)].map((m) => m[1]);
}

/**
 * Throws unless every non-EN registry locale has a complete LOCALE_DOCS entry
 * whose image assets exist. Returns the non-EN codes to build.
 */
export function checkLocaleTable(registryCodes, table, assetExists) {
  const targets = registryCodes.filter((c) => c !== 'en');
  const problems = [];
  for (const code of targets) {
    const entry = table[code];
    if (!entry) {
      problems.push(`no LOCALE_DOCS entry for registry locale "${code}"`);
      continue;
    }
    for (const field of REQUIRED_FIELDS) {
      if (typeof entry[field] !== 'string' || entry[field].length === 0) {
        problems.push(`LOCALE_DOCS.${code}.${field} is missing`);
      }
    }
    for (const file of [entry.invitePreviewImage, entry.ogImageFile]) {
      if (typeof file === 'string' && file && !assetExists(file)) {
        problems.push(`og asset public/${file} (locale "${code}") does not exist`);
      }
    }
  }
  if (problems.length > 0) {
    throw new Error(
      ['build-locale-html: locale table is incomplete:', ...problems.map((p) => `  - ${p}`)].join(
        '\n'
      )
    );
  }
  return targets;
}

/**
 * Every rewrite, with the exact occurrence count it must have. `count` is
 * asserted, not assumed (see build-locale-html.mjs for why). Note the
 * deliberately NARROW search strings: the image uses the ABSOLUTE URL, and
 * og:locale / og:locale:alternate are matched as whole tags, ordered so neither
 * can match the other's output.
 */
export function buildReplacements(code, entry) {
  return [
    {
      what: 'root <html> lang attribute',
      find: '<html lang="en">',
      replace: `<html lang="${entry.htmlLang}">`,
      count: 1,
    },
    {
      what: 'page title (<title>, og:title, twitter:title)',
      find: EN_TITLE,
      replace: entry.title,
      count: 3,
    },
    {
      what: 'description (name="description", og:description, twitter:description)',
      find: EN_DESCRIPTION,
      replace: entry.description,
      count: 3,
    },
    {
      what: 'preview card image (og:image, twitter:image)',
      find: EN_IMAGE,
      replace: `https://my.circlecare.app/${entry.invitePreviewImage}`,
      count: 2,
    },
    { what: 'og:image:alt', find: EN_IMAGE_ALT, replace: entry.imageAlt, count: 1 },
    {
      what: 'og:locale (primary locale of this document)',
      find: '<meta property="og:locale" content="en_US" />',
      replace: `<meta property="og:locale" content="${entry.ogLocale}" />`,
      count: 1,
    },
    {
      what: 'og:locale:alternate (the OTHER document, index.html)',
      find: `<meta property="og:locale:alternate" content="${entry.ogLocale}" />`,
      replace: '<meta property="og:locale:alternate" content="en_US" />',
      count: 1,
    },
  ];
}

/** Occurrences of a literal (non-regex) needle in haystack. */
export function countOccurrences(haystack, needle) {
  let total = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    total += 1;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return total;
}

/** Apply (and assert) one locale's rewrites to the built English document. */
export function renderLocaleDoc(html, code, entry, sourcePath) {
  const replacements = buildReplacements(code, entry);
  for (const { what, find, replace, count } of replacements) {
    const found = countOccurrences(html, find);
    if (found !== count) {
      throw new Error(
        [
          `build-locale-html: expected ${count} occurrence(s) of the ${what} string in ${sourcePath}, found ${found}.`,
          `  searched for: ${JSON.stringify(find)}`,
          '',
          'This almost always means index.html was copy-edited without updating',
          'scripts/localeHtml.mjs. The build fails ON PURPOSE: shipping an',
          'un-rewritten index.<locale>.html would serve an ENGLISH link-preview card to',
          `senders in that locale (${code}), silently and permanently. Update the string here (and`,
          'its translation) to match the new copy.',
        ].join('\n')
      );
    }
    html = html.split(find).join(replace);
  }
  return { html, rewrites: replacements.length };
}

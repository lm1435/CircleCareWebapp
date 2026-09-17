// Post-build step: write dist/index.es.html from dist/index.html.
//
// WHY A POST-BUILD STRING REWRITE, NOT A SECOND VITE `input`
// ----------------------------------------------------------
// The obvious alternative is a Vite multi-page build (`rollupOptions.input`
// with index.html + index.es.html). It is the wrong tool here, for two
// reasons:
//
//   1. DRIFT. Two source HTML files means two copies of the same
//      viewport/icon/link-preview tags and root div.
//      Every future edit to one silently fails to reach the other, and nobody
//      notices, because the ES page is only ever seen by a crawler. Copying
//      the BUILT file makes drift structurally impossible: the ES document is
//      the EN document, minus a fixed, asserted list of seven strings.
//
//   2. HASHED ASSETS. A second Vite input produces its own entry chunk and its
//      own preload graph — a second hashed JS bundle for byte-identical code,
//      doubling what a cold visitor downloads if they ever land on the ES URL
//      with a real browser (they do: the ES page is a normal, working SPA, it
//      just carries Spanish preview tags). Copying dist/index.html guarantees
//      the ES page references THE SAME hashed JS/CSS chunks the EN page does,
//      so it is a cache hit and the two can never point at different builds.
//
// WHY EVERY REPLACEMENT IS ASSERTED
// ---------------------------------
// This is the whole point of the script. index.html is hand-edited copy: the
// title and the description have already been rewritten once (the W5 copy
// pass, 2026-09-04). The failure mode of a blind `.replace()` is silent and
// invisible — a future copy edit stops matching, the replacement no-ops, and
// we ship an ENGLISH preview card to Spanish senders with no error anywhere.
// Nobody reads their own invite preview, so that bug lives forever.
//
// So: every search string carries the exact number of occurrences it must
// have. Any mismatch throws and fails `npm run build`. A copy edit to
// index.html is then a BUILD BREAK with the offending string named, which is
// a thirty-second fix, instead of a regression that ships.
//
// The ES copy is deliberately assembled from wording the app already ships in
// src/i18n/es/common.json (authHero.headline / authHero.tagline), so the card
// and the login screen a Spanish invitee lands on speak the same sentence.

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const distDir = fileURLToPath(new URL('../dist/', import.meta.url));

// Optional argv overrides exist ONLY as a test seam: they let the assertion
// behaviour below be exercised against a fixture that is deliberately missing
// a string (scripts/__tests__/buildLocaleHtml.test.ts). `npm run build` passes
// no arguments and always operates on dist/.
const [argSource, argOutput] = process.argv.slice(2);
const sourcePath = argSource ?? `${distDir}index.html`;
const outputPath = argOutput ?? `${distDir}index.es.html`;

const EN_TITLE = 'CircleCare — Care for them together';
const ES_TITLE = 'CircleCare — Cuídenlos juntos';

const EN_DESCRIPTION =
  "CircleCare brings families together to coordinate care — a shared calendar, medications everyone can confirm, and who's doing what. So no one carries it alone.";
const ES_DESCRIPTION =
  'CircleCare reúne a la familia para coordinar el cuidado: un calendario compartido, medicamentos que todos pueden confirmar y quién se encarga de qué. Para que nadie cargue con todo solo.';

/**
 * Every rewrite, with the exact occurrence count it must have.
 *
 * `count` is asserted, not assumed. Note the deliberately NARROW search
 * strings for the image and the locale tags:
 *
 *  - the image uses the ABSOLUTE URL, so it can only ever match the og:image and
 *    twitter:image tags. index.html must stay comment-free (it is public; see
 *    DEPLOY.md), but a bare filename match would still be one stray mention
 *    away from a silent count mismatch.
 *  - og:locale and og:locale:alternate are matched as whole tags, because
 *    `content="es_419"` exists on the page before we start and
 *    `content="en_US"` exists after we finish — a loose match would ping-pong.
 *    They are ordered so that neither can match the other's output.
 */
const replacements = [
  {
    what: 'root <html> lang attribute',
    find: '<html lang="en">',
    replace: '<html lang="es">',
    count: 1,
  },
  {
    what: 'page title (<title>, og:title, twitter:title)',
    find: EN_TITLE,
    replace: ES_TITLE,
    count: 3,
  },
  {
    what: 'description (name="description", og:description, twitter:description)',
    find: EN_DESCRIPTION,
    replace: ES_DESCRIPTION,
    count: 3,
  },
  {
    what: 'preview card image (og:image, twitter:image)',
    find: 'https://my.circlecare.app/og-invite-en.jpg',
    replace: 'https://my.circlecare.app/og-invite-es.jpg',
    count: 2,
  },
  {
    what: 'og:image:alt',
    find: 'CircleCare — the family caregiver app, shown on a phone',
    replace: 'CircleCare — la app para cuidadores familiares, en un teléfono',
    count: 1,
  },
  {
    what: 'og:locale (primary locale of this document)',
    find: '<meta property="og:locale" content="en_US" />',
    replace: '<meta property="og:locale" content="es_419" />',
    count: 1,
  },
  {
    what: 'og:locale:alternate (the OTHER document, index.html)',
    find: '<meta property="og:locale:alternate" content="es_419" />',
    replace: '<meta property="og:locale:alternate" content="en_US" />',
    count: 1,
  },
];

/** Occurrences of a literal (non-regex) needle in haystack. */
function countOccurrences(haystack, needle) {
  let total = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    total += 1;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return total;
}

function replaceAllLiteral(haystack, needle, replacement) {
  return haystack.split(needle).join(replacement);
}

async function main() {
  let html;
  try {
    html = await readFile(sourcePath, 'utf8');
  } catch (error) {
    throw new Error(
      `build-locale-html: cannot read ${sourcePath}. Run this AFTER \`vite build\`. (${error.message})`
    );
  }

  for (const { what, find, replace, count } of replacements) {
    const found = countOccurrences(html, find);
    if (found !== count) {
      throw new Error(
        [
          `build-locale-html: expected ${count} occurrence(s) of the ${what} string in ${sourcePath}, found ${found}.`,
          `  searched for: ${JSON.stringify(find)}`,
          '',
          'This almost always means index.html was copy-edited without updating',
          'scripts/build-locale-html.mjs. The build fails ON PURPOSE: shipping an',
          'un-rewritten index.es.html would serve an ENGLISH link-preview card to',
          'Spanish senders, silently and permanently. Update the string here (and',
          'its Spanish counterpart) to match the new copy.',
        ].join('\n')
      );
    }
    html = replaceAllLiteral(html, find, replace);
  }

  await writeFile(outputPath, html, 'utf8');
  console.log(
    `build-locale-html: wrote ${outputPath} (${replacements.length} rewrites, all asserted).`
  );
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});

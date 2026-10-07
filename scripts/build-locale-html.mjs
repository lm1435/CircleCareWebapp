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
// The per-locale copy table and the pure rewrite logic live in ./localeHtml.mjs;
// this script loops over every NON-EN locale in the registry
// (src/i18n/locales.ts) and writes dist/index.<code>.html for each.

import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { LOCALE_DOCS, checkLocaleTable, parseRegistryCodes, renderLocaleDoc } from './localeHtml.mjs';

const distDir = fileURLToPath(new URL('../dist/', import.meta.url));
const publicDir = fileURLToPath(new URL('../public/', import.meta.url));
const registryPath = fileURLToPath(new URL('../src/i18n/locales.ts', import.meta.url));

// Optional argv overrides exist ONLY as a test seam: they let the assertion
// behaviour be exercised against a fixture that is deliberately missing a
// string (scripts/__tests__/buildLocaleHtml.test.ts). `npm run build` passes
// no arguments and always operates on dist/. An output override may contain
// `{code}`; without it, it is only valid while a single locale is built.
const [argSource, argOutput] = process.argv.slice(2);
const sourcePath = argSource ?? `${distDir}index.html`;

function outputFor(code, total) {
  if (argOutput === undefined) return `${distDir}index.${code}.html`;
  if (argOutput.includes('{code}')) return argOutput.replaceAll('{code}', code);
  if (total > 1) {
    throw new Error('build-locale-html: an output override needs a {code} placeholder with >1 locale.');
  }
  return argOutput;
}

async function main() {
  const codes = checkLocaleTable(
    parseRegistryCodes(await readFile(registryPath, 'utf8')),
    LOCALE_DOCS,
    (file) => existsSync(`${publicDir}${file}`)
  );

  let source;
  try {
    source = await readFile(sourcePath, 'utf8');
  } catch (error) {
    throw new Error(
      `build-locale-html: cannot read ${sourcePath}. Run this AFTER \`vite build\`. (${error.message})`
    );
  }

  for (const code of codes) {
    const { html, rewrites } = renderLocaleDoc(source, code, LOCALE_DOCS[code], sourcePath);
    const outputPath = outputFor(code, codes.length);
    await writeFile(outputPath, html, 'utf8');
    console.log(`build-locale-html: wrote ${outputPath} (${rewrites} rewrites, all asserted).`);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});

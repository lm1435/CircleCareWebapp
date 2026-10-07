// CENTRAL INDEX of per-locale document copy (FLIP-STAGE wiring).
//
// build-locale-html.mjs FAILS if a registered non-EN locale has no entry here or its og
// assets are missing, so a lane creates `./<code>.mjs` (+ public/og-invite-<code>.jpg and
// og-image-<code>.jpg) but the import + entry below are added by the registry-flip stage
// only. One import line + one entry line per locale, alphabetical by code.
import { doc as de } from './de.mjs';
import { doc as es } from './es.mjs';
import { doc as fr } from './fr.mjs';
import { doc as frCA } from './fr-CA.mjs';
import { doc as it } from './it.mjs';
import { doc as pt } from './pt.mjs';
import { doc as ptPT } from './pt-PT.mjs';

export const LOCALE_DOCS = {
  de,
  es,
  fr,
  'fr-CA': frCA,
  it,
  pt,
  'pt-PT': ptPT,
};

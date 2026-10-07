// CENTRAL INDEX of per-locale document copy (FLIP-STAGE wiring).
//
// build-locale-html.mjs FAILS if a registered non-EN locale has no entry here or its og
// assets are missing, so a lane creates `./<code>.mjs` (+ public/og-invite-<code>.jpg and
// og-image-<code>.jpg) but the import + entry below are added by the registry-flip stage
// only. One import line + one entry line per locale, alphabetical by code.
import { doc as es } from './es.mjs';
// flip: import { doc as de } from './de.mjs';  (fr, 'fr-CA' -> frCA, it, pt, 'pt-PT' -> ptPT)

export const LOCALE_DOCS = {
  es,
  // flip: de, fr, 'fr-CA': frCA, it, pt, 'pt-PT': ptPT
};

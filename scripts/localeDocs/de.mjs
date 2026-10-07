// German document copy for build-locale-html.mjs (one locale for DE / AT / CH).
//
// Assembled from wording the app already ships in src/i18n/de/common.json
// (authHero.headline / authHero.tagline), so the share card and the login screen a
// German invitee lands on speak the same sentence. Formal "Sie" register
// (docs/i18n/glossary-de.md). Shape: see REQUIRED_FIELDS in ../localeHtml.mjs.
// LANE-OWNED content file.
//
// FLAG: og-invite-de.jpg / og-image-de.jpg are byte copies of the English cards
// (the screenshot-gen OG composer is en/es-only and there are no German app
// screenshots yet). Regenerate them from German screenshots before the flip.
export const doc = {
  htmlLang: 'de',
  ogLocale: 'de_DE',
  title: 'CircleCare – Gemeinsam für sie da sein',
  description:
    'CircleCare bringt die Familie zusammen, um die Pflege zu koordinieren: ein gemeinsamer Kalender, Medikamente, die alle bestätigen können, und der Überblick, wer was übernimmt. Damit niemand alles allein tragen muss.',
  imageAlt:
    'Sie wurden in einen Pflegekreis eingeladen – kostenlos für Sie, ohne Download. Der Aktivitätsverlauf von CircleCare auf einem Smartphone.',
  invitePreviewImage: 'og-invite-de.jpg',
  ogImageFile: 'og-image-de.jpg',
};

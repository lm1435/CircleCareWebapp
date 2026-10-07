// Italian document copy for build-locale-html.mjs.
//
// Assembled from wording the app already ships in src/i18n/it/common.json
// (authHero.headline / authHero.tagline), so the share card and the login screen an
// Italian invitee lands on speak the same sentence. Register "tu" / "voi" (glossary:
// docs/i18n/glossary-it.md); the invitee's gender is unknown, so "Hai ricevuto un
// invito", never "Sei invitato/a". Shape: see REQUIRED_FIELDS in ../localeHtml.mjs.
// LANE-OWNED content file. og images are COPIES of the en artwork (flagged: no
// localized Italian screenshots exist for screenshot-gen yet).
export const doc = {
  htmlLang: 'it',
  ogLocale: 'it_IT',
  title: 'CircleCare — Prendetevi cura insieme',
  description:
    'CircleCare riunisce la famiglia per coordinare la cura: un calendario condiviso, farmaci che tutti possono confermare e chi si occupa di cosa. Così nessuno porta il peso da solo.',
  imageAlt:
    "Hai ricevuto un invito in una cerchia di cura: gratis per te, senza scaricare nulla. La cronologia delle attività di CircleCare su un telefono.",
  invitePreviewImage: 'og-invite-it.jpg',
  ogImageFile: 'og-image-it.jpg',
};

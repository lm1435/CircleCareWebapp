// French (France) document copy for build-locale-html.mjs.
//
// Assembled from the wording the app ships in src/i18n/fr/common.json
// (authHero.headline / authHero.tagline), so the share card and the login screen
// a French invitee lands on speak the same sentence. Care-first: family
// coordination leads, medication features follow. Shape: see REQUIRED_FIELDS in
// ../localeHtml.mjs. LANE-OWNED content file. Typography: U+202F before ? ! ; :.
//
// og images: public/og-image-fr.jpg and og-invite-fr.jpg are COPIES of the en
// images (the screenshot-gen OG generator only renders en/es and needs French app
// screenshots that do not exist yet). Replace them before marketing pushes fr.
export const doc = {
  htmlLang: 'fr',
  ogLocale: 'fr_FR',
  title: 'CircleCare — Prenez soin d’eux, ensemble',
  description:
    'CircleCare réunit la famille pour coordonner les soins : un calendrier partagé, des médicaments que chacun peut confirmer et qui s’occupe de quoi. Pour que personne ne porte tout seul.',
  imageAlt:
    'Une invitation à rejoindre un cercle de soins — gratuite pour vous, sans rien télécharger. Le fil d’activité de CircleCare sur un téléphone.',
  invitePreviewImage: 'og-invite-fr.jpg',
  ogImageFile: 'og-image-fr.jpg',
};

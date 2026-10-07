// European Portuguese document copy for build-locale-html.mjs.
//
// Assembled from wording the app ships in src/i18n/pt-PT/common.json (authHero.tagline,
// a sparse override of pt). European register: no "você", "partilhado", "telemóvel",
// "a + infinitivo" (glossary: docs/i18n/glossary-pt.md, pt-PT column). The invitee's
// gender is unknown, so "Recebeu um convite", never "Foi convidado/a".
// Shape: see REQUIRED_FIELDS in ../localeHtml.mjs. LANE-OWNED content file. og images are
// COPIES of the en artwork (flagged: no localized Portuguese artwork in screenshot-gen yet).
export const doc = {
  htmlLang: 'pt-PT',
  ogLocale: 'pt_PT',
  title: 'CircleCare — Cuidem juntos',
  description:
    'O CircleCare junta a família para coordenar o cuidado: um calendário partilhado, medicamentos que todos podem confirmar e quem está a tratar de quê. Para que ninguém carregue tudo sozinho.',
  imageAlt:
    'Recebeu um convite para um círculo de cuidado: gratuito e sem ter de transferir nada. O registo de atividades do CircleCare num telemóvel.',
  invitePreviewImage: 'og-invite-pt-PT.jpg',
  ogImageFile: 'og-image-pt-PT.jpg',
};

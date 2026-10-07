/**
 * Shared French rules for frOrthography.test.ts and frCAOrthography.test.ts
 * (glossary: docs/i18n/glossary-fr.md). Mirrors mobile src/__tests__/i18n/frOrthographyRules.ts.
 */

export const FR_FORBIDDEN: Array<[label: string, pattern: RegExp]> = [
  // Register: a loved one is never "patient(e)"; never "bénéficiaire" / "malade" for the care recipient.
  ['clinical "patient" register', /(?<![\p{L}])patiente?s?(?![\p{L}])/iu],
  ['"bénéficiaire" / "malade"', /(?<![\p{L}])(bénéficiaire|malade)s?(?![\p{L}])/iu],
  // Formal "vous" throughout.
  ['"tu" register', /(?<![\p{L}’'])(tu|toi|tes)(?![\p{L}’'])/iu],
  // Typography (one character everywhere: U+202F).
  ['straight apostrophe', /\p{L}'\p{L}/u],
  ['plain or U+00A0 space before ? ! ; :', /[ \u00A0][?!;:]/],
  ['? ! ; glued to the word before', /(?<!&[a-z]*)[\p{L}\p{N}»)}][?!;](?=\s|$)/u],
  ['colon glued to the word before', /(?<!https?|[a-z-]+="[^"]*)[\p{L}»)]:(?=\s|$)/u],
  ['guillemets without U+202F inside', /«(?!\u202F)|(?<!\u202F)»/],
  // Dose vocabulary: never "Taken at" wording on a skip; an unanswered dose is never missed/forgotten.
  ['"prise à" on a skip', /saut[ée]+e?s?[^.]{0,40}\bprise?s? à/iu],
  // (the one exemption: the legacy activity marker `activity.phrases.missed` = "dose manquée",
  // which only renders rows written before auto-miss was removed)
  ['unanswered dose called missed / forgotten', /^(?!dose manquée$).*\b(doses?|prises?)\s+(manqu|oubli)/iu],
];

/** Exact key -> required wording (dose vocabulary, activity word order). */
export const FR_REQUIRED: Record<string, RegExp> = {};

/** Words that always carry their diacritic. */
export const FR_DIACRITICS: Array<[bare: RegExp, label: string]> = [
  [/(?<![\p{L}])taches?(?![\p{L}])/iu, 'tâche'],
  [/(?<![\p{L}])(evenement|evenements)(?![\p{L}])/iu, 'événement'],
  [/(?<![\p{L}])(medicament|medicaments)(?![\p{L}])/iu, 'médicament'],
  [/(?<![\p{L}])(deja|tres|apres|acces)(?![\p{L}])/iu, 'déjà / très / après / accès'],
  [/(?<![\p{L}])(parametres|telephone|securite|reessayez)(?![\p{L}])/iu, 'paramètres / téléphone / sécurité / réessayez'],
  [/(?<![\p{L}])(prevu|prevue|prevus|cree|creee)(?![\p{L}])/iu, 'prévu / créé'],
];

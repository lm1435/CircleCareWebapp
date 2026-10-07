/**
 * French orthography / wording twin (from localeOrthography.test.ts.template).
 * Runs against src/i18n/fr/*.json on disk, so it works before the registry flip.
 * Rules: ./helpers/frOrthographyRules.ts; glossary docs/i18n/glossary-fr.md.
 */
// @vitest-environment node
import { describeLocaleOrthography } from './helpers/localeOrthography';
import { FR_DIACRITICS, FR_FORBIDDEN, FR_REQUIRED } from './helpers/frOrthographyRules';

describeLocaleOrthography('fr', {
  forbidden: FR_FORBIDDEN,
  required: FR_REQUIRED,
  diacritics: FR_DIACRITICS,
});

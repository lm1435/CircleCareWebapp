/**
 * Quebec French orthography twin. fr-CA is SPARSE: only the keys it overrides are
 * scanned (src/i18n/fr-CA/*.json). Same French rules as fr (the U+202F fine space is
 * accepted by the OQLF before ; ? !), plus the Quebec vocabulary deltas.
 */
// @vitest-environment node
import { describeLocaleOrthography } from './helpers/localeOrthography';
import { FR_DIACRITICS, FR_FORBIDDEN } from './helpers/frOrthographyRules';

describeLocaleOrthography('fr-CA', {
  forbidden: [
    ...FR_FORBIDDEN,
    // An override exists to say it the Quebec way: "courriel", "cellulaire", "texto".
    ['"e-mail", "portable" or "SMS" in a Quebec override', /(?<![\p{L}])(e-mails?|portables?|SMS)(?![\p{L}])/iu],
  ],
  diacritics: FR_DIACRITICS,
});

/**
 * European Portuguese orthography twin. `src/i18n/pt-PT/*.json` is a SPARSE override of
 * pt: only the keys it defines are scanned. Glossary: docs/i18n/glossary-pt.md.
 */
// @vitest-environment node
import { describeLocaleOrthography } from './helpers/localeOrthography';
import { PT_DIACRITICS, PT_FORBIDDEN } from './ptOrthographyRules';

describeLocaleOrthography('pt-PT', {
  forbidden: [
    ...PT_FORBIDDEN,
    // Register: Portugal never addresses the reader as "você".
    ['"você" in a European override', /(^|[^\p{L}])vocês?(?=[^\p{L}]|$)/iu],
    ['Brazilian-only word in a European override', /(^|[^\p{L}])(tela|celular|usuári\p{L}*|arquivos?|senha|equipe|compartilh\p{L}*|cadastr\p{L}*|registr\p{L}*|configurações|excluir|salvar|baixar|contatos?|câmera)(?=[^\p{L}]|$)/iu],
    ['Brazilian gerund progressive', /(^|[^\p{L}])(Carregando|Salvando|Enviando|Verificando|Processando|Excluindo|Atualizando)(?=[^\p{L}]|$)/u],
  ],
  required: {
    'meds.status.skipped': /^Saltado$/,
    'meds.history.skippedAtLabel': /^Saltado às$/,
    'activity.phrases.skipped': /^saltado$/,
    'activity.phrases.skippedEvent': /^Dose saltada:$/,
  },
  diacritics: PT_DIACRITICS,
});

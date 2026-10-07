/**
 * Portuguese (Brazil) orthography twin (from localeOrthography.test.ts.template). Runs
 * against `src/i18n/pt/*.json` on disk, so it works before the registry flip.
 * Glossary: docs/i18n/glossary-pt.md. Rules shared with pt-PT live in ./ptOrthographyRules.
 */
// @vitest-environment node
import { describeLocaleOrthography } from './helpers/localeOrthography';
import { PT_DIACRITICS, PT_FORBIDDEN } from './ptOrthographyRules';

describeLocaleOrthography('pt', {
  forbidden: [
    ...PT_FORBIDDEN,
    // European-only vocabulary in the Brazilian base.
    ['European-only word in the pt base', /(^|[^\p{L}])(ecrã|telemóvel|utilizador(es)?|ficheiros?|palavra-passe|equipa|partilh\p{L}*|registo|registar|subscriç\p{L}*|contacto)(?=[^\p{L}]|$)/iu],
  ],
  required: {
    // Dose vocabulary (project_dose_status_vocabulary_2026_10_04): a skip is neutral and
    // never "Tomado às"; an unanswered dose is "Não marcado".
    'meds.status.skipped': /^Pulado$/,
    'meds.history.skippedAtLabel': /^Pulado às$/,
    'meds.history.statusNotMarked': /^Não marcado$/,
    'calendar.eventDetail.skippedAt': /^Pulado às \{\{time\}\}$/,
    'activity.phrases.skipped': /^pulado$/,
    'activity.phrases.skippedEvent': /^Dose pulada:$/,
    'activity.phrases.missed': /^não tomado$/,
  },
  diacritics: PT_DIACRITICS,
});

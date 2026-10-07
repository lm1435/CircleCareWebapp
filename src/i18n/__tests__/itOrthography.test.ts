/**
 * Italian orthography / wording twin (from localeOrthography.test.ts.template).
 * Runs against src/i18n/it/*.json on disk, so it works before the registry flip.
 * Glossary: docs/i18n/glossary-it.md.
 */
// @vitest-environment node
import { describeLocaleOrthography } from './helpers/localeOrthography';

describeLocaleOrthography('it', {
  forbidden: [
    // Care-first register: the loved one is never a clinical "paziente".
    ['clinical "paziente"', /\bpazient[ei]\b/i],
    // Apostrophe typed in place of an accent ("e'", "piu'", "perche'"); legit elisions
    // (l'app, un'ora, po') are not in the closed list.
    ['apostrophe for accent', /(^|[^\p{L}])(e|E|piu|perche|poiche|gia|puo|cosi|cioe|citta|eta|attivita|novita)['’](?=[^\p{L}]|$)/u],
    // Capital verb È written as a bare E at a sentence start.
    ['"E stato" for "È stato"', /(^|[.!?:]\s+)E (stato|stata|stati|state|ora|possibile|necessario|già) /u],
    // Dose vocabulary: unanswered = "non (ancora) segnata"; never missed / forgotten.
    ['dose "mancata"/"dimenticata"', /\bdos[ei]\s+(mancat[ae]|dimenticat[ae]|pers[ae])\b/i],
  ],
  required: {
    // Dose-status vocabulary (owner decision 2026-10-04; glossary dose table).
    'activity.phrases.taken': /^dose presa$/,
    'activity.phrases.takenLate': /^dose presa in ritardo$/,
    'activity.phrases.skipped': /^dose saltata$/,
    'activity.phrases.missed': /^dose non segnata$/,
    'activity.phrases.skippedEvent': /^Evento saltato:$/,
  },
  diacritics: [
    [/\bperche\b/i, 'perché'],
    [/\bpoiche\b/i, 'poiché'],
    [/\bpiu\b/i, 'più'],
    [/\bgia\b/i, 'già'],
    [/\bpuo\b/i, 'può'],
    [/\bcosi\b/i, 'così'],
    [/\bcioe\b/i, 'cioè'],
    [/\bcitta\b/i, 'città'],
    [/\b(attivita|novita|possibilita|qualita|priorita|identita|comunita)\b/i, '-ità'],
    [/\b(lunedi|martedi|mercoledi|giovedi|venerdi)\b/i, '-dì'],
  ],
});

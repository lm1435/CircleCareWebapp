/**
 * German orthography / wording twin (from localeOrthography.test.ts.template).
 * Runs against src/i18n/de/*.json on disk, so it works before the registry flip.
 * Glossary: docs/i18n/glossary-de.md (one locale for DE / AT / CH, formal "Sie",
 * ß + umlauts, never "Patient"). Mobile twin: mobile/src/__tests__/i18n/deOrthography.test.ts.
 */
// @vitest-environment node
import { describeLocaleOrthography } from './helpers/localeOrthography';

describeLocaleOrthography('de', {
  forbidden: [
    // Care-first register: the loved one is never a clinical "Patient"; the legal
    // document name "Patientenverfügung" is the one allowed compound.
    ['clinical "Patient"', /\bPatient(in|innen|en)?\b(?!verfügung)/i],
    // Register: formal "Sie" everywhere. No du-address.
    ['du-form address', /(^|[^\p{L}])(du|dein|deine|deinen|deinem|deiner|deines|dich|dir)(?=[^\p{L}]|$)/iu],
    // "Sie" as address is capitalised after an imperative ("Tippen Sie").
    ['lowercase "sie" after an imperative', /\b(Tippen|Prüfen|Versuchen|Öffnen|Fügen|Laden|Bestätigen|Geben|Wählen|Melden|Senden|Bitten|Fragen|Klicken)\s+sie\b/],
    // Common nouns are always capitalised (no verb/adjective homograph).
    ['lower-case common noun', /(^|[^\p{L}])(termin|termine|medikament|medikamente|aufgabe|aufgaben|notiz|notizen|dosis|dosen|pflegeperson|pflegepersonen|kreis|einladung|einladungen|erinnerung|erinnerungen|konto|kalender|mitglied|mitglieder|einnahmetreue|vitalwerte|ruhezeiten|zeitplan|nachschub|tablette|tabletten)(?=[^\p{L}]|$)/u],
    // Dose vocabulary: unanswered = "noch nicht eingetragen"; never missed / forgotten.
    ['dose "verpasst"/"vergessen"', /\b(verpasst|vergessen)e?n?\s+(Dosis|Dosen|Einnahme)\b/i],
    // Never "taken at" wording attached to a skip.
    ['"eingenommen um" on a skip', /ausgelassen[^.]{0,40}\beingenommen um\b|\beingenommen um\b[^.]{0,40}ausgelassen/i],
  ],
  required: {
    // Dose-status vocabulary (owner decision 2026-10-04; glossary §3/§4).
    'activity.phrases.taken': /^eingenommen$/,
    'activity.phrases.takenLate': /^verspätet eingenommen$/,
    'activity.phrases.skipped': /^ausgelassen$/,
    'activity.phrases.missed': /^nicht eingenommen$/,
    'activity.phrases.skippedEvent': /^Ausgelassen:$/,
    // Concatenation sites: colon / preposition forms that never inflect around a title.
    'activity.phrases.addedMedication': /^Medikament hinzugefügt:$/,
    'activity.phrases.invited': /^Einladung an$/,
    'activity.phrases.toJoinAsCaregiver': /^zum Beitritt als Pflegeperson$/,
    'meds.history.skippedAtLabel': /^Ausgelassen um$/,
  },
  diacritics: [
    // ASCII transliterations of umlauts / ß are wrong in every context.
    [/\b(fuer|ueber|koennen|moechten|muessen|waehlen|hinzufuegen|loeschen|aendern|zurueck|naechste[nrs]?|spaeter|oeffnen|pruefen)\b/i, 'umlaut (ü/ö/ä), not ue/oe/ae'],
    [/\b(groesse|schliessen|heisst|strasse|massnahme|gross|grosse[nrs]?|gruesse|gemaess|ausserdem)\b/i, 'ß, not ss'],
  ],
});

import i18n from '@/i18n';
import { translateActivityDescription } from '@/components/activity/activityTranslation';
import { formatDateShort } from '@/components/activity/activityFormat';

// Port of mobile's activity phrase translation — backend descriptions are
// English; known phrases are replaced per-locale while proper nouns
// (names, med names) are preserved.

const tEs = i18n.getFixedT('es', 'activity');
const tEn = i18n.getFixedT('en', 'activity');

describe('translateActivityDescription', () => {
  it('passes English descriptions through unchanged for the en locale', () => {
    expect(translateActivityDescription('Confirmed Medication: Aspirin 100mg (taken)', tEn)).toBe(
      'Confirmed Medication: Aspirin 100mg (taken)'
    );
  });

  it('translates medication confirmations into natural Spanish', () => {
    expect(translateActivityDescription('Confirmed Medication: Aspirin 100mg (taken)', tEs)).toBe(
      'Medicamento confirmado: Aspirin 100mg (tomado)'
    );
    expect(translateActivityDescription('Confirmed Medication: Eliquis (taken late)', tEs)).toBe(
      'Medicamento confirmado: Eliquis (tomado tarde)'
    );
  });

  it('rewrites the "Not taken" pattern with a formatted date (no raw ISO)', () => {
    // Dates far enough in the past render as a localized short date, not ISO.
    //
    // REVERSED 2026-09-01, and the 2026-08-20 note this replaces was reasoning
    // from a premise that has since changed. That change aligned the display
    // DOWN to the stored wording, on the view that the backend's "Not taken:"
    // was canonical. It is not: the stored `description` is an internal token in
    // a legacy format, matched by /^Not taken: (.+) on …/ and deliberately left
    // alone so old rows keep rendering. `activity.phrases.skippedEvent` is the
    // DISPLAY label, and the app now says "Skipped" for `status = 'skipped'`
    // everywhere — list, detail modal, undo toast, adherence PDF, and the feed —
    // because the button that produces it says "Skip".
    //
    // So relabelling English to English here is the POINT, not drift: the input
    // is a token, the output is copy. All three surfaces (mobile, webapp,
    // backend) now resolve this key to "Skipped:" / "Omitido:". If you are about
    // to change these strings, change all three or none.
    expect(translateActivityDescription('Not taken: Aspirin on 2026-06-10', tEs, 'es')).toBe(
      'Omitido: Aspirin el 10 jun'
    );
    expect(translateActivityDescription('Not taken: Aspirin on 2026-06-10', tEn, 'en')).toBe(
      'Skipped: Aspirin on Jun 10'
    );
  });

  it('rewrites "Stopped recurrence" with a formatted date', () => {
    expect(
      translateActivityDescription('Stopped recurrence for Aspirin from 2026-06-10', tEn, 'en')
    ).toBe('Stopped recurrence for Aspirin from Jun 10');
  });

  it('translates membership phrases', () => {
    expect(
      translateActivityDescription('Pat Rivera joined the circle as Caregiver', tEs)
    ).toBe('Pat Rivera se unió al círculo como cuidador');
  });

  it('translates calendar import counts with pluralization', () => {
    expect(translateActivityDescription('Imported 1 appointment from calendar', tEs)).toBe(
      'Importó 1 cita del calendario'
    );
    expect(translateActivityDescription('Imported 3 appointments from calendar', tEs)).toBe(
      'Importó 3 citas del calendario'
    );
  });
});

describe('formatDateShort default locale', () => {
  // The `locale` param is optional; when omitted it must resolve from the live
  // i18next language (no more manual `i18n.language` threading at call sites).
  // Isolate the global language change so it never bleeds into sibling tests.
  const originalLanguage = i18n.language;

  afterEach(async () => {
    await i18n.changeLanguage(originalLanguage);
  });

  it('renders the localized short date from the active i18next language when no locale is passed', async () => {
    // Far enough in the past that it is neither Today nor Yesterday, so it
    // renders as a localized short date rather than a relative label.
    await i18n.changeLanguage('es');
    expect(formatDateShort('2026-06-10', tEn)).toBe('10 jun');

    await i18n.changeLanguage('en');
    expect(formatDateShort('2026-06-10', tEn)).toBe('Jun 10');
  });
});

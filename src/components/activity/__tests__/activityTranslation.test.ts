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

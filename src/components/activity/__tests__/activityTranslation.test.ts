import i18n from '@/i18n';
import { translateActivityDescription } from '@/components/activity/activityTranslation';

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

  it('translates the "Not taken" pattern preserving title and date', () => {
    expect(translateActivityDescription('Not taken: Aspirin on 2026-06-10', tEs)).toBe(
      'No tomado: Aspirin el 2026-06-10'
    );
  });

  it('translates membership phrases', () => {
    expect(
      translateActivityDescription('Pat Rivera joined the circle as Caregiver', tEs)
    ).toBe('Pat Rivera se unió al círculo como Cuidador');
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

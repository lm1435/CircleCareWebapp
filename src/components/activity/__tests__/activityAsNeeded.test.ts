import i18n from '@/i18n';
import {
  renderActivityDescription,
  translateActivityDescription,
} from '@/components/activity/activityTranslation';

// The two NEW as-needed (PRN) feed rows. Existing phrases/keys are untouched
// (project_activity_feed_localization): these are additions only.

const tEn = i18n.getFixedT('en', 'activity');
const tEs = i18n.getFixedT('es', 'activity');

beforeEach(() => {
  vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({
    timeZone: 'America/Denver',
  } as Intl.ResolvedDateTimeFormatOptions);
});
afterEach(() => vi.restoreAllMocks());

const logged = {
  description: 'Logged a dose: Ibuprofen',
  action_type: 'medication_as_needed_logged',
  description_key: 'entries.asNeededDoseLogged',
  // 'HH:MM:SS' in the CARE RECIPIENT's zone.
  description_params: { title: 'Ibuprofen', time: '14:15:00' },
};
const removed = {
  description: 'Removed a logged dose: Ibuprofen',
  action_type: 'medication_as_needed_removed',
  description_key: 'entries.asNeededDoseRemoved',
  description_params: { title: 'Ibuprofen', time: '14:15:00' },
};
const ctx = (over = {}) => ({ timezone: 'America/Denver', hourCycle: '12h' as const, locale: 'en', ...over });

describe('as-needed activity rows', () => {
  it('EN: renders both keyed rows with the dose time', () => {
    expect(renderActivityDescription(logged, tEn, ctx())).toBe('Logged a dose: Ibuprofen at 2:15 PM');
    expect(renderActivityDescription(removed, tEn, ctx())).toBe(
      'Removed a logged dose: Ibuprofen (2:15 PM)'
    );
  });

  it('ES: both rows in Spanish, in the viewer\'s clock', () => {
    expect(renderActivityDescription(logged, tEs, ctx({ locale: 'es' }))).toBe(
      'Dosis registrada: Ibuprofen a las 2:15 p. m.'
    );
    expect(renderActivityDescription(removed, tEs, ctx({ locale: 'es', hourCycle: '24h' }))).toBe(
      'Dosis registrada quitada: Ibuprofen (14:15)'
    );
  });

  it('the recipient\'s zone is NAMED when the viewer is elsewhere (never read as the viewer\'s clock)', () => {
    expect(renderActivityDescription(logged, tEn, ctx({ timezone: 'Asia/Tokyo' }))).toBe(
      'Logged a dose: Ibuprofen at 2:15 PM (Tokyo)'
    );
  });

  it('a keyless / incomplete row degrades to the stored English (EN) and the PHRASE substitution (ES)', () => {
    const keyless = { description: 'Logged a dose: Ibuprofen', action_type: 'medication_as_needed_logged' };
    expect(renderActivityDescription(keyless, tEn, ctx())).toBe('Logged a dose: Ibuprofen');
    expect(renderActivityDescription(keyless, tEs, ctx({ locale: 'es' }))).toBe(
      'Dosis registrada: Ibuprofen'
    );
    const broken = { ...logged, description_params: { title: 'Ibuprofen' } };
    expect(renderActivityDescription(broken, tEn, ctx())).toBe('Logged a dose: Ibuprofen');
  });

  it('legacy phrase path: both phrases translate and do not disturb "Confirmed Medication:"', () => {
    expect(translateActivityDescription('Removed a logged dose: Ibuprofen', tEs, 'es')).toBe(
      'Dosis registrada quitada: Ibuprofen'
    );
    expect(translateActivityDescription('Confirmed Medication: Aspirin (taken)', tEs, 'es')).toBe(
      'Medicamento confirmado: Aspirin (tomado)'
    );
  });
});

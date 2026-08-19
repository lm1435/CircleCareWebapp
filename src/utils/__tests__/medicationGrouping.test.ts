import {
  getMedKey,
  getMedSeriesAnalyticsFacts,
  getSeriesRoot,
} from '@/utils/medicationGrouping';
import type { CalendarEvent } from '@/api/calendarEvents';

// MIRRORS mobile/src/__tests__/utils/medicationGrouping.test.ts so web and
// mobile agree on what "one medication" is.

// Minimal medication-event factory — only the fields the grouping utils read.
const med = (over: Partial<CalendarEvent>): CalendarEvent =>
  ({
    id: 'e1',
    event_type: 'medication',
    medication_name: null,
    title: '',
    medication_dosage: null,
    parent_event_id: null,
    ...over,
  }) as CalendarEvent;

describe('getMedKey', () => {
  it('groups "10mg" and "10 mg" together (internal whitespace collapsed)', () => {
    const a = getMedKey(med({ medication_name: 'Lisinopril', medication_dosage: '10mg' }));
    const b = getMedKey(med({ medication_name: 'Lisinopril', medication_dosage: '10 mg' }));
    expect(a).toBe(b);
  });

  it('collapses runs of whitespace and tabs in both name and dosage', () => {
    const a = getMedKey(med({ medication_name: 'Extended  Release', medication_dosage: '10   mg' }));
    const b = getMedKey(med({ medication_name: 'Extended Release', medication_dosage: '10 mg' }));
    expect(a).toBe(b);
  });

  it('remains case-insensitive', () => {
    const a = getMedKey(med({ medication_name: 'LISINOPRIL', medication_dosage: '10 MG' }));
    const b = getMedKey(med({ medication_name: 'lisinopril', medication_dosage: '10mg' }));
    expect(a).toBe(b);
  });

  it('keeps genuinely distinct doses in separate keys', () => {
    const a = getMedKey(med({ medication_name: 'Lisinopril', medication_dosage: '10mg' }));
    const b = getMedKey(med({ medication_name: 'Lisinopril', medication_dosage: '20mg' }));
    expect(a).not.toBe(b);
  });

  it('keeps distinct names separate', () => {
    const a = getMedKey(med({ medication_name: 'Lisinopril', medication_dosage: '10mg' }));
    const b = getMedKey(med({ medication_name: 'Metformin', medication_dosage: '10mg' }));
    expect(a).not.toBe(b);
  });

  it('falls back to title when medication_name is absent', () => {
    const a = getMedKey(
      med({ medication_name: undefined, title: 'Aspirin', medication_dosage: '81 mg' })
    );
    const b = getMedKey(med({ medication_name: 'Aspirin', medication_dosage: '81mg' }));
    expect(a).toBe(b);
  });
});

describe('getSeriesRoot', () => {
  it('returns parent_event_id when set, else own id', () => {
    expect(getSeriesRoot(med({ id: 'child', parent_event_id: 'parent' }))).toBe('parent');
    expect(getSeriesRoot(med({ id: 'solo', parent_event_id: undefined }))).toBe('solo');
  });
});

describe('getMedSeriesAnalyticsFacts', () => {
  // Fixed "now" so days_active is deterministic. 2026-08-17T03:30:00Z is still
  // 2026-08-16 in America/Denver — the case that catches anyone reaching for
  // browser-local time or `toISOString().split('T')[0]`.
  const NOW = new Date('2026-08-17T03:30:00Z');

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const dosed = (over: Partial<CalendarEvent>): CalendarEvent =>
    med({
      medication_name: 'Lisinopril',
      medication_dosage: '10mg',
      scheduled_date: '2026-08-01',
      ...over,
    });

  // NOTE — these facts deliberately carry NO series count. Whole-medication
  // discontinue/reactivate is one `scope: 'medication'` request and the count
  // of roots mutated comes back on the response, where it is not limited to
  // whatever pool the page had loaded.

  it('measures days_active in the CARE RECIPIENT timezone, not the browser', () => {
    // 03:30Z on the 17th is still the 16th in Denver → 15 days, not 16.
    const target = dosed({ id: 'am', scheduled_date: '2026-08-01' });
    expect(getMedSeriesAnalyticsFacts([target], target, 'America/Denver').daysActive).toBe(15);
    // Same instant in Europe/Madrid is already the 17th → 16 days.
    expect(getMedSeriesAnalyticsFacts([target], target, 'Europe/Madrid').daysActive).toBe(16);
  });

  it('uses the EARLIEST known occurrence, so a clicked child does not shorten it', () => {
    const root = dosed({ id: 'root', scheduled_date: '2026-06-01' });
    const child = dosed({ id: 'child', parent_event_id: 'root', scheduled_date: '2026-08-10' });
    expect(getMedSeriesAnalyticsFacts([root, child], child, 'America/Denver').daysActive).toBe(76);
  });

  it('never returns a negative duration for a future-dated series', () => {
    const future = dosed({ id: 'f', scheduled_date: '2027-01-01' });
    expect(getMedSeriesAnalyticsFacts([future], future, 'America/Denver').daysActive).toBe(0);
  });

  it('reports had_confirmations from any loaded occurrence of the same med', () => {
    const plain = dosed({ id: 'am' });
    expect(getMedSeriesAnalyticsFacts([plain], plain, 'America/Denver').hadConfirmations).toBe(
      false
    );
    const answered = dosed({
      id: 'pm',
      confirmation: {
        status: 'taken',
        confirmed_at: '2026-08-02T15:00:00Z',
        confirmed_by: 'u1',
      },
    } as Partial<CalendarEvent>);
    expect(
      getMedSeriesAnalyticsFacts([plain, answered], plain, 'America/Denver').hadConfirmations
    ).toBe(true);
  });

  it('ignores a confirmation on a DIFFERENT medication', () => {
    const target = dosed({ id: 'am' });
    const otherMed = dosed({
      id: 'other',
      medication_dosage: '20mg',
      confirmation: {
        status: 'taken',
        confirmed_at: '2026-08-02T15:00:00Z',
        confirmed_by: 'u1',
      },
    } as Partial<CalendarEvent>);
    expect(
      getMedSeriesAnalyticsFacts([target, otherMed], target, 'America/Denver').hadConfirmations
    ).toBe(false);
  });

  it('degrades to safe zeros rather than throwing on a malformed date', () => {
    const bad = dosed({ id: 'bad', scheduled_date: 'not-a-date' });
    expect(getMedSeriesAnalyticsFacts([bad], bad, 'America/Denver')).toEqual({
      daysActive: 0,
      hadConfirmations: false,
    });
  });
});

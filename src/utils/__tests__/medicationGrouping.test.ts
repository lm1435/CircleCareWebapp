import { getMedKey, getSeriesRoot, getSeriesRootsForMed } from '@/utils/medicationGrouping';
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

describe('getSeriesRootsForMed', () => {
  it('collects distinct roots for every matching med (whitespace-insensitive)', () => {
    const target = med({ id: 'morning', medication_name: 'Metformin', medication_dosage: '500mg' });
    const all: CalendarEvent[] = [
      target,
      med({ id: 'evening', medication_name: 'Metformin', medication_dosage: '500 mg' }),
      med({ id: 'other', medication_name: 'Lisinopril', medication_dosage: '10mg' }),
    ];
    const roots = getSeriesRootsForMed(all, target).sort();
    expect(roots).toEqual(['evening', 'morning']);
  });

  it('dedups multiple children of the SAME series to one root, and falls back to the tapped root when allEvents is missing', () => {
    // Two materialized instances of the same parent must yield ONE root —
    // otherwise discontinue would fire duplicate mutations per series.
    const target = med({
      id: 'inst-1',
      parent_event_id: 'p1',
      medication_name: 'Metformin',
      medication_dosage: '500mg',
    });
    const sibling = med({
      id: 'inst-2',
      parent_event_id: 'p1',
      medication_name: 'Metformin',
      medication_dosage: '500mg',
    });
    expect(getSeriesRootsForMed([target, sibling], target)).toEqual(['p1']);
    // No allEvents (e.g. calendar window not loaded) → the tapped event's own
    // root must still be acted on, so single-series discontinue keeps working.
    expect(getSeriesRootsForMed(undefined, target)).toEqual(['p1']);
  });

  it('ignores NON-medication events even when the name key would collide', () => {
    // A task titled the same as a med (both with no dosage) produces the same
    // composite key — the event_type guard must keep it out of the root set, or
    // discontinuing the med would PATCH medication-status against a task.
    const target = med({ id: 'm1', medication_name: 'Walk', medication_dosage: null });
    const task = med({
      id: 't1',
      event_type: 'task',
      medication_name: null,
      title: 'Walk',
    } as Partial<CalendarEvent>);
    expect(getSeriesRootsForMed([target, task], target)).toEqual(['m1']);
  });
});

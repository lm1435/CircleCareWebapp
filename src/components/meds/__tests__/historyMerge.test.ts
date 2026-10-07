// mergeHistoryDays: scheduled confirmations + as-needed doses in ONE list of
// day groups. The day of a dose is its INSTANT read in the CARE RECIPIENT's
// zone — never the device's (Denver in this suite) and never the UTC date.

import type { AsNeededDoseWithEvent } from '@/api/medicationAsNeeded';
import type { HistoryConfirmation } from '../historyQuery';
import { mergeHistoryDays, mergedMedicationOptions } from '../historyMerge';

const AUCKLAND = 'Pacific/Auckland'; // UTC+12 in early September
const LA = 'America/Los_Angeles'; // UTC-7 in September

function dose(
  id: string,
  given_at: string,
  name = 'Ibuprofen',
  over: Partial<AsNeededDoseWithEvent> = {}
): AsNeededDoseWithEvent {
  return {
    id,
    event_id: `evt-${name}`,
    circle_id: 'c1',
    given_at,
    given_by: 'u1',
    note: null,
    client_request_id: `req-${id}`,
    created_at: given_at,
    removed_at: null,
    removed_by: null,
    event: { id: `evt-${name}`, title: name, medication_name: name, medication_dosage: '200 mg' },
    ...over,
  };
}

function confirmation(
  id: string,
  name: string,
  scheduledDate: string,
  scheduledTime: string
): HistoryConfirmation {
  return {
    id,
    event_id: `evt-${id}`,
    circle_id: 'c1',
    confirmed_by: 'u1',
    confirmed_at: `${scheduledDate}T20:00:00Z`,
    status: 'taken',
    scheduled_time: scheduledTime,
    event: {
      id: `evt-${id}`,
      title: name,
      medication_name: name,
      medication_dosage: null,
      scheduled_date: scheduledDate,
    },
  } as HistoryConfirmation;
}

describe('mergeHistoryDays: the recipient-zone day of a PRN dose', () => {
  it('a dose at 00:30 Auckland on the 7th (= 12:30Z the 6th, = 06:30 Denver the 6th) lands on the 7th', () => {
    const groups = mergeHistoryDays([], [dose('d1', '2026-09-06T12:30:00Z')], AUCKLAND, null);
    expect(groups.map((g) => g.date)).toEqual(['2026-09-07']);
    expect(groups[0].doses.map((d) => d.id)).toEqual(['d1']);
  });

  it('a dose at 23:30 Los Angeles on the 6th (= 06:30Z the 7th = 00:30 Denver the 7th) lands on the 6th', () => {
    const groups = mergeHistoryDays([], [dose('d1', '2026-09-07T06:30:00Z')], LA, null);
    expect(groups.map((g) => g.date)).toEqual(['2026-09-06']);
  });

  it('an unparseable instant is dropped, not grouped under "Invalid Date"', () => {
    expect(mergeHistoryDays([], [dose('d1', 'garbage')], LA, null)).toEqual([]);
  });
});

describe('mergeHistoryDays: merging', () => {
  it('doses join the day of the scheduled rows; scheduled order (time asc) is untouched; newest day first', () => {
    const groups = mergeHistoryDays(
      [
        confirmation('c2', 'Metformin', '2026-09-06', '20:00:00'),
        confirmation('c1', 'Lisinopril', '2026-09-06', '08:00:00'),
        confirmation('c0', 'Metformin', '2026-09-04', '08:00:00'),
      ],
      [
        dose('older', '2026-09-06T15:00:00Z'), // 8:00 AM LA
        dose('newer', '2026-09-06T22:00:00Z'), // 3:00 PM LA
        dose('other-day', '2026-09-05T22:00:00Z'),
      ],
      LA,
      null
    );
    expect(groups.map((g) => g.date)).toEqual(['2026-09-06', '2026-09-05', '2026-09-04']);
    expect(groups[0].confirmations.map((c) => c.id)).toEqual(['c1', 'c2']);
    // PRN rows after the scheduled ones, newest first.
    expect(groups[0].doses.map((d) => d.id)).toEqual(['newer', 'older']);
    // A day with only PRN doses still exists (the empty state must not show).
    expect(groups[1].confirmations).toEqual([]);
    expect(groups[1].doses.map((d) => d.id)).toEqual(['other-day']);
  });

  it('removed doses stay in the list (they render struck through)', () => {
    const groups = mergeHistoryDays(
      [],
      [dose('gone', '2026-09-06T22:00:00Z', 'Ibuprofen', { removed_at: '2026-09-06T23:00:00Z' })],
      LA,
      null
    );
    expect(groups[0].doses[0].removed_at).toBe('2026-09-06T23:00:00Z');
  });

  it('the medication filter (by NAME) filters doses AND confirmations', () => {
    const groups = mergeHistoryDays(
      [confirmation('c1', 'Metformin', '2026-09-06', '08:00:00')],
      [dose('d1', '2026-09-06T22:00:00Z', 'Ibuprofen'), dose('d2', '2026-09-06T23:00:00Z', 'Tylenol')],
      LA,
      'Ibuprofen'
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].confirmations).toEqual([]);
    expect(groups[0].doses.map((d) => d.id)).toEqual(['d1']);
  });

  it('a dose with no medication_name falls back to its event title for the filter', () => {
    const d = dose('d1', '2026-09-06T22:00:00Z', 'Tylenol');
    d.event = { id: 'e', title: 'Tylenol', medication_name: null, medication_dosage: null };
    expect(mergeHistoryDays([], [d], LA, 'Tylenol')[0].doses).toHaveLength(1);
  });
});

describe('mergedMedicationOptions', () => {
  it('scheduled names first, then as-needed names not already present', () => {
    const options = mergedMedicationOptions(
      [{ id: 'Metformin', name: 'Metformin' }],
      [dose('a', '2026-09-06T22:00:00Z', 'Ibuprofen'), dose('b', '2026-09-06T22:00:00Z', 'Metformin')]
    );
    expect(options.map((o) => o.name)).toEqual(['Metformin', 'Ibuprofen']);
  });
});

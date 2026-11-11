/**
 * BC-2: hydrate -> save is the identity for a stored wall time INSIDE the circle's spring-forward gap.
 *
 * A stored 02:30 on Denver's 2026-03-08 does not exist; it means the instant 09:30Z (03:30 MDT). The form shows the
 * real local time, but an untouched save used to re-derive the pair from that instant and send 03:30, so the backend
 * saw a changed time (the reschedule path). With `heldStored` the save sends the STORED strings while the form's
 * instant is still the one the edit opened with. The circle is the zone below; the viewer is the process zone (TZ).
 */
import { describe, expect, it } from 'vitest';
import { eventDatesForApi, eventDatesFromApi } from '@/utils/recipientEventDate';

const GAP_CASES: Array<[zone: string, date: string, time: string]> = [
  ['America/Denver', '2026-03-08', '02:00'],
  ['America/Denver', '2026-03-08', '02:30'],
  ['Europe/London', '2026-03-29', '01:00'],
  ['Pacific/Auckland', '2026-09-27', '02:00'],
  ['Australia/Lord_Howe', '2026-10-04', '02:00'],
  ['America/Santiago', '2026-09-06', '00:00'],
  ['America/Havana', '2026-03-08', '00:00'],
  ['Pacific/Chatham', '2026-09-27', '03:00'],
];

describe('BC-2 untouched edit of a gap time', () => {
  it.each(GAP_CASES)('untouched edit of a gap time sends the stored pair: %s %s %s', (zone, date, time) => {
    const hydrated = eventDatesFromApi({ scheduledDate: date, scheduledTime: `${time}:00`, timezone: zone });
    const saved = eventDatesForApi({
      dateStr: hydrated.dateStr,
      timeStr: hydrated.timeStr,
      recurrenceEndDateStr: null,
      timezone: zone,
      heldInstant: hydrated.instant,
      heldStored: { scheduledDate: date, scheduledTime: `${time}:00`, instant: hydrated.instant as Date },
    });
    expect(saved.scheduledDate).toBe(date);
    expect(saved.scheduledTime).toBe(time);
  });

  it('keeps the repeat span from the stored date', () => {
    const [zone, date, time] = GAP_CASES[1];
    const hydrated = eventDatesFromApi({
      scheduledDate: date,
      scheduledTime: time,
      recurrenceEndDate: '2026-03-18',
      timezone: zone,
    });
    const saved = eventDatesForApi({
      dateStr: hydrated.dateStr,
      timeStr: hydrated.timeStr,
      recurrenceEndDateStr: hydrated.recurrenceEndDateStr,
      timezone: zone,
      heldInstant: hydrated.instant,
      heldStored: { scheduledDate: date, scheduledTime: time, instant: hydrated.instant as Date },
    });
    expect(saved).toEqual({ scheduledDate: '2026-03-08', scheduledTime: '02:30', recurrenceEndDate: '2026-03-18' });
  });

  it.each(GAP_CASES)('moving the time off the held instant converts normally: %s %s %s', (zone, date, time) => {
    const hydrated = eventDatesFromApi({ scheduledDate: date, scheduledTime: time, timezone: zone });
    // The user picks 05:00 on the circle's clock (a chip / the picker): a different instant than the held one.
    const moved = eventDatesFromApi({ scheduledDate: date, scheduledTime: '05:00', timezone: zone });
    const saved = eventDatesForApi({
      dateStr: moved.dateStr,
      timeStr: moved.timeStr,
      recurrenceEndDateStr: null,
      timezone: zone,
      heldInstant: moved.instant,
      heldStored: { scheduledDate: date, scheduledTime: time, instant: hydrated.instant as Date },
    });
    expect(saved.scheduledDate).toBe(date);
    expect(saved.scheduledTime).toBe('05:00');
  });

  it('without heldStored the old behaviour is unchanged (the pair is re-derived from the instant)', () => {
    const hydrated = eventDatesFromApi({ scheduledDate: '2026-03-08', scheduledTime: '02:30', timezone: 'America/Denver' });
    const saved = eventDatesForApi({
      dateStr: hydrated.dateStr,
      timeStr: hydrated.timeStr,
      recurrenceEndDateStr: null,
      timezone: 'America/Denver',
      heldInstant: hydrated.instant,
    });
    expect(saved.scheduledTime).toBe('03:30');
  });
});

import { describe, expect, it } from 'vitest';
import {
  markItEligible,
  startRolled,
  startsWhen,
  toWireTime,
  type SavedMedicationInfo,
} from '@/utils/firstMedSaved';

const base: SavedMedicationInfo = {
  eventId: 'ev-1',
  name: 'Metformin',
  dosage: '500mg',
  doses: [{ scheduledDate: '2026-09-02', scheduledTime: '08:00:00' }],
  timezone: 'UTC',
  recurrenceRule: 'daily',
  recurrenceDays: null,
  startsNextDose: true,
  startDate: '2026-09-02',
  today: '2026-09-01',
};

describe('toWireTime', () => {
  it('pads HH:MM to HH:MM:SS and leaves HH:MM:SS alone', () => {
    expect(toWireTime('08:00')).toBe('08:00:00');
    expect(toWireTime('08:00:00')).toBe('08:00:00');
  });
});

describe('markItEligible on a weekly weekday set (2026-09-01 is a Tuesday)', () => {
  const weekly = { ...base, recurrenceRule: 'weekly', startDate: '2026-09-02' };
  it('P: offered when today is one of the chosen weekdays', () => {
    expect(markItEligible({ ...weekly, recurrenceDays: [2, 4] })).toBe(true);
  });
  it('N: not offered when today is NOT a chosen weekday (Mon/Wed/Fri saved on a Tuesday)', () => {
    expect(markItEligible({ ...weekly, recurrenceDays: [1, 3, 5] })).toBe(false);
  });
  it('P: daily and an empty/no day set are unaffected', () => {
    expect(markItEligible({ ...base, recurrenceDays: [1, 3, 5] })).toBe(true);
    expect(markItEligible({ ...weekly, recurrenceDays: null })).toBe(true);
  });
});

describe('startRolled / markItEligible', () => {
  it('is eligible when the first time had passed and the server start is after today', () => {
    expect(startRolled(base)).toBe(true);
    expect(markItEligible(base)).toBe(true);
  });

  it('is not eligible when the first time had NOT passed', () => {
    expect(markItEligible({ ...base, startsNextDose: false, startDate: '2026-09-01' })).toBe(false);
  });

  it('trusts the server: a past time the server did NOT roll is not eligible', () => {
    expect(markItEligible({ ...base, startDate: '2026-09-01' })).toBe(false);
  });

  it('falls back to the client prediction when the response carried no start date', () => {
    expect(markItEligible({ ...base, startDate: null })).toBe(true);
  });

  it('needs a root id to mark', () => {
    expect(markItEligible({ ...base, eventId: null })).toBe(false);
  });
});

describe('startsWhen', () => {
  it('today / tomorrow / later from the server start date', () => {
    expect(startsWhen({ ...base, startDate: '2026-09-01' })).toBe('today');
    expect(startsWhen({ ...base, startDate: '2026-09-02' })).toBe('tomorrow');
    expect(startsWhen({ ...base, startDate: '2026-09-08' })).toBe('later');
  });

  it('uses the first dose date when the start date is unknown', () => {
    expect(startsWhen({ ...base, startDate: null })).toBe('tomorrow');
  });
});

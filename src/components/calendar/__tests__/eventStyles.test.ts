import type { CalendarEvent } from '@/api/calendarEvents';
import { getEventCardClass, getMedicationStatus } from '../eventStyles';

const TZ = 'America/Chicago';
// 2026-06-12T15:30:00Z = 10:30 AM in Chicago (CDT, UTC-5)
const NOW = new Date('2026-06-12T15:30:00Z');

function makeEvent(overrides: Partial<CalendarEvent>): CalendarEvent {
  return {
    id: 'ev-1',
    circle_id: 'circle-1',
    event_type: 'medication',
    title: 'Metformin',
    scheduled_date: '2026-06-12',
    scheduled_time: '08:00:00',
    created_at: '2026-06-01T00:00:00Z',
    updated_at: '2026-06-01T00:00:00Z',
    ...overrides,
  };
}

describe('getMedicationStatus', () => {
  it('returns null for non-medication events', () => {
    expect(getMedicationStatus(makeEvent({ event_type: 'appointment' }), TZ, NOW)).toBeNull();
    expect(getMedicationStatus(makeEvent({ event_type: 'task' }), TZ, NOW)).toBeNull();
  });

  it('maps taken and taken_late confirmations to taken', () => {
    const confirmation = { confirmed_at: '2026-06-12T13:05:00Z', confirmed_by: 'u1' };
    expect(
      getMedicationStatus(makeEvent({ confirmation: { ...confirmation, status: 'taken' } }), TZ, NOW)
    ).toBe('taken');
    expect(
      getMedicationStatus(
        makeEvent({ confirmation: { ...confirmation, status: 'taken_late' } }),
        TZ,
        NOW
      )
    ).toBe('taken');
  });

  it('maps skipped and missed confirmations', () => {
    const confirmation = { confirmed_at: '2026-06-12T13:05:00Z', confirmed_by: 'u1' };
    expect(
      getMedicationStatus(
        makeEvent({ confirmation: { ...confirmation, status: 'skipped' } }),
        TZ,
        NOW
      )
    ).toBe('skipped');
    expect(
      getMedicationStatus(makeEvent({ confirmation: { ...confirmation, status: 'missed' } }), TZ, NOW)
    ).toBe('missed');
  });

  it('unconfirmed past-due meds are missed — in the CARE RECIPIENT timezone', () => {
    // 8:00 AM Chicago has passed at 10:30 AM Chicago
    expect(getMedicationStatus(makeEvent({}), TZ, NOW)).toBe('missed');
    // Same instant is 9:30 AM in Denver; an 11:00 AM Denver med is still pending
    expect(
      getMedicationStatus(makeEvent({ scheduled_time: '11:00:00' }), 'America/Denver', NOW)
    ).toBe('pending');
  });

  it('unconfirmed future meds are pending', () => {
    expect(getMedicationStatus(makeEvent({ scheduled_time: '20:00:00' }), TZ, NOW)).toBe('pending');
    expect(getMedicationStatus(makeEvent({ scheduled_date: '2026-06-13' }), TZ, NOW)).toBe(
      'pending'
    );
  });

  it('unconfirmed meds on a past date are missed', () => {
    expect(getMedicationStatus(makeEvent({ scheduled_date: '2026-06-11' }), TZ, NOW)).toBe('missed');
  });
});

describe('getEventCardClass', () => {
  it('renders SOLID type-colored blocks with white text (mobile TimelineEventBlock)', () => {
    // Mirrors mobile: medication → clay, appointment → dusk, task → moss,
    // always solid with white text regardless of confirmation status.
    const med = getEventCardClass(makeEvent({ event_type: 'medication' }));
    expect(med).toContain('bg-clay');
    expect(med).toContain('text-cream');

    const appt = getEventCardClass(makeEvent({ event_type: 'appointment' }));
    expect(appt).toContain('bg-dusk');
    expect(appt).toContain('text-cream');

    const task = getEventCardClass(makeEvent({ event_type: 'task' }));
    expect(task).toContain('bg-moss');
    expect(task).toContain('text-cream');
  });

  it('keeps pending/missed blocks solid type-colored with white text', () => {
    const med = makeEvent({ event_type: 'medication' });
    expect(getEventCardClass(med, 'pending')).toContain('bg-clay');
    expect(getEventCardClass(med, 'pending')).toContain('text-cream');
    expect(getEventCardClass(med, 'missed')).toContain('bg-clay');
    expect(getEventCardClass(med, 'missed')).toContain('text-cream');
  });

  it('uses the muted soft-tint + deep-text treatment for done (taken/skipped) — WCAG AA, no opacity', () => {
    const med = makeEvent({ event_type: 'medication' });
    // Done events recede via a soft surface with deep text, NOT opacity (which
    // failed contrast). White cream text must NOT be used on the soft surface.
    expect(getEventCardClass(med, 'taken')).toBe('bg-clay-soft text-clay-deep');
    expect(getEventCardClass(med, 'skipped')).toBe('bg-clay-soft text-clay-deep');
    expect(getEventCardClass(med, 'taken')).not.toContain('text-cream');
    expect(getEventCardClass(med, 'taken')).not.toContain('opacity-70');

    expect(getEventCardClass(makeEvent({ event_type: 'appointment' }), 'taken')).toBe(
      'bg-dusk-soft text-dusk-deep'
    );
    expect(getEventCardClass(makeEvent({ event_type: 'task' }), 'skipped')).toBe(
      'bg-moss-soft text-moss-deep'
    );
  });
});

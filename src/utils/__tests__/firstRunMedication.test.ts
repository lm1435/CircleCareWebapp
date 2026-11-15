import type { CreateEventRequest } from '@/api/calendarEvents';
import { siblingDosePayload } from '../firstRunMedication';

/**
 * `siblingDosePayload`: the payload for an ADDITIONAL dose row of one medication
 * (the 20:00 half of a twice-daily). Pure: no clock, no runner timezone.
 */

/** The wire body the API actually receives — `undefined` keys do not survive. */
function onTheWire(payload: CreateEventRequest): Record<string, unknown> {
  return JSON.parse(JSON.stringify(payload)) as Record<string, unknown>;
}

describe('siblingDosePayload', () => {
  const primary: CreateEventRequest = {
    event_type: 'medication',
    title: 'Metformin',
    medication_name: 'Metformin',
    medication_dosage: '500mg',
    scheduled_date: '2026-09-01',
    scheduled_time: '08:00',
    reminder_at_due: true,
    reminder_24h: false,
    reminder_1h: false,
    reminder_30m: false,
    reminder_15m: false,
    notifications_enabled: true,
    entry_source: 'form',
    recurrence_rule: 'daily',
  };

  it('takes its own clock and the day it is given, not the primary clock', () => {
    const sibling = siblingDosePayload(primary, {
      scheduledTime: '20:00',
      scheduledDate: '2026-09-01',
    });
    expect(sibling.scheduled_time).toBe('20:00');
    expect(sibling.scheduled_date).toBe('2026-09-01');
    expect(primary.scheduled_time).toBe('08:00');
  });

  it('points the sibling at the primary bottle', () => {
    const sibling = siblingDosePayload(primary, {
      scheduledTime: '20:00',
      scheduledDate: '2026-09-01',
      refillGroupId: 'evt-1',
    });
    expect(sibling.refill_group_id).toBe('evt-1');
  });

  /**
   * THE PRIMARY MUST ACTUALLY CARRY A BOTTLE, or this asserts nothing: against a
   * primary without refill fields the `not.toHaveProperty` checks pass whether
   * the clears exist or not. A sibling that inherited `quantity_remaining` would
   * be a SECOND counter draining at half the real rate, so the refill alert
   * would fire late.
   */
  it('leaves the bottle with the owner — the sibling carries no refill state', () => {
    const trackedPrimary: CreateEventRequest = {
      ...primary,
      track_refills: true,
      quantity_in_bottle: 60,
      quantity_remaining: 42,
      pills_per_day: 2,
      alert_days_before: 7,
    };
    const sibling = siblingDosePayload(trackedPrimary, {
      scheduledTime: '20:00',
      scheduledDate: '2026-09-01',
      refillGroupId: 'evt-1',
    });
    expect(sibling.track_refills).toBe(false);
    const wire = onTheWire(sibling);
    expect(wire).not.toHaveProperty('quantity_in_bottle');
    expect(wire).not.toHaveProperty('quantity_remaining');
    expect(wire).not.toHaveProperty('pills_per_day');
    expect(wire).not.toHaveProperty('pills_per_dose');
    expect(wire).not.toHaveProperty('alert_days_before');
    // The OWNER keeps every one of them: the clears are the sibling's, not a mutation of the primary.
    expect(onTheWire(trackedPrimary)).toMatchObject({
      track_refills: true,
      quantity_in_bottle: 60,
      quantity_remaining: 42,
      pills_per_day: 2,
      alert_days_before: 7,
    });
  });

  /**
   * Absent, NOT null. The backend reads an absent key as "leave alone" while an
   * explicit null would detach a row that never had a bottle.
   */
  it('omits refill_group_id when the primary create returned no id', () => {
    const sibling = siblingDosePayload(primary, {
      scheduledTime: '20:00',
      scheduledDate: '2026-09-01',
    });
    expect('refill_group_id' in sibling).toBe(false);
  });

  it('carries the primary’s identity and all six reminder flags', () => {
    const sibling = siblingDosePayload(primary, {
      scheduledTime: '20:00',
      scheduledDate: '2026-09-01',
      refillGroupId: 'evt-1',
    });
    expect(sibling.title).toBe(primary.title);
    expect(sibling.medication_name).toBe(primary.medication_name);
    expect(sibling.recurrence_rule).toBe(primary.recurrence_rule);
    // Spelled out flag by flag: `reminder_at_due: false` on a sibling silences the evening dose outright.
    expect(sibling.notifications_enabled).toBe(true);
    expect(sibling.reminder_at_due).toBe(true);
    for (const flag of [
      'notifications_enabled',
      'reminder_at_due',
      'reminder_24h',
      'reminder_1h',
      'reminder_30m',
      'reminder_15m',
    ] as const) {
      expect(sibling[flag], `sibling ${flag} diverged from the primary`).toBe(primary[flag]);
    }
  });
});

import { describe, expect, it } from 'vitest';
import {
  EMPTY_MEDICATION_DETAILS,
  daysSupplyRate,
  derivedPillsPerDay,
  isCountableForm,
  medicationDetailsFromEvent,
  medicationDetailsPayload,
  type MedicationDetailsState,
} from '../medicationDetailsForm';

// PORT of mobile AddEventScreen's save block for the medication "More details" fields (refill tracking +
// prescription details), and of `utils/refillPayload` / `refillFormFigures` / `medicationHydrationFields`.
// Each expectation below is what MOBILE sends for the same form state (read off mobile's save path).

function state(over: Partial<MedicationDetailsState> = {}): MedicationDetailsState {
  return { ...EMPTY_MEDICATION_DETAILS, ...over };
}
const CREATE = {
  isEditing: false,
  asNeeded: false,
  hydration: null,
  doseTimeCount: 1,
  recurrenceRule: 'daily' as string | null,
  recurrenceDays: null as number[] | null,
};

describe('medicationDetailsPayload — create', () => {
  it('sends nothing for an untouched form (the column defaults: track_refills FALSE)', () => {
    expect(medicationDetailsPayload(state(), CREATE)).toEqual({});
  });

  it('refills on: bottle, live count, per dose, the day mirror and the alert threshold', () => {
    expect(
      medicationDetailsPayload(
        state({ trackRefills: true, quantityInBottle: '60', pillsPerDose: '1', alertDaysBefore: '7' }),
        { ...CREATE, doseTimeCount: 2 }
      )
    ).toEqual({
      track_refills: true,
      quantity_in_bottle: 60,
      quantity_remaining: 60,
      pills_per_day: 2,
      pills_per_dose: 1,
      alert_days_before: 7,
    });
  });

  it('a weekly medication omits pills_per_day (the INTEGER column cannot hold 1/7)', () => {
    const out = medicationDetailsPayload(
      state({ trackRefills: true, quantityInBottle: '12', pillsPerDose: '1', alertDaysBefore: '7' }),
      { ...CREATE, recurrenceRule: 'weekly', recurrenceDays: [1] }
    );
    expect(out).not.toHaveProperty('pills_per_day');
    expect(out.pills_per_dose).toBe(1);
  });

  it('blank counts are omitted rather than sent as 0', () => {
    expect(
      medicationDetailsPayload(
        state({ trackRefills: true, quantityInBottle: '', pillsPerDose: '', alertDaysBefore: '' }),
        CREATE
      )
    ).toEqual({ track_refills: true, pills_per_day: 1 });
  });

  it('prescription details are trimmed and sent only when filled', () => {
    expect(
      medicationDetailsPayload(
        state({ prescriberName: '  Dr. Lee ', pharmacyName: 'Main St', pharmacyPhone: '', rxNumber: ' 123 ' }),
        CREATE
      )
    ).toEqual({ prescriber_name: 'Dr. Lee', pharmacy_name: 'Main St', rx_number: '123' });
  });

  it('as needed: nothing refill-shaped, prescription details still travel', () => {
    expect(
      medicationDetailsPayload(state({ trackRefills: true, quantityInBottle: '30', pharmacyName: 'CVS' }), {
        ...CREATE,
        asNeeded: true,
        recurrenceRule: null,
      })
    ).toEqual({ pharmacy_name: 'CVS' });
  });
});

describe('medicationDetailsPayload — edit', () => {
  const stored = medicationDetailsFromEvent({
    track_refills: true,
    quantity_in_bottle: 60,
    pills_per_day: 2,
    pills_per_dose: 1,
    alert_days_before: 5,
    prescriber_name: 'Dr. Lee',
    pharmacy_name: null,
    pharmacy_phone: null,
    rx_number: null,
    refill_group_id: null,
    medication_photo_url: null,
  });
  const EDIT = { ...CREATE, isEditing: true, hydration: stored.hydration };

  it('details not loaded yet: NO key at all (a partial patch leaves the stored values alone)', () => {
    expect(
      medicationDetailsPayload(state({ trackRefills: false, prescriberName: 'X' }), { ...EDIT, hydration: null })
    ).toEqual({});
  });

  it('untouched: track_refills echoed, the bottle not re-seeded, the stored per-dose not rewritten', () => {
    expect(medicationDetailsPayload(stored.state, EDIT)).toEqual({
      track_refills: true,
      quantity_in_bottle: 60,
      pills_per_dose: 1,
      alert_days_before: 5,
      prescriber_name: 'Dr. Lee',
    });
  });

  it('an emptied prescription field that HAD a value is sent as null (clears it); one already empty is not sent', () => {
    const out = medicationDetailsPayload({ ...stored.state, prescriberName: '  ' }, EDIT);
    expect(out.prescriber_name).toBeNull();
    for (const key of ['pharmacy_name', 'pharmacy_phone', 'rx_number']) expect(out).not.toHaveProperty(key);
  });

  it('each of the four clears on its own; the others keep their echoed value', () => {
    const full = medicationDetailsFromEvent({
      prescriber_name: 'Dr. Lee', pharmacy_name: 'CVS', pharmacy_phone: '555', rx_number: 'RX',
    });
    const ctx = { ...EDIT, hydration: full.hydration };
    const filled = { prescriber_name: 'Dr. Lee', pharmacy_name: 'CVS', pharmacy_phone: '555', rx_number: 'RX' };
    for (const [field, key] of [
      ['prescriberName', 'prescriber_name'], ['pharmacyName', 'pharmacy_name'],
      ['pharmacyPhone', 'pharmacy_phone'], ['rxNumber', 'rx_number'],
    ] as const) {
      const out = medicationDetailsPayload({ ...full.state, [field]: '' }, ctx);
      expect(out).toMatchObject({ ...filled, [key]: null });
    }
  });

  it('a create never sends null for an empty prescription field', () => {
    expect(medicationDetailsPayload(state({ prescriberName: '' }), CREATE)).not.toHaveProperty('prescriber_name');
  });

  it('alert days 0 is sent as typed so the 1-90 check refuses it (mobile parity); empty sends no key', () => {
    expect(medicationDetailsPayload({ ...stored.state, alertDaysBefore: '0' }, EDIT).alert_days_before).toBe(0);
    expect(medicationDetailsPayload({ ...stored.state, alertDaysBefore: '' }, EDIT)).not.toHaveProperty(
      'alert_days_before'
    );
  });

  it('a re-count restarts the live count', () => {
    const out = medicationDetailsPayload({ ...stored.state, quantityInBottle: '90' }, EDIT);
    expect(out.quantity_in_bottle).toBe(90);
    expect(out.quantity_remaining).toBe(90);
  });

  it('a changed dose amount refreshes the day figure from the stored pair', () => {
    const out = medicationDetailsPayload({ ...stored.state, pillsPerDose: '2' }, EDIT);
    expect(out.pills_per_dose).toBe(2);
    expect(out.pills_per_day).toBe(4);
  });

  it('turning refills off sends false and nothing else refill-shaped', () => {
    expect(medicationDetailsPayload({ ...stored.state, trackRefills: false }, EDIT)).toEqual({
      track_refills: false,
      prescriber_name: 'Dr. Lee',
    });
  });

  it('a dose that SHARES a bottle sends no refill key', () => {
    const shared = medicationDetailsFromEvent({ refill_group_id: 'owner-id', track_refills: false });
    expect(
      medicationDetailsPayload(shared.state, { ...EDIT, hydration: shared.hydration })
    ).toEqual({});
    expect(shared.hydration.refillsManagedElsewhere).toBe(true);
  });

  it('a derived per-dose box left untouched is not written back', () => {
    const legacy = medicationDetailsFromEvent({ track_refills: true, pills_per_day: 2, pills_per_dose: null });
    expect(legacy.state.pillsPerDose).toBe('2');
    const out = medicationDetailsPayload(legacy.state, { ...EDIT, hydration: legacy.hydration });
    expect(out).not.toHaveProperty('pills_per_dose');
    expect(out).not.toHaveProperty('pills_per_day');
  });
});

describe('form figures', () => {
  it('countable unless a known non-countable form', () => {
    expect(isCountableForm(null)).toBe(true);
    expect(isCountableForm('Tablet')).toBe(true);
    expect(isCountableForm('solution')).toBe(false);
  });
  it('derived per day and the days-supply rate (create uses the derived figure, edit the stored one)', () => {
    expect(derivedPillsPerDay('2', 2)).toBe(4);
    expect(derivedPillsPerDay('', 2)).toBeNull();
    expect(
      daysSupplyRate({ isEditing: false, derivedPillsPerDay: 4, storedPillsPerDay: null, pillsPerDose: '2', hydratedPillsPerDose: '' })
    ).toBe(4);
    expect(
      daysSupplyRate({ isEditing: true, derivedPillsPerDay: 1, storedPillsPerDay: 2, pillsPerDose: '1', hydratedPillsPerDose: '1' })
    ).toBe(2);
    expect(
      daysSupplyRate({ isEditing: true, derivedPillsPerDay: 2, storedPillsPerDay: 2, pillsPerDose: '2', hydratedPillsPerDose: '1' })
    ).toBeNull();
  });
});

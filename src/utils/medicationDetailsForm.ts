import type { CreateEventRequest } from '@/api/calendarEvents';

/**
 * The medication form's "More details" fields that are not the schedule: refill tracking and the
 * prescription details (prescriber, pharmacy, pharmacy phone, Rx number).
 *
 * PORT of mobile: `AddEventScreen` (save block + derived figures), `utils/refillPayload.ts`,
 * `utils/refillFormFigures.ts`, `utils/medicationConsumption.ts`, `utils/medicationHydrationFields.ts`
 * and `utils/refillOwnership.ts`. The request keys and their rules are mobile's, so a medication
 * saved on the web reads exactly like one saved on a phone. The one deliberate difference: a CREATE
 * with refills off leaves `track_refills` out instead of sending `false` (the column is
 * `BOOLEAN DEFAULT FALSE`, so the stored row is identical, and every untouched web create body stays
 * byte-identical to before these fields existed).
 */

export interface MedicationDetailsState {
  trackRefills: boolean;
  /** Pills (or units) in the bottle right now — `quantity_in_bottle`. Digits only, '' = not set. */
  quantityInBottle: string;
  /** Pills in ONE dose — `pills_per_dose`. */
  pillsPerDose: string;
  /** Days before empty to alert — `alert_days_before` (backend: 1..90). */
  alertDaysBefore: string;
  prescriberName: string;
  pharmacyName: string;
  pharmacyPhone: string;
  rxNumber: string;
}

export const EMPTY_MEDICATION_DETAILS: MedicationDetailsState = {
  trackRefills: false,
  quantityInBottle: '',
  pillsPerDose: '',
  // Mobile's default threshold.
  alertDaysBefore: '7',
  prescriberName: '',
  pharmacyName: '',
  pharmacyPhone: '',
  rxNumber: '',
};

/** What the edit form learned from the stored row, needed to tell an untouched field from an edit. */
export interface MedicationDetailsHydration {
  /** `quantity_in_bottle` as hydrated: only a changed bottle size re-seeds `quantity_remaining`. */
  hydratedQuantity: string;
  storedPillsPerDay: number | null;
  /** The per-dose box as hydrated. */
  hydratedPillsPerDose: string;
  /** The per-dose box was DERIVED from `pills_per_day` (no stored `pills_per_dose`). */
  pillsPerDoseWasDerived: boolean;
  /** This dose shares a bottle owned by another dose row (`refill_group_id` set). */
  refillsManagedElsewhere: boolean;
  /** Which prescription fields HAD a stored value: only those are cleared (null) when emptied. */
  storedPrescription?: Partial<Record<PrescriptionKey, boolean>>;
}

type PrescriptionKey = 'prescriber_name' | 'pharmacy_name' | 'pharmacy_phone' | 'rx_number';

/** The columns the edit form hydrates from (the single-event GET; the events list omits most of them). */
export interface MedicationDetailsSource {
  track_refills?: boolean | null;
  quantity_in_bottle?: number | null;
  pills_per_day?: number | null;
  pills_per_dose?: number | null;
  alert_days_before?: number | null;
  prescriber_name?: string | null;
  pharmacy_name?: string | null;
  pharmacy_phone?: string | null;
  rx_number?: string | null;
  refill_group_id?: string | null;
  medication_photo_url?: string | null;
}

const COUNTABLE_FORMS = new Set([
  'tablet', 'capsule', 'cap', 'tab', 'pill', 'lozenge', 'suppository',
  'troche', 'wafer', 'gummy', 'chewable tablet', 'orally disintegrating tablet',
]);

/** Mobile `isCountableForm`: pills are counted unless the picked drug's form is known not to be. */
export function isCountableForm(dosageForm: string | null | undefined): boolean {
  if (!dosageForm) return true;
  return COUNTABLE_FORMS.has(dosageForm.toLowerCase());
}

export function wholePills(value: number): number {
  return Math.ceil(value);
}

function usable(value: number | null | undefined, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return fallback;
  return value;
}

export function dailyConsumption(input: { pillsPerDose: number | null | undefined; doseTimeCount: number }): number {
  return wholePills(usable(input.pillsPerDose, 1)) * usable(input.doseTimeCount, 1);
}

export function dosesPerDayForRecurrence(rule: string | null | undefined, recurrenceDays?: number[] | null): number | null {
  if (!rule) return null;
  switch (rule) {
    case 'daily':
      return 1;
    case 'every_other_day':
      return 0.5;
    case 'weekly': {
      const scheduledDays = new Set(
        (recurrenceDays ?? []).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)
      ).size;
      return scheduledDays > 0 ? scheduledDays / 7 : 1 / 7;
    }
    case 'monthly':
      return 1 / 30.4375;
    case 'yearly':
      return 1 / 365.25;
    default:
      break;
  }
  const custom = /^custom:(\d+)$/.exec(rule);
  if (custom) {
    const interval = Number(custom[1]);
    return interval > 0 ? 1 / interval : null;
  }
  const cycle = /^cycle:(\d+):(\d+)$/.exec(rule);
  if (cycle) {
    const onDays = Number(cycle[1]);
    const offDays = Number(cycle[2]);
    if (onDays <= 0 || offDays <= 0) return null;
    return onDays / (onDays + offDays);
  }
  return null;
}

/** The `pills_per_day` mirror, or undefined when the INTEGER column cannot tell the truth (sub-daily). */
export function pillsPerDayForStorage(input: {
  pillsPerDose: number | null | undefined;
  doseTimeCount: number;
  recurrenceRule: string | null | undefined;
  recurrenceDays?: number[] | null;
}): number | undefined {
  const perDosingDay = dailyConsumption({ pillsPerDose: input.pillsPerDose, doseTimeCount: input.doseTimeCount });
  if (!input.recurrenceRule) return perDosingDay;
  const dosesPerDay = dosesPerDayForRecurrence(input.recurrenceRule, input.recurrenceDays);
  if (dosesPerDay === null || dosesPerDay < 1) return undefined;
  return wholePills(perDosingDay * dosesPerDay);
}

/** Mobile `quantityRemainingForSave`: the live count restarts only on a create or a deliberate re-count. */
function quantityRemainingForSave(quantity: number, isEditing: boolean, field: string, hydrated: string | null): number | undefined {
  if (!(quantity > 0)) return undefined;
  if (!isEditing) return quantity;
  return field === hydrated ? undefined : quantity;
}

/** Mobile `pillsPerDoseForSave`. */
function pillsPerDoseForSave(field: string, isEditing: boolean, hydration: MedicationDetailsHydration | null): number | undefined {
  if (isEditing && hydration?.pillsPerDoseWasDerived && field.trim() === hydration.hydratedPillsPerDose.trim()) {
    return undefined;
  }
  const parsed = Number(field.trim());
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return Math.max(1, wholePills(parsed));
}

/** Mobile `pillsPerDayForSave`: keep the day figure in step with a corrected dose amount, from two STORED numbers only. */
function pillsPerDayForSave(input: {
  storedPillsPerDay: number | null;
  storedPillsPerDose: number | null;
  nextPillsPerDose: number;
  recurrenceRule: string | null;
  recurrenceDays: number[] | null;
}): number | undefined {
  const { storedPillsPerDay, storedPillsPerDose, nextPillsPerDose } = input;
  if (typeof storedPillsPerDay !== 'number' || !(storedPillsPerDay > 0)) return undefined;
  if (typeof storedPillsPerDose !== 'number' || !(storedPillsPerDose > 0)) return undefined;
  if (!(nextPillsPerDose > 0) || nextPillsPerDose === storedPillsPerDose) return undefined;
  const doseTimes = storedPillsPerDay / storedPillsPerDose;
  if (!Number.isInteger(doseTimes) || doseTimes < 1) return undefined;
  return pillsPerDayForStorage({
    pillsPerDose: nextPillsPerDose,
    doseTimeCount: doseTimes,
    recurrenceRule: input.recurrenceRule,
    recurrenceDays: input.recurrenceDays,
  });
}

export interface MedicationDetailsContext {
  isEditing: boolean;
  /** As needed (new or stored): refills are off in v1, nothing refill-shaped is sent. */
  asNeeded: boolean;
  /**
   * EDIT: what the stored row said, or null while it has not loaded (or failed to): then NO key is
   * sent, because an update is a partial patch and the form's empty defaults are not the stored
   * values. CREATE: null.
   */
  hydration: MedicationDetailsHydration | null;
  /** The primary plus each extra dose time (create only; an edit cannot see its siblings). */
  doseTimeCount: number;
  /** The rule and days being saved (`recurrence_rule` / `recurrence_days` of the payload). */
  recurrenceRule: string | null;
  recurrenceDays: number[] | null;
}

type DetailsPayload = Pick<
  CreateEventRequest,
  | 'track_refills'
  | 'quantity_in_bottle'
  | 'quantity_remaining'
  | 'pills_per_day'
  | 'pills_per_dose'
  | 'alert_days_before'
  | 'prescriber_name'
  | 'pharmacy_name'
  | 'pharmacy_phone'
  | 'rx_number'
>;

/** The request keys for these fields — mobile's save block, key for key. */
export function medicationDetailsPayload(state: MedicationDetailsState, ctx: MedicationDetailsContext): DetailsPayload {
  const out: DetailsPayload = {};
  if (ctx.isEditing && !ctx.hydration) return out;
  const hydration = ctx.hydration;

  if (!hydration?.refillsManagedElsewhere && !ctx.asNeeded) {
    if (ctx.isEditing || state.trackRefills) out.track_refills = state.trackRefills;
    if (state.trackRefills) {
      const qty = parseInt(state.quantityInBottle, 10);
      if (qty > 0) out.quantity_in_bottle = qty;
      const remaining = quantityRemainingForSave(
        qty,
        ctx.isEditing,
        state.quantityInBottle,
        hydration?.hydratedQuantity ?? null
      );
      if (remaining !== undefined) out.quantity_remaining = remaining;

      const weeklyDays = ctx.recurrenceRule === 'weekly' ? ctx.recurrenceDays : null;
      // The day mirror on CREATE only (an edit's dose-time count reads 1).
      if (!ctx.isEditing) {
        const perDay = pillsPerDayForStorage({
          pillsPerDose: Number(state.pillsPerDose.trim()) || null,
          doseTimeCount: Math.max(1, ctx.doseTimeCount),
          recurrenceRule: ctx.recurrenceRule,
          recurrenceDays: weeklyDays,
        });
        if (perDay !== undefined) out.pills_per_day = perDay;
      }

      const perDose = pillsPerDoseForSave(state.pillsPerDose, ctx.isEditing, hydration);
      if (perDose !== undefined) {
        out.pills_per_dose = perDose;
        const storedPerDose = hydration && !hydration.pillsPerDoseWasDerived
          ? parseFloat(hydration.hydratedPillsPerDose)
          : null;
        const refreshed = pillsPerDayForSave({
          storedPillsPerDay: hydration?.storedPillsPerDay ?? null,
          storedPillsPerDose: storedPerDose !== null && Number.isFinite(storedPerDose) ? storedPerDose : null,
          nextPillsPerDose: perDose,
          recurrenceRule: ctx.recurrenceRule,
          recurrenceDays: weeklyDays,
        });
        if (refreshed !== undefined) out.pills_per_day = refreshed;
      }

      // Sent as typed (0 included) so the schema's 1-90 check refuses it inline, as mobile does;
      // an empty box sends no key.
      const alertDays = parseInt(state.alertDaysBefore, 10);
      if (Number.isFinite(alertDays)) out.alert_days_before = alertDays;
    }
  }

  // Prescription details: a filled field is sent trimmed. On an EDIT, a field the person emptied that HAD a
  // stored value is sent as null, which clears it (backend nullable since 2026-11-08; mobile the same); one
  // that was already empty is not sent, so an untouched save's body is unchanged.
  const prescription: [PrescriptionKey, string][] = [
    ['prescriber_name', state.prescriberName],
    ['pharmacy_name', state.pharmacyName],
    ['pharmacy_phone', state.pharmacyPhone],
    ['rx_number', state.rxNumber],
  ];
  for (const [key, field] of prescription) {
    const value = field.trim();
    if (value) out[key] = value;
    else if (ctx.isEditing && hydration?.storedPrescription?.[key]) out[key] = null;
  }
  return out;
}

function numberField(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : '';
}

/** Mobile `hydratedPillsPerDose` with the edit form's dose-time count of 1. */
function hydratedPerDose(pillsPerDose: number | null | undefined, pillsPerDay: number | null | undefined): string {
  if (typeof pillsPerDose === 'number' && pillsPerDose > 0) return String(pillsPerDose);
  if (typeof pillsPerDay === 'number' && pillsPerDay > 0) return String(Math.max(1, wholePills(pillsPerDay)));
  return '';
}

/** Mobile `medicationHydrationFields`: EVERY field, unconditionally. */
export function medicationDetailsFromEvent(event: MedicationDetailsSource): {
  state: MedicationDetailsState;
  hydration: MedicationDetailsHydration;
} {
  const quantity = numberField(event.quantity_in_bottle);
  const perDose = hydratedPerDose(event.pills_per_dose, event.pills_per_day);
  return {
    state: {
      trackRefills: event.track_refills || false,
      quantityInBottle: quantity,
      pillsPerDose: perDose,
      alertDaysBefore: numberField(event.alert_days_before),
      prescriberName: event.prescriber_name ?? '',
      pharmacyName: event.pharmacy_name ?? '',
      pharmacyPhone: event.pharmacy_phone ?? '',
      rxNumber: event.rx_number ?? '',
    },
    hydration: {
      hydratedQuantity: quantity,
      storedPillsPerDay: typeof event.pills_per_day === 'number' ? event.pills_per_day : null,
      hydratedPillsPerDose: perDose,
      pillsPerDoseWasDerived:
        !(typeof event.pills_per_dose === 'number' && event.pills_per_dose > 0) &&
        typeof event.pills_per_day === 'number' &&
        event.pills_per_day > 0,
      refillsManagedElsewhere: !!event.refill_group_id,
      storedPrescription: {
        prescriber_name: !!event.prescriber_name?.trim(),
        pharmacy_name: !!event.pharmacy_name?.trim(),
        pharmacy_phone: !!event.pharmacy_phone?.trim(),
        rx_number: !!event.rx_number?.trim(),
      },
    },
  };
}

/** A stored value behind "More details" opens it on an edit (mobile `shouldExpandMoreDetails`). */
export function medicationDetailsOpenMore(event: MedicationDetailsSource): boolean {
  return !!(
    event.prescriber_name ||
    event.pharmacy_name ||
    event.pharmacy_phone ||
    event.rx_number ||
    event.track_refills ||
    event.medication_photo_url
  );
}

/** The day's consumption shown under the per-dose box (create only), or null when no dose amount. */
export function derivedPillsPerDay(pillsPerDose: string, doseTimeCount: number): number | null {
  const perDose = Number(pillsPerDose.trim());
  if (!pillsPerDose.trim() || !Number.isFinite(perDose) || perDose <= 0) return null;
  return dailyConsumption({ pillsPerDose: perDose, doseTimeCount });
}

/** Mobile `daysSupplyRate`: the rate the "~N days supply" line divides by, or null when unknown. */
export function daysSupplyRate(input: {
  isEditing: boolean;
  derivedPillsPerDay: number | null;
  storedPillsPerDay: number | null;
  pillsPerDose: string;
  hydratedPillsPerDose: string;
}): number | null {
  if (!input.isEditing) return input.derivedPillsPerDay;
  const stored = input.storedPillsPerDay;
  if (typeof stored !== 'number' || !Number.isFinite(stored) || stored <= 0) return null;
  if (input.pillsPerDose.trim() !== input.hydratedPillsPerDose.trim()) return null;
  return stored;
}

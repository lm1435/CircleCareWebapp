import { z } from 'zod';
import type { CreateVitalRequest, UpdateVitalRequest, VitalType } from '@/api/vitals';

// Web vitals form schema + unit-conversion helpers (Plan Task 6.2).
//
// CONVERSION (display ↔ canonical), ported VERBATIM from
// mobile/src/utils/unitConversion.ts:
//   - weight  canonical = kg     ; display lbs|kg     ; lbs = kg / 0.45359237
//   - glucose canonical = mmol/L ; display mg/dL|mmol/L; mg/dL = mmol/L * 18.0182
//   - blood_pressure (mmHg) and heart_rate (bpm) are already canonical (no conversion).
//
// The backend (backend/src/routes/vitals.ts) converts the submitted DISPLAY unit
// to canonical on write, so the web sends value(s) in the user's chosen display
// unit + that unit string. These helpers exist for the UI to (a) render canonical
// stored values in the user's preferred display unit, and (b) drive the per-type
// display-unit ranges used for client validation. The validation mirrors mobile's
// VitalFormScreen RANGES (entered display value) AND the backend VITAL_BOUNDS
// (canonical), which agree once converted.

export type WeightUnit = 'lbs' | 'kg';
export type GlucoseUnit = 'mg/dL' | 'mmol/L';

export interface UnitPreferences {
  weight_unit: WeightUnit;
  glucose_unit: GlucoseUnit;
}

/** Default display units when the user has no saved preference (free fall-back). */
export const DEFAULT_UNIT_PREFERENCES: UnitPreferences = {
  weight_unit: 'lbs',
  glucose_unit: 'mg/dL',
};

// ── Conversion helpers (display ↔ canonical) ───────────────────────────────────

// Weight: canonical is kg.
export function toCanonicalWeight(value: number, from: WeightUnit): number {
  return from === 'lbs' ? value * 0.45359237 : value;
}

export function fromCanonicalWeight(value: number, to: WeightUnit): number {
  return to === 'lbs' ? value / 0.45359237 : value;
}

// Glucose: canonical is mmol/L.
export function toCanonicalGlucose(value: number, from: GlucoseUnit): number {
  return from === 'mg/dL' ? value / 18.0182 : value;
}

export function fromCanonicalGlucose(value: number, to: GlucoseUnit): number {
  return to === 'mmol/L' ? value : value * 18.0182;
}

/** Convert a canonical stored value to the user's display unit for a vital type. */
export function fromCanonicalValue(
  type: VitalType,
  value: number,
  weightUnit: WeightUnit,
  glucoseUnit: GlucoseUnit
): number {
  if (type === 'weight') return fromCanonicalWeight(value, weightUnit);
  if (type === 'glucose') return fromCanonicalGlucose(value, glucoseUnit);
  return value; // BP and HR are already display units.
}

/** The display unit string shown next to an input / value for a vital type. */
export function getDisplayUnit(
  type: VitalType,
  weightUnit: WeightUnit,
  glucoseUnit: GlucoseUnit
): string {
  switch (type) {
    case 'blood_pressure':
      return 'mmHg';
    case 'heart_rate':
      return 'bpm';
    case 'glucose':
      return glucoseUnit;
    case 'weight':
      return weightUnit;
  }
}

/** The CANONICAL unit the value must be reported against per vital type. */
export const CANONICAL_UNITS: Record<VitalType, string> = {
  blood_pressure: 'mmHg',
  heart_rate: 'bpm',
  glucose: 'mmol/L',
  weight: 'kg',
};

/** Allowed *input* (display) units per vital type — mirrors backend ALLOWED_INPUT_UNITS. */
export const ALLOWED_INPUT_UNITS: Record<VitalType, readonly string[]> = {
  blood_pressure: ['mmHg'],
  heart_rate: ['bpm'],
  glucose: ['mg/dL', 'mmol/L'],
  weight: ['lbs', 'kg'],
};

/**
 * Format a vital value for display — mirrors mobile formatVitalValue:
 * BP shows "sys/dia", HR rounds, weight/glucose get 1 decimal.
 */
export function formatVitalValue(
  type: VitalType,
  value1: number,
  value2: number | null | undefined,
  unit: string
): string {
  if (type === 'blood_pressure' && value2 != null) {
    return `${Math.round(value1)}/${Math.round(value2)} ${unit}`;
  }
  if (type === 'heart_rate') {
    return `${Math.round(value1)} ${unit}`;
  }
  return `${Number(value1.toFixed(1))} ${unit}`;
}

// ── Display-unit validation ranges (mirror mobile VitalFormScreen RANGES) ──────

export const VITAL_DISPLAY_RANGES = {
  blood_pressure: {
    systolic: { min: 50, max: 300 },
    diastolic: { min: 20, max: 200 },
  },
  heart_rate: { min: 20, max: 300 },
  glucose: {
    'mg/dL': { min: 20, max: 600 },
    'mmol/L': { min: 1.1, max: 33.3 },
  },
  weight: {
    lbs: { min: 1, max: 1500 },
    kg: { min: 0.5, max: 680 },
  },
} as const;

/** Allowed future clock skew (ms) for recorded_at — mirrors backend FUTURE_SKEW_MS. */
export const RECORDED_AT_FUTURE_SKEW_MS = 5 * 60 * 1000;

// ── Zod form schema ────────────────────────────────────────────────────────────
//
// Validates the FORM (display) values the user enters, before display→canonical
// conversion. Per-type value ranges, unit validation, recorded_at-not-future,
// notes ≤ 500. `value2` is required (and only allowed) for blood_pressure.

const recordedAtSchema = z
  .string()
  .datetime({ message: 'invalidDate' })
  .refine((iso) => Date.parse(iso) <= Date.now() + RECORDED_AT_FUTURE_SKEW_MS, {
    message: 'recordedAtFuture',
  });

const vitalFormBaseSchema = z.object({
  vital_type: z.enum(['blood_pressure', 'heart_rate', 'glucose', 'weight']),
  value1: z.number().finite(),
  value2: z.number().finite().optional(),
  unit: z.string(),
  recorded_at: recordedAtSchema,
  notes: z.string().max(500, { message: 'notesTooLong' }).optional(),
});

export type VitalFormValues = z.infer<typeof vitalFormBaseSchema>;

/**
 * vitalFormSchema — per-type value ranges + unit validation in DISPLAY units.
 *
 * - blood_pressure: unit must be mmHg; value1 (systolic) + value2 (diastolic)
 *   both required and range-checked.
 * - heart_rate: unit must be bpm; value1 range-checked; value2 disallowed.
 * - glucose: unit ∈ {mg/dL, mmol/L}; value1 range depends on the unit; value2 disallowed.
 * - weight: unit ∈ {lbs, kg}; value1 range depends on the unit; value2 disallowed.
 */
export const vitalFormSchema = vitalFormBaseSchema.superRefine((data, ctx) => {
  const allowed = ALLOWED_INPUT_UNITS[data.vital_type];
  if (!allowed.includes(data.unit)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['unit'],
      message: 'invalidUnit',
    });
    // Range checks below depend on the unit; bail to avoid noisy follow-ups.
    return;
  }

  if (data.vital_type === 'blood_pressure') {
    const sys = VITAL_DISPLAY_RANGES.blood_pressure.systolic;
    const dia = VITAL_DISPLAY_RANGES.blood_pressure.diastolic;
    if (data.value1 < sys.min || data.value1 > sys.max) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['value1'], message: 'valueOutOfRange' });
    }
    if (data.value2 == null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['value2'],
        message: 'diastolicRequired',
      });
    } else if (data.value2 < dia.min || data.value2 > dia.max) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['value2'], message: 'valueOutOfRange' });
    }
    return;
  }

  // Non-BP vitals: value2 is not allowed.
  if (data.value2 != null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['value2'],
      message: 'value2NotAllowed',
    });
  }

  let range: { min: number; max: number };
  if (data.vital_type === 'glucose') {
    range = VITAL_DISPLAY_RANGES.glucose[data.unit as GlucoseUnit];
  } else if (data.vital_type === 'weight') {
    range = VITAL_DISPLAY_RANGES.weight[data.unit as WeightUnit];
  } else {
    range = VITAL_DISPLAY_RANGES.heart_rate;
  }
  if (data.value1 < range.min || data.value1 > range.max) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['value1'], message: 'valueOutOfRange' });
  }
});

// ── Display → canonical request builders ───────────────────────────────────────

/**
 * Build a CreateVitalRequest from validated DISPLAY-unit form values. Converts
 * value1 to canonical for weight/glucose (BP/HR pass through) and reports the
 * CANONICAL unit. value2 (BP diastolic) is always mmHg — no conversion. Mirrors
 * mobile VitalFormScreen.handleSave.
 */
export function buildCreateVitalRequest(values: VitalFormValues): CreateVitalRequest {
  const { vital_type, unit, value1, value2, recorded_at, notes } = values;

  let canonicalValue1 = value1;
  if (vital_type === 'weight') {
    canonicalValue1 = toCanonicalWeight(value1, unit as WeightUnit);
  } else if (vital_type === 'glucose') {
    canonicalValue1 = toCanonicalGlucose(value1, unit as GlucoseUnit);
  }

  return {
    vital_type,
    value1: canonicalValue1,
    value2: vital_type === 'blood_pressure' ? value2 : undefined,
    unit: CANONICAL_UNITS[vital_type],
    recorded_at,
    notes: notes && notes.trim() ? notes.trim() : undefined,
  };
}

/**
 * Build an UpdateVitalRequest from validated DISPLAY-unit form values. The vital
 * type is fixed (you edit one reading), so it is passed in for conversion. Sends
 * the canonical unit; notes are sent as null when cleared. Mirrors mobile's edit
 * branch of VitalFormScreen.handleSave.
 */
export function buildUpdateVitalRequest(
  vitalType: VitalType,
  values: Omit<VitalFormValues, 'vital_type'>
): UpdateVitalRequest {
  const { unit, value1, value2, recorded_at, notes } = values;

  let canonicalValue1 = value1;
  if (vitalType === 'weight') {
    canonicalValue1 = toCanonicalWeight(value1, unit as WeightUnit);
  } else if (vitalType === 'glucose') {
    canonicalValue1 = toCanonicalGlucose(value1, unit as GlucoseUnit);
  }

  return {
    value1: canonicalValue1,
    value2: vitalType === 'blood_pressure' ? value2 : undefined,
    unit: CANONICAL_UNITS[vitalType],
    recorded_at,
    notes: notes && notes.trim() ? notes.trim() : null,
  };
}

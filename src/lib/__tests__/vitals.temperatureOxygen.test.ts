import { describe, expect, it } from 'vitest';
import {
  ALLOWED_INPUT_UNITS,
  CANONICAL_UNITS,
  DEFAULT_UNIT_PREFERENCES,
  VITAL_DISPLAY_RANGES,
  buildCreateVitalRequest,
  buildUpdateVitalRequest,
  formatVitalValue,
  fromCanonicalTemperature,
  fromCanonicalValue,
  getDisplayUnit,
  resolveTemperatureUnit,
  toCanonicalTemperature,
  vitalFormSchema,
  type VitalFormValues,
} from '../vitals';

// Temperature + blood oxygen (1.2.3). Canonical units are °C (U+00B0 + C) and
// %, exactly as weight is kg: the client converts before sending. No clock is
// read except for `recorded_at`, which is a fixed instant well in the past.

const RECORDED_AT = '2026-01-10T10:00:00.000Z';
const DEGREE = '°';

function form(over: Partial<VitalFormValues>): VitalFormValues {
  return {
    vital_type: 'temperature',
    value1: 37,
    unit: '°C',
    recorded_at: RECORDED_AT,
    ...over,
  };
}

function issues(values: VitalFormValues): string[] {
  const result = vitalFormSchema.safeParse(values);
  return result.success ? [] : result.error.issues.map((i) => `${i.path.join('.')}:${i.message}`);
}

describe('temperature conversion (canonical °C)', () => {
  it('°F → °C', () => {
    expect(toCanonicalTemperature(98.6, '°F')).toBeCloseTo(37, 10);
    expect(toCanonicalTemperature(32, '°F')).toBe(0);
    expect(toCanonicalTemperature(212, '°F')).toBe(100);
    expect(toCanonicalTemperature(37.5, '°C')).toBe(37.5);
  });

  it('°C → °F', () => {
    expect(fromCanonicalTemperature(37, '°F')).toBeCloseTo(98.6, 10);
    expect(fromCanonicalTemperature(0, '°F')).toBe(32);
    expect(fromCanonicalTemperature(100, '°F')).toBe(212);
    expect(fromCanonicalTemperature(37.5, '°C')).toBe(37.5);
  });

  it('round-trips a typed °F reading back to the same one-decimal display', () => {
    for (const typed of [95.9, 97.7, 98.6, 99.1, 100.4, 103.2]) {
      const stored = toCanonicalTemperature(typed, '°F');
      expect(Number(fromCanonicalTemperature(stored, '°F').toFixed(1))).toBe(typed);
    }
  });

  it('fromCanonicalValue converts temperature only by the temperature unit', () => {
    expect(fromCanonicalValue('temperature', 37, 'kg', 'mmol/L', '°F')).toBeCloseTo(98.6, 10);
    expect(fromCanonicalValue('temperature', 37, 'lbs', 'mg/dL', '°C')).toBe(37);
    expect(fromCanonicalValue('oxygen_saturation', 96, 'lbs', 'mg/dL', '°F')).toBe(96);
    // The older types are untouched by the new argument.
    expect(fromCanonicalValue('heart_rate', 72, 'lbs', 'mg/dL', '°C')).toBe(72);
    expect(fromCanonicalValue('weight', 68, 'kg', 'mg/dL', '°F')).toBe(68);
  });
});

describe('units', () => {
  it('uses the real degree sign (U+00B0), which is what the server stores', () => {
    expect(CANONICAL_UNITS.temperature).toBe(`${DEGREE}C`);
    expect(ALLOWED_INPUT_UNITS.temperature).toEqual([`${DEGREE}F`, `${DEGREE}C`]);
    expect(CANONICAL_UNITS.oxygen_saturation).toBe('%');
    expect(ALLOWED_INPUT_UNITS.oxygen_saturation).toEqual(['%']);
  });

  it('getDisplayUnit follows the temperature preference; blood oxygen is always %', () => {
    expect(getDisplayUnit('temperature', 'lbs', 'mg/dL', '°F')).toBe('°F');
    expect(getDisplayUnit('temperature', 'lbs', 'mg/dL', '°C')).toBe('°C');
    expect(getDisplayUnit('oxygen_saturation', 'kg', 'mmol/L', '°C')).toBe('%');
  });

  describe('resolveTemperatureUnit', () => {
    it('uses the stored preference when the server sends one', () => {
      expect(resolveTemperatureUnit({ weight_unit: 'kg', temperature_unit: '°F' })).toBe('°F');
      expect(resolveTemperatureUnit({ weight_unit: 'lbs', temperature_unit: '°C' })).toBe('°C');
    });

    it('follows the weight unit when an older server sends none', () => {
      expect(resolveTemperatureUnit({ weight_unit: 'kg' })).toBe('°C');
      expect(resolveTemperatureUnit({ weight_unit: 'lbs' })).toBe('°F');
    });

    it('is °F while preferences have not loaded (matches the lbs fallback)', () => {
      expect(resolveTemperatureUnit(undefined)).toBe('°F');
      expect(resolveTemperatureUnit(null)).toBe('°F');
      expect(DEFAULT_UNIT_PREFERENCES.temperature_unit).toBe('°F');
      expect(DEFAULT_UNIT_PREFERENCES.weight_unit).toBe('lbs');
    });
  });
});

describe('formatVitalValue', () => {
  it('temperature: one decimal, a space before the unit, no trailing ".0"', () => {
    expect(formatVitalValue('temperature', 98.6, null, '°F')).toBe('98.6 °F');
    expect(formatVitalValue('temperature', 98.64, null, '°F')).toBe('98.6 °F');
    expect(formatVitalValue('temperature', 37, null, '°C')).toBe('37 °C');
    expect(formatVitalValue('temperature', 37.25, null, '°C', { unit: false })).toBe('37.3');
  });

  it('blood oxygen: a rounded whole number with the sign against it', () => {
    expect(formatVitalValue('oxygen_saturation', 96, null, '%')).toBe('96%');
    expect(formatVitalValue('oxygen_saturation', 95.6, null, '%')).toBe('96%');
    expect(formatVitalValue('oxygen_saturation', 100, undefined, '%')).toBe('100%');
  });

  it('blood oxygen with { unit: false } is the bare rounded number', () => {
    expect(formatVitalValue('oxygen_saturation', 95.6, null, '%', { unit: false })).toBe('96');
  });
});

describe('vitalFormSchema ranges', () => {
  it('temperature in °F: 86–113 inclusive', () => {
    expect(VITAL_DISPLAY_RANGES.temperature['°F']).toEqual({ min: 86, max: 113 });
    expect(issues(form({ unit: '°F', value1: 86 }))).toEqual([]);
    expect(issues(form({ unit: '°F', value1: 113 }))).toEqual([]);
    expect(issues(form({ unit: '°F', value1: 85.9 }))).toEqual(['value1:valueOutOfRange']);
    expect(issues(form({ unit: '°F', value1: 113.1 }))).toEqual(['value1:valueOutOfRange']);
  });

  it('temperature in °C: 30–45 inclusive', () => {
    expect(VITAL_DISPLAY_RANGES.temperature['°C']).toEqual({ min: 30, max: 45 });
    expect(issues(form({ unit: '°C', value1: 30 }))).toEqual([]);
    expect(issues(form({ unit: '°C', value1: 45 }))).toEqual([]);
    expect(issues(form({ unit: '°C', value1: 29.9 }))).toEqual(['value1:valueOutOfRange']);
    expect(issues(form({ unit: '°C', value1: 45.1 }))).toEqual(['value1:valueOutOfRange']);
    // A °F number typed while the unit is °C is caught, not stored as 98.6 °C.
    expect(issues(form({ unit: '°C', value1: 98.6 }))).toEqual(['value1:valueOutOfRange']);
  });

  it('the °F bounds are the °C bounds converted (what the server checks)', () => {
    expect(toCanonicalTemperature(86, '°F')).toBe(30);
    expect(toCanonicalTemperature(113, '°F')).toBe(45);
  });

  it('blood oxygen: 50–100 inclusive, % only', () => {
    const o2 = (value1: number): VitalFormValues =>
      form({ vital_type: 'oxygen_saturation', unit: '%', value1 });
    expect(VITAL_DISPLAY_RANGES.oxygen_saturation).toEqual({ min: 50, max: 100 });
    expect(issues(o2(50))).toEqual([]);
    expect(issues(o2(100))).toEqual([]);
    expect(issues(o2(49))).toEqual(['value1:valueOutOfRange']);
    expect(issues(o2(101))).toEqual(['value1:valueOutOfRange']);
  });

  it('rejects a unit that does not belong to the type', () => {
    expect(issues(form({ unit: 'kg' }))).toEqual(['unit:invalidUnit']);
    expect(issues(form({ vital_type: 'oxygen_saturation', unit: '°C', value1: 96 }))).toEqual([
      'unit:invalidUnit',
    ]);
  });

  it('neither type takes a second value', () => {
    expect(issues(form({ value2: 1 }))).toEqual(['value2:value2NotAllowed']);
    expect(
      issues(form({ vital_type: 'oxygen_saturation', unit: '%', value1: 96, value2: 1 }))
    ).toEqual(['value2:value2NotAllowed']);
  });
});

describe('request builders', () => {
  it('create: converts °F to °C and reports the canonical unit', () => {
    expect(buildCreateVitalRequest(form({ unit: '°F', value1: 212 }))).toEqual({
      vital_type: 'temperature',
      value1: 100,
      value2: undefined,
      unit: '°C',
      recorded_at: RECORDED_AT,
      notes: undefined,
    });
    expect(buildCreateVitalRequest(form({ unit: '°F', value1: 98.6 })).value1).toBeCloseTo(37, 10);
  });

  it('create: a °C reading passes through unchanged', () => {
    const req = buildCreateVitalRequest(form({ unit: '°C', value1: 37.5, notes: ' after nap ' }));
    expect(req).toEqual({
      vital_type: 'temperature',
      value1: 37.5,
      value2: undefined,
      unit: '°C',
      recorded_at: RECORDED_AT,
      notes: 'after nap',
    });
  });

  it('create: blood oxygen is sent as typed, in %', () => {
    expect(
      buildCreateVitalRequest(form({ vital_type: 'oxygen_saturation', unit: '%', value1: 96 }))
    ).toEqual({
      vital_type: 'oxygen_saturation',
      value1: 96,
      value2: undefined,
      unit: '%',
      recorded_at: RECORDED_AT,
      notes: undefined,
    });
  });

  it('update: converts °F to °C; blood oxygen passes through', () => {
    expect(
      buildUpdateVitalRequest('temperature', { unit: '°F', value1: 212, recorded_at: RECORDED_AT })
    ).toEqual({ value1: 100, value2: undefined, unit: '°C', recorded_at: RECORDED_AT, notes: null });
    expect(
      buildUpdateVitalRequest('oxygen_saturation', {
        unit: '%',
        value1: 94,
        recorded_at: RECORDED_AT,
      })
    ).toEqual({ value1: 94, value2: undefined, unit: '%', recorded_at: RECORDED_AT, notes: null });
  });
});

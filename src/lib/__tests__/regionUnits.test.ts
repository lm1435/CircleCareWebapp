/**
 * Region -> vitals units (1.4.2), web. Named positive (P) and negative (N) cases.
 * Mobile twin: mobile/src/__tests__/utils/regionUnits.test.ts (same table, same cases).
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { countryForTimeZone, resolveRegion } from '../regionResolver';
import {
  getDefaultUnits,
  formatVitalNumber,
  vitalUnitRangeHint,
  VITAL_UNIT_RANGES,
  US_CUSTOMARY_REGIONS,
  MMOL_GLUCOSE_REGIONS,
} from '../vitalUnitsLocale';
import { VITAL_DISPLAY_RANGES, formatVitalValue, vitalFormSchema } from '../vitals';
import { parseVitalNumber } from '../vitalNumber';
import { vitalRangeErrorMessage } from '@/components/vitals/VitalFormModal';
import en from '@/i18n/en/vitals.json';

const US = { weight_unit: 'lbs', glucose_unit: 'mg/dL', temperature_unit: '°F' };
const METRIC_MGDL = { weight_unit: 'kg', glucose_unit: 'mg/dL', temperature_unit: '°C' };
const METRIC_MMOL = { weight_unit: 'kg', glucose_unit: 'mmol/L', temperature_unit: '°C' };

describe('region table', () => {
  it('pins the table (the mobile test pins the same lists)', () => {
    expect([...US_CUSTOMARY_REGIONS].sort()).toEqual(['AS', 'GU', 'LR', 'MM', 'MP', 'PR', 'UM', 'US', 'VI']);
    expect([...MMOL_GLUCOSE_REGIONS].sort()).toEqual(
      ['AU', 'CA', 'CH', 'CN', 'CZ', 'DK', 'EE', 'FI', 'GB', 'HK', 'HR', 'HU', 'IE', 'IS', 'JM', 'KZ', 'LT',
        'LV', 'MT', 'MY', 'NL', 'NO', 'NZ', 'RU', 'SE', 'SG', 'SI', 'SK', 'UA', 'ZA'].sort()
    );
  });

  it('P: DE -> kg / °C / mg/dL; GB -> kg / °C / mmol/L; N: US and unknown -> US', () => {
    expect(getDefaultUnits('DE')).toEqual(METRIC_MGDL);
    expect(getDefaultUnits('GB')).toEqual(METRIC_MMOL);
    expect(getDefaultUnits('US')).toEqual(US);
    expect(getDefaultUnits('PR')).toEqual(US);
    expect(getDefaultUnits(null)).toEqual(US);
    expect(getDefaultUnits('de')).toEqual(US);
  });

  it('the hint ranges equal the form ranges (no drift)', () => {
    expect(VITAL_UNIT_RANGES.glucose).toEqual(VITAL_DISPLAY_RANGES.glucose);
    expect(VITAL_UNIT_RANGES.weight).toEqual(VITAL_DISPLAY_RANGES.weight);
    expect(VITAL_UNIT_RANGES.temperature).toEqual(VITAL_DISPLAY_RANGES.temperature);
  });
});

describe('resolveRegion (shared with the phone picker seed)', () => {
  it('P: en-US browser + Europe/Berlin -> DE units', () => {
    const r = resolveRegion({ languageTag: 'en-US', timeZone: 'Europe/Berlin' });
    expect(r).toBe('DE');
    expect(getDefaultUnits(r)).toEqual(METRIC_MGDL);
  });

  it('P: bare "en" + Europe/London -> GB (mmol/L)', () => {
    const r = resolveRegion({ languageTag: 'en', timeZone: 'Europe/London' });
    expect(r).toBe('GB');
    expect(getDefaultUnits(r)).toEqual(METRIC_MMOL);
  });

  it('P: a non-US tag region wins over the zone (de-AT in Europe/Berlin -> AT)', () => {
    expect(resolveRegion({ languageTag: 'de-AT', timeZone: 'Europe/Berlin' })).toBe('AT');
  });

  it('N: en-US + America/Denver -> US', () => {
    const r = resolveRegion({ languageTag: 'en-US', timeZone: 'America/Denver' });
    expect(r).toBe('US');
    expect(getDefaultUnits(r)).toEqual(US);
  });

  it('N: OS region setting wins when present (regionCode US + Europe/Berlin -> US)', () => {
    expect(resolveRegion({ languageTag: 'en-US', osRegionCode: 'US', timeZone: 'Europe/Berlin' })).toBe('US');
  });

  it('N: unknown zone -> language fallback, else US', () => {
    expect(resolveRegion({ languageTag: 'de', timeZone: 'Asia/Tokyo' })).toBe('DE');
    expect(resolveRegion({ languageTag: 'en', timeZone: 'Etc/UTC' })).toBeNull();
    expect(getDefaultUnits(resolveRegion({ languageTag: 'en', timeZone: 'Etc/UTC' }))).toEqual(US);
    expect(resolveRegion({ languageTag: 'en-US', timeZone: 'Etc/UTC' })).toBe('US');
    expect(resolveRegion({ languageTag: 'es-419', timeZone: null })).toBeNull();
  });

  it('N: a US zone is no evidence: bare "de" in America/Denver -> DE (language), es in Puerto Rico -> none', () => {
    expect(resolveRegion({ languageTag: 'de', timeZone: 'America/Denver' })).toBe('DE');
    expect(resolveRegion({ languageTag: 'es', timeZone: 'America/Puerto_Rico' })).toBeNull();
  });

  it('zone table: US zones are US, prefixes match', () => {
    for (const z of ['America/New_York', 'America/Chicago', 'America/Phoenix', 'America/Los_Angeles',
      'America/Anchorage', 'Pacific/Honolulu', 'America/Indiana/Knox']) {
      expect(countryForTimeZone(z)).toBe('US');
    }
    expect(countryForTimeZone('America/Puerto_Rico')).toBe('PR');
    expect(countryForTimeZone('Australia/Sydney')).toBe('AU');
    expect(countryForTimeZone('America/Argentina/Cordoba')).toBe('AR');
    expect(countryForTimeZone('America/Toronto')).toBe('CA');
    expect(countryForTimeZone('Asia/Tokyo')).toBeNull();
  });

  it('the shared body is byte-identical to mobile/src/utils/regionResolver.ts', () => {
    const body = (file: string) => {
      const src = fs.readFileSync(file, 'utf8');
      const start = src.indexOf('/**\n * The language a bare tag names');
      const webOnly = src.indexOf('// ── Web only');
      return src.slice(start, webOnly === -1 ? undefined : webOnly).trimEnd();
    };
    const web = body(path.join(__dirname, '../regionResolver.ts'));
    const mobile = body(path.join(__dirname, '../../../../mobile/src/utils/regionResolver.ts'));
    expect(web.length).toBeGreaterThan(1000);
    expect(web).toBe(mobile);
  });
});

describe('decimal separator', () => {
  it('P: values display "37,5" in German', () => {
    expect(formatVitalNumber(37.5, 'de')).toBe('37,5');
    expect(formatVitalNumber(37.5, 'fr')).toBe('37,5');
    expect(formatVitalNumber(37.5, 'es')).toBe('37,5');
    expect(formatVitalNumber(37.5, 'pt-PT')).toBe('37,5');
  });

  it('N: English keeps "37.5"; whole numbers drop ".0"; no grouping', () => {
    expect(formatVitalNumber(37.5, 'en')).toBe('37.5');
    expect(formatVitalNumber(165, 'de')).toBe('165');
    expect(formatVitalNumber(1100, 'de')).toBe('1100');
    // formatVitalValue reads the app language (the test runs in English).
    expect(formatVitalValue('temperature', 37.5, null, '°C')).toBe('37.5 °C');
    expect(formatVitalValue('blood_pressure', 120, 80, 'mmHg')).toBe('120/80 mmHg');
  });
});

describe('range error names the unit and points at Settings > Units', () => {
  const t = (key: string, opts?: Record<string, unknown>) => {
    const tmpl = (en.validation as Record<string, string>)[key.replace('validation.', '')] ?? key;
    return tmpl.replace(/\{\{(\w+)\}\}/g, (_, k) => String(opts?.[k]));
  };

  it('P: "37,5" is accepted as °C', () => {
    const value = parseVitalNumber('37,5');
    expect(value).toBe(37.5);
    const parsed = vitalFormSchema.safeParse({
      vital_type: 'temperature',
      value1: value,
      unit: '°C',
      recorded_at: new Date(Date.now() - 60_000).toISOString(),
    });
    expect(parsed.success).toBe(true);
  });

  it('P: 37.5 under °F says it looks like °C and names the unit + Settings > Units', () => {
    const msg = vitalRangeErrorMessage(t, 'temperature', 37.5, '°F');
    expect(msg).toBe(
      '37.5 looks like °C, but your units are °F. You can change them in Settings, under Units.'
    );
  });

  it('P: UK glucose 5.6 under mg/dL points at mmol/L', () => {
    expect(vitalRangeErrorMessage(t, 'glucose', 5.6, 'mg/dL')).toContain('looks like mmol/L');
  });

  it('P: out of range in both units names the range in the current unit', () => {
    expect(vitalRangeErrorMessage(t, 'weight', 2000, 'kg')).toBe(
      'Must be between 0.5 and 500 kg. You can change units in Settings, under Units.'
    );
  });

  it('N: in range, or a fixed-unit type, gives no unit message', () => {
    expect(vitalRangeErrorMessage(t, 'temperature', 37.5, '°C')).toBeNull();
    expect(vitalRangeErrorMessage(t, 'heart_rate', 500, 'bpm')).toBeNull();
    expect(vitalUnitRangeHint('oxygen_saturation', 10, '%')).toBeNull();
  });
});

/**
 * Vitals units by REGION, and vital numbers in the app language's format.
 *
 * Mobile twin: mobile/src/utils/vitalUnitsLocale.ts — the SAME table; each side has a test pinning it.
 * lib/vitals.ts re-exports all of it.
 */
import i18n from '@/i18n';
import type { VitalType } from '@/api/vitals';
import { regionFromLocale } from './regionResolver';

type WeightUnit = 'lbs' | 'kg';
type GlucoseUnit = 'mg/dL' | 'mmol/L';
type TemperatureUnit = '°F' | '°C';

export { regionFromLocale };

// ─── Region -> units ─────────────────────────────────────────────────────────

export interface DefaultUnits {
  weight_unit: WeightUnit;
  glucose_unit: GlucoseUnit;
  temperature_unit: TemperatureUnit;
}

/** What an account starts on (the DB defaults) and what an unknown / missing region keeps. */
export const US_DEFAULT_UNITS: DefaultUnits = { weight_unit: 'lbs', glucose_unit: 'mg/dL', temperature_unit: '°F' };

/**
 * Regions on pounds / °F: the US and its territories (PR, GU, VI, AS, MP, UM), Liberia, Myanmar.
 * Every other region is kg / °C.
 */
export const US_CUSTOMARY_REGIONS: ReadonlySet<string> = new Set(['US', 'PR', 'GU', 'VI', 'AS', 'MP', 'UM', 'LR', 'MM']);

/**
 * Metric regions whose clinics and meters report blood glucose in mmol/L. Everyone else on kg / °C
 * stays on mg/dL (Germany, Austria, France, Belgium, Italy, Spain, Portugal, Brazil, Latin America,
 * India, Japan...). Germany is split (both are printed on lab reports, meters ship in mg/dL in the
 * west); mg/dL is kept there. Switzerland and the Netherlands are mmol/L.
 */
export const MMOL_GLUCOSE_REGIONS: ReadonlySet<string> = new Set([
  'GB', 'IE', 'CA', 'AU', 'NZ', // English-speaking, the clear cases
  'NL', 'CH', 'SE', 'NO', 'DK', 'FI', 'IS', // Netherlands, Switzerland, Nordics
  'CZ', 'SK', 'SI', 'HR', 'HU', 'EE', 'LV', 'LT', 'MT', // central / eastern Europe, Baltics, Malta
  'RU', 'UA', 'KZ', 'CN', 'HK', 'MY', 'SG', 'ZA', 'JM',
]);

export type UnitRegionGroup = 'us_customary' | 'metric_mg_dl' | 'metric_mmol_l' | 'unknown';

export function unitRegionGroup(region: string | null | undefined): UnitRegionGroup {
  const r = (region || '').toUpperCase();
  if (!/^[A-Z]{2}$/.test(r)) return 'unknown';
  if (US_CUSTOMARY_REGIONS.has(r)) return 'us_customary';
  return MMOL_GLUCOSE_REGIONS.has(r) ? 'metric_mmol_l' : 'metric_mg_dl';
}

/**
 * The units a region measures in. Takes an UPPERCASE region code ("DE") or a locale tag ("de-DE"). Unknown or
 * missing region -> the US defaults (what every account already starts on), never a guess.
 */
export function getDefaultUnits(regionOrLocale: string | null | undefined): DefaultUnits {
  const raw = regionOrLocale || '';
  // "DE" is a region; a lowercase "de" is a bare language (no region), as in a locale tag.
  const region = /^[A-Z]{2}$/.test(raw) ? raw : regionFromLocale(raw);
  const group = unitRegionGroup(region);
  if (group === 'unknown' || group === 'us_customary') return { ...US_DEFAULT_UNITS };
  return { weight_unit: 'kg', glucose_unit: group === 'metric_mmol_l' ? 'mmol/L' : 'mg/dL', temperature_unit: '°C' };
}

/** True when the preferences are exactly what a new account starts on (lbs, mg/dL, °F). */
export function isUntouchedDefaultUnits(
  prefs: { weight_unit?: WeightUnit; glucose_unit?: GlucoseUnit; temperature_unit?: TemperatureUnit | null } | null | undefined,
): boolean {
  if (!prefs) return false;
  // Temperature as `resolveTemperatureUnit` reads it: none chosen follows the weight unit (lbs -> °F).
  const temperature = prefs.temperature_unit ?? (prefs.weight_unit === 'kg' ? '°C' : '°F');
  return prefs.weight_unit === 'lbs' && prefs.glucose_unit === 'mg/dL' && temperature === '°F';
}

// ─── Number display ─────────────────────────────────────────────────────────

/**
 * A vital number in the app language's decimal style: "37.5" in English, "37,5" in de/fr/it/pt/es.
 * At most `maxFractionDigits` decimals, trailing zeros dropped (the old `Number(x.toFixed(1))`), and
 * NO grouping (a 1100 lb bound must not read "1.100" in German).
 */
export function formatVitalNumber(value: number, locale?: string, maxFractionDigits = 1): string {
  const l = locale ?? currentFormattingLocale();
  try {
    return new Intl.NumberFormat(l, { maximumFractionDigits: maxFractionDigits, useGrouping: false }).format(value);
  } catch {
    return String(Number(value.toFixed(maxFractionDigits)));
  }
}

function currentFormattingLocale(): string {
  return i18n?.language || 'en';
}

// ─── Range hint (out-of-range message) ──────────────────────────────────────

/** The display range a value must fall in, per vital type and unit. Same numbers as the form. */
export const VITAL_UNIT_RANGES = {
  glucose: { 'mg/dL': { min: 20, max: 600 }, 'mmol/L': { min: 1.1, max: 33.3 } },
  weight: { lbs: { min: 1.2, max: 1100 }, kg: { min: 0.5, max: 500 } },
  temperature: { '°F': { min: 86, max: 113 }, '°C': { min: 30, max: 45 } },
} as const;

export type ConvertibleVitalType = keyof typeof VITAL_UNIT_RANGES;

export function isConvertibleVitalType(type: VitalType): type is ConvertibleVitalType {
  return type === 'glucose' || type === 'weight' || type === 'temperature';
}

/**
 * For an out-of-range weight / glucose / temperature: the range in the CURRENT unit, and the other
 * unit when the value would be valid there ("37.5" under °F is a °C reading). Null for a value in
 * range, or for a type whose unit cannot be changed.
 */
export function vitalUnitRangeHint(
  type: VitalType,
  value: number,
  unit: string,
): { min: number; max: number; unit: string; otherUnit: string | null } | null {
  if (!isConvertibleVitalType(type)) return null;
  const ranges = VITAL_UNIT_RANGES[type] as Record<string, { min: number; max: number }>;
  const range = ranges[unit];
  if (!range || !Number.isFinite(value)) return null;
  if (value >= range.min && value <= range.max) return null;
  const otherUnit = Object.keys(ranges).find((u) => u !== unit) ?? null;
  const other = otherUnit ? ranges[otherUnit] : null;
  const fitsOther = !!other && value >= other.min && value <= other.max;
  return { min: range.min, max: range.max, unit, otherUnit: fitsOther ? otherUnit : null };
}


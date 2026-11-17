/**
 * The one-time "Use kg and °C?" prompt, web rule (lib/vitalUnitsPrompt). Named P / N cases; mobile
 * twin: mobile/src/__tests__/services/vitalUnitsPrompt.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/api', () => ({ apiClient: { get: vi.fn(), put: vi.fn() } }));
const track = vi.hoisted(() => vi.fn());
vi.mock('@/lib/analytics', () => ({ Analytics: { vitalUnitsPrompt: track, vitalUnitsAutoSet: vi.fn() } }));

import {
  forgetVitalUnitsPrompt,
  markVitalUnitsPromptShown,
  recordVitalUnitsPromptOutcome,
  vitalUnitsPromptKey,
  vitalUnitsPromptOffer,
} from '../vitalUnitsPrompt';
import { regionUnitsDecidedKey } from '../regionUnitsAutoSet';

const US_PREFS = { weight_unit: 'lbs', glucose_unit: 'mg/dL', temperature_unit: '°F' } as const;

function memoryStorage(seed: Record<string, string> = { [regionUnitsDecidedKey('u1')]: 'has_logged_vitals' }) {
  const map = new Map<string, string>(Object.entries(seed));
  return {
    map,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  };
}

const offer = (over: Record<string, unknown> = {}) =>
  vitalUnitsPromptOffer({ userId: 'u1', region: 'DE', prefs: { ...US_PREFS }, storage: memoryStorage(), ...over });

beforeEach(() => track.mockReset());

describe('vitalUnitsPrompt (web) — POSITIVE', () => {
  it('P1 offers the region units to an account the auto-set skipped for logged vitals', () => {
    expect(offer()).toEqual({
      target: { weight_unit: 'kg', glucose_unit: 'mg/dL', temperature_unit: '°C' },
      group: 'metric_mg_dl',
    });
    expect(offer({ region: 'GB' })?.target.glucose_unit).toBe('mmol/L');
  });

  it('P2 shown is remembered FIRST and counted; the outcome replaces it and is counted', () => {
    const storage = memoryStorage();
    markVitalUnitsPromptShown('u1', 'metric_mg_dl', storage);
    expect(storage.map.get(vitalUnitsPromptKey('u1'))).toBe('shown');
    expect(vitalUnitsPromptOffer({ userId: 'u1', region: 'DE', prefs: { ...US_PREFS }, storage })).toBeNull();
    recordVitalUnitsPromptOutcome('u1', 'metric_mg_dl', 'kept', storage);
    expect(storage.map.get(vitalUnitsPromptKey('u1'))).toBe('kept');
    expect(track.mock.calls).toEqual([
      [{ outcome: 'shown', region_group: 'metric_mg_dl', surface: 'vitals' }],
      [{ outcome: 'kept', region_group: 'metric_mg_dl', surface: 'vitals' }],
    ]);
  });

  it('P3 a failed switch forgets the question so the next visit asks again', () => {
    const storage = memoryStorage();
    markVitalUnitsPromptShown('u1', 'metric_mg_dl', storage);
    forgetVitalUnitsPrompt('u1', storage);
    expect(vitalUnitsPromptOffer({ userId: 'u1', region: 'DE', prefs: { ...US_PREFS }, storage })).not.toBeNull();
  });
});

describe('vitalUnitsPrompt (web) — NEGATIVE', () => {
  it('N1 applied / units_already_set / undecided accounts are never asked', () => {
    for (const seed of [
      { [regionUnitsDecidedKey('u1')]: 'applied' },
      { [regionUnitsDecidedKey('u1')]: 'units_already_set' },
      {},
    ]) {
      expect(offer({ storage: memoryStorage(seed) })).toBeNull();
    }
  });

  it('N2 US / unknown regions, and units the person already chose, are left alone', () => {
    for (const region of ['US', 'PR', null, '419']) expect(offer({ region })).toBeNull();
    expect(offer({ prefs: { weight_unit: 'kg', glucose_unit: 'mg/dL', temperature_unit: '°C' } })).toBeNull();
    expect(offer({ prefs: { weight_unit: 'lbs', glucose_unit: 'mmol/L', temperature_unit: '°F' } })).toBeNull();
  });

  it('N3 once per ACCOUNT: another user in the same browser has their own flag; no user / prefs / storage: nothing', () => {
    const storage = memoryStorage({
      [regionUnitsDecidedKey('u1')]: 'has_logged_vitals',
      [regionUnitsDecidedKey('u2')]: 'has_logged_vitals',
    });
    recordVitalUnitsPromptOutcome('u1', 'metric_mg_dl', 'dismissed', storage);
    expect(vitalUnitsPromptOffer({ userId: 'u1', region: 'DE', prefs: { ...US_PREFS }, storage })).toBeNull();
    expect(vitalUnitsPromptOffer({ userId: 'u2', region: 'DE', prefs: { ...US_PREFS }, storage })).not.toBeNull();
    expect(offer({ userId: null })).toBeNull();
    expect(offer({ prefs: undefined })).toBeNull();
    expect(offer({ storage: null })).toBeNull();
  });

  it('N4 the offer itself records nothing and counts nothing', () => {
    const storage = memoryStorage();
    vitalUnitsPromptOffer({ userId: 'u1', region: 'DE', prefs: { ...US_PREFS }, storage });
    expect(storage.map.has(vitalUnitsPromptKey('u1'))).toBe(false);
    expect(track).not.toHaveBeenCalled();
  });
});

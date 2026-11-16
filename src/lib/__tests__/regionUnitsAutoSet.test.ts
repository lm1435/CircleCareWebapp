/**
 * Once-per-account region units, web (lib/regionUnitsAutoSet). Named P / N cases; mobile twin:
 * mobile/src/__tests__/services/regionUnitsAutoSet.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  get: vi.fn(),
  put: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  delete: vi.fn(),
}));
vi.mock('@/lib/api', () => ({ apiClient: api }));
const track = vi.hoisted(() => vi.fn());
vi.mock('@/lib/analytics', () => ({ Analytics: { vitalUnitsAutoSet: track } }));

import {
  hasLoggedAnyVital,
  regionUnitsDecidedKey,
  resetRegionUnitsAutoSetForTests,
  runRegionUnitsAutoSet,
} from '../regionUnitsAutoSet';

const US_PREFS = { weight_unit: 'lbs', glucose_unit: 'mg/dL', temperature_unit: '°F' } as const;

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    map,
    getItem: vi.fn((k: string) => map.get(k) ?? null),
    setItem: vi.fn((k: string, v: string) => {
      map.set(k, v);
    }),
  };
}

function deps(over: Record<string, unknown> = {}) {
  let prefs: any = { ...US_PREFS };
  return {
    userId: 'user-1' as string | null,
    region: 'DE' as string | null,
    storage: memoryStorage(),
    getPrefs: vi.fn(async () => prefs),
    hasLoggedVitals: vi.fn(async () => false),
    updatePrefs: vi.fn(async (u: any) => {
      prefs = { ...u };
      return prefs;
    }),
    setPrefs: (p: any) => {
      prefs = p;
    },
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  resetRegionUnitsAutoSetForTests();
});

describe('runRegionUnitsAutoSet (web)', () => {
  it('P: de-DE new account with no vitals gets kg / °C / mg/dL', async () => {
    const d = deps({ region: 'DE' });
    await expect(runRegionUnitsAutoSet(d)).resolves.toBe('applied');
    expect(d.updatePrefs).toHaveBeenCalledWith({ weight_unit: 'kg', glucose_unit: 'mg/dL', temperature_unit: '°C' });
    expect(track).toHaveBeenCalledWith({
      applied: true,
      region_group: 'metric_mg_dl',
      skip_reason: null,
      weight_unit: 'kg',
      glucose_unit: 'mg/dL',
      temperature_unit: '°C',
    });
    expect(d.storage.map.get(regionUnitsDecidedKey('user-1'))).toBe('applied');
  });

  it('P: en-GB new account gets kg / °C / mmol/L', async () => {
    const d = deps({ region: 'GB' });
    await expect(runRegionUnitsAutoSet(d)).resolves.toBe('applied');
    expect(d.updatePrefs).toHaveBeenCalledWith({ weight_unit: 'kg', glucose_unit: 'mmol/L', temperature_unit: '°C' });
  });

  it('N: en-US stays lbs / °F / mg/dL, reads nothing, records nothing', async () => {
    const d = deps({ region: 'US' });
    await expect(runRegionUnitsAutoSet(d)).resolves.toBe('not_metric_region');
    expect(d.getPrefs).not.toHaveBeenCalled();
    expect(d.updatePrefs).not.toHaveBeenCalled();
    expect(d.storage.setItem).not.toHaveBeenCalled();
    expect(track).not.toHaveBeenCalled();
  });

  it('N: unknown / missing region stays on the US defaults', async () => {
    for (const region of [null, '', '419']) {
      const d = deps({ region });
      await expect(runRegionUnitsAutoSet(d)).resolves.toBe('not_metric_region');
      expect(d.updatePrefs).not.toHaveBeenCalled();
    }
  });

  it('N: an account with any logged vital is not changed', async () => {
    const d = deps({ hasLoggedVitals: vi.fn(async () => true) });
    await expect(runRegionUnitsAutoSet(d)).resolves.toBe('has_logged_vitals');
    expect(d.updatePrefs).not.toHaveBeenCalled();
    expect(track).toHaveBeenCalledWith(expect.objectContaining({ applied: false, skip_reason: 'has_logged_vitals' }));
  });

  it('N: a user who picks lbs after the auto-set is not overridden on the next session', async () => {
    const d = deps();
    await expect(runRegionUnitsAutoSet(d)).resolves.toBe('applied');
    d.setPrefs({ ...US_PREFS });
    d.getPrefs.mockClear();
    d.updatePrefs.mockClear();
    await expect(runRegionUnitsAutoSet(d)).resolves.toBe('already_decided');
    expect(d.updatePrefs).not.toHaveBeenCalled();
  });

  it('N: units already chosen are left alone', async () => {
    const d = deps();
    d.setPrefs({ weight_unit: 'kg', glucose_unit: 'mg/dL', temperature_unit: '°C' });
    await expect(runRegionUnitsAutoSet(d)).resolves.toBe('units_already_set');
    expect(d.updatePrefs).not.toHaveBeenCalled();
  });

  it('N: a failed read records nothing (retried next session)', async () => {
    const d = deps({ getPrefs: vi.fn().mockRejectedValueOnce(new Error('offline')) });
    await expect(runRegionUnitsAutoSet(d)).resolves.toBe('failed');
    expect(d.storage.setItem).not.toHaveBeenCalled();
  });
});

describe('hasLoggedAnyVital (web)', () => {
  const empty = { blood_pressure: null, heart_rate: null, glucose: null, weight: null, temperature: null, oxygen_saturation: null };

  it('N: readings only by other members do not count', async () => {
    api.get.mockImplementation(async (url: string) => {
      if (url === '/circles') return { data: { circles: [{ id: 'c1' }] } };
      if (url.includes('/latest')) return { data: { latest: { ...empty, weight: { recorded_by: 'other' } } } };
      return { data: { vitals: [{ recorded_by: 'other' }] } };
    });
    await expect(hasLoggedAnyVital('me')).resolves.toBe(false);
  });

  it('P: an older reading by this user behind another member\'s latest counts', async () => {
    api.get.mockImplementation(async (url: string) => {
      if (url === '/circles') return { data: { circles: [{ id: 'c1' }] } };
      if (url.includes('/latest')) return { data: { latest: { ...empty, weight: { recorded_by: 'other' } } } };
      return { data: { vitals: [{ recorded_by: 'me' }] } };
    });
    await expect(hasLoggedAnyVital('me')).resolves.toBe(true);
  });
});

describe('real wiring: never rewrites a stored vital, only the caller\'s own unit row', () => {
  it('N: the only write is PUT /users/me/unit-preferences with units only', async () => {
    api.get.mockImplementation(async (url: string) => {
      if (url === '/users/me/unit-preferences') return { data: { ...US_PREFS } };
      if (url === '/circles') return { data: { circles: [{ id: 'c1' }] } };
      return { data: { latest: { weight: null } } };
    });
    api.put.mockResolvedValue({ data: { weight_unit: 'kg', glucose_unit: 'mmol/L', temperature_unit: '°C' } });
    await expect(
      runRegionUnitsAutoSet({ userId: 'me', region: 'GB', storage: memoryStorage() })
    ).resolves.toBe('applied');
    expect(api.put).toHaveBeenCalledTimes(1);
    expect(api.put).toHaveBeenCalledWith('/users/me/unit-preferences', {
      weight_unit: 'kg',
      glucose_unit: 'mmol/L',
      temperature_unit: '°C',
    });
    expect(api.post).not.toHaveBeenCalled();
    expect(api.patch).not.toHaveBeenCalled();
    expect(api.delete).not.toHaveBeenCalled();
  });
});

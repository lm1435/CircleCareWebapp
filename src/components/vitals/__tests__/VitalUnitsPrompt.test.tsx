/**
 * The Vitals page's one-time "Use kg and °C?" dialog (components/vitals/VitalUnitsPrompt).
 * P = positive, N = negative. Rule: src/lib/__tests__/vitalUnitsPrompt.test.ts.
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  prefs: { weight_unit: 'lbs', glucose_unit: 'mg/dL', temperature_unit: '°F' } as any,
  region: 'GB' as string | null,
  put: vi.fn(),
  track: vi.fn(),
  toast: vi.fn(),
}));
vi.mock('react-i18next', async (orig) => ({
  ...(await orig<typeof import('react-i18next')>()),
  useTranslation: () => ({ t: (k: string, o?: any) => (o ? `${k}${JSON.stringify(o)}` : k) }),
}));
vi.mock('@/hooks/useUnitPreferences', () => ({ useUnitPreferences: () => ({ data: h.prefs }) }));
vi.mock('@/lib/regionResolver', () => ({ browserRegion: () => h.region }));
vi.mock('@/api/users', () => ({ updateUnitPreferences: (...a: unknown[]) => h.put(...a) }));
vi.mock('@/lib/analytics', () => ({ Analytics: { vitalUnitsPrompt: h.track, vitalUnitsAutoSet: vi.fn() } }));
vi.mock('@/store/authStore', () => ({
  useAuthStore: (sel: any) => sel({ isAuthenticated: true, user: { id: 'u1' } }),
}));
vi.mock('@/components/ui', async (orig) => ({
  ...(await orig<typeof import('@/components/ui')>()),
  useToast: () => ({ showToast: h.toast }),
}));

import { VitalUnitsPrompt, VITAL_UNITS_PROMPT_DELAY_MS } from '../VitalUnitsPrompt';
import { regionUnitsDecidedKey } from '@/lib/regionUnitsAutoSet';
import { vitalUnitsPromptKey } from '@/lib/vitalUnitsPrompt';
import { queryKeys } from '@/lib/queryKeys';
import { queryClient } from '@/lib/queryClient';

function mount(busy = false) {
  return render(<VitalUnitsPrompt busy={busy} />);
}
async function settle() {
  await act(async () => {
    vi.advanceTimersByTime(VITAL_UNITS_PROMPT_DELAY_MS);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  localStorage.setItem(regionUnitsDecidedKey('u1'), 'has_logged_vitals');
  h.prefs = { weight_unit: 'lbs', glucose_unit: 'mg/dL', temperature_unit: '°F' };
  h.region = 'GB';
  h.put.mockReset();
  h.track.mockReset();
  h.toast.mockReset();
});
afterEach(() => vi.useRealTimers());

it('P1 asks after the page settles; Switch PUTs the region units and updates the cache', async () => {
  const updated = { weight_unit: 'kg', glucose_unit: 'mmol/L', temperature_unit: '°C' };
  h.put.mockResolvedValue(updated);
  mount();
  expect(screen.queryByRole('dialog')).toBeNull();
  await settle();
  expect(screen.getByText('unitsPrompt.title{"weight":"kg","temperature":"°C","glucose":"mmol/L"}')).toBeTruthy();
  expect(screen.getByText(/^unitsPrompt\.messageGlucose/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'unitsPrompt.switch' }));
  await act(async () => {
    await Promise.resolve();
  });
  expect(h.put).toHaveBeenCalledWith({ weight_unit: 'kg', glucose_unit: 'mmol/L', temperature_unit: '°C' });
  expect(queryClient.getQueryData(queryKeys.unitPreferences)).toEqual(updated);
  expect(h.track.mock.calls.map((c) => c[0].outcome)).toEqual(['shown', 'switched']);
  expect(localStorage.getItem(vitalUnitsPromptKey('u1'))).toBe('switched');
});

it('P2 the Keep button is kept; closing (the ×) is dismissed; neither PUTs', async () => {
  mount();
  await settle();
  fireEvent.click(screen.getByRole('button', { name: 'unitsPrompt.keep{"weight":"lbs","temperature":"°F"}' }));
  expect(h.track).toHaveBeenLastCalledWith({ outcome: 'kept', region_group: 'metric_mmol_l', surface: 'vitals' });

  localStorage.removeItem(vitalUnitsPromptKey('u1'));
  h.track.mockReset();
  const view = mount();
  await settle();
  fireEvent.click(screen.getByRole('button', { name: 'common:close' }));
  expect(h.track).toHaveBeenLastCalledWith(expect.objectContaining({ outcome: 'dismissed' }));
  expect(h.put).not.toHaveBeenCalled();
  view.unmount();
});

it('P3 a failed switch toasts and forgets the question (asked again next visit, not this one)', async () => {
  h.put.mockRejectedValue(new Error('500'));
  mount();
  await settle();
  fireEvent.click(screen.getByRole('button', { name: 'unitsPrompt.switch' }));
  await act(async () => {
    await Promise.resolve();
  });
  expect(h.toast).toHaveBeenCalledWith('common:errors.saveFailed', 'error');
  expect(localStorage.getItem(vitalUnitsPromptKey('u1'))).toBeNull();
  await settle();
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('N1 never over the page’s own dialog, nor over any other open dialog; nothing recorded', async () => {
  mount(true);
  await settle();
  expect(screen.queryByText(/unitsPrompt\.title/)).toBeNull();
  const other = document.createElement('div');
  other.setAttribute('role', 'dialog');
  document.body.appendChild(other);
  mount(false);
  await settle();
  expect(screen.queryByText(/unitsPrompt\.title/)).toBeNull();
  other.remove();
  expect(h.track).not.toHaveBeenCalled();
  expect(localStorage.getItem(vitalUnitsPromptKey('u1'))).toBeNull();
});

it('N2 a US browser, or an account already asked, is never asked', async () => {
  h.region = 'US';
  mount();
  await settle();
  expect(screen.queryByText(/unitsPrompt\.title/)).toBeNull();
  h.region = 'DE';
  localStorage.setItem(vitalUnitsPromptKey('u1'), 'kept');
  mount();
  await settle();
  expect(screen.queryByText(/unitsPrompt\.title/)).toBeNull();
  expect(h.track).not.toHaveBeenCalled();
});

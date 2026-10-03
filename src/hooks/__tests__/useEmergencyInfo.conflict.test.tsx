import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

vi.mock('@/api/emergencyInfo', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/emergencyInfo')>();
  return { ...actual, updateEmergencyInfo: vi.fn(), getEmergencyInfo: vi.fn() };
});
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
const showToast = vi.fn();
vi.mock('@/components/ui', () => ({ useToast: () => ({ showToast }) }));
vi.mock('@/hooks/usePremiumGate', () => ({ usePremiumGate: () => ({ promptUpgrade: vi.fn() }) }));
const conflict = vi.fn();
const updated = vi.fn();
vi.mock('@/lib/analytics', () => ({
  Analytics: {
    emergencyInfoUpdated: (...a: unknown[]) => updated(...a),
    emergencyInfoConflict: (...a: unknown[]) => conflict(...a),
    errorOccurred: vi.fn(),
  },
}));

import * as api from '@/api/emergencyInfo';
import { queryKeys } from '@/lib/queryKeys';
import { relocateIndex, useUpdateEmergencyInfo, withIfMatch } from '@/hooks/useEmergencyInfo';

describe('withIfMatch', () => {
  const info = { versions: { allergies: 'a', blood_type: 'b', has_dnr: 'd' } };
  it('names exactly the written fields that have a version', () => {
    expect(withIfMatch(info, { allergies: [], blood_type: null })).toEqual({
      allergies: [],
      blood_type: null,
      if_match: { allergies: 'a', blood_type: 'b' },
    });
  });
  it('is a no-op without versions', () => {
    const body = { allergies: ['x'] };
    expect(withIfMatch({}, body)).toBe(body);
    expect(withIfMatch(null, body)).toBe(body);
  });
});

describe('relocateIndex', () => {
  const same = (a: string, b: string) => a === b;
  it('prefers the same index, else finds it, else -1', () => {
    expect(relocateIndex(['a', 'b'], 'b', 1, same)).toBe(1);
    expect(relocateIndex(['x', 'a', 'b'], 'b', 1, same)).toBe(2);
    expect(relocateIndex(['x'], 'b', 0, same)).toBe(-1);
    expect(relocateIndex(null, 'b', 0, same)).toBe(-1);
  });
});

describe('useUpdateEmergencyInfo 409', () => {
  it('toasts the conflict copy, reloads, tracks, and never the generic failure', async () => {
    vi.clearAllMocks();
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const refetch = vi.spyOn(queryClient, 'refetchQueries');
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    vi.mocked(api.getEmergencyInfo).mockResolvedValue(null);
    vi.mocked(api.updateEmergencyInfo).mockRejectedValue({
      success: false,
      error: { code: 'EMERGENCY_INFO_CHANGED', details: { fields: ['allergies', 'blood_type'] } },
    });
    const { result } = renderHook(() => useUpdateEmergencyInfo('c'), { wrapper });
    await act(async () => {
      result.current.mutate({ allergies: [], if_match: { allergies: 'x' } });
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(showToast).toHaveBeenCalledTimes(1);
    expect(showToast.mock.calls[0][0]).toBe('conflict.title. conflict.message');
    expect(conflict).toHaveBeenCalledWith(2);
    expect(refetch).toHaveBeenCalledWith({ queryKey: queryKeys.emergencyInfo('c') });
    expect(showToast).not.toHaveBeenCalledWith('errors.saveFailed', 'error');
  });
  it('analytics field list never includes if_match', async () => {
    vi.clearAllMocks();
    const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    vi.mocked(api.updateEmergencyInfo).mockResolvedValue({} as never);
    const { result } = renderHook(() => useUpdateEmergencyInfo('c'), { wrapper });
    await act(async () => {
      result.current.mutate({ allergies: [], if_match: { allergies: 'x' } });
    });
    await waitFor(() => expect(updated).toHaveBeenCalledWith('c', ['allergies']));
  });
});

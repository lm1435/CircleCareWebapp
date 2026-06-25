import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

// Mock the api module's WRITE functions only (keep types intact).
vi.mock('@/api/users', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/users')>();
  return {
    ...actual,
    updateProfile: vi.fn(),
    updateNotificationPrefs: vi.fn(),
    updateQuietHours: vi.fn(),
    updateUnitPreferences: vi.fn(),
    updateEmailDigest: vi.fn(),
    deleteAccount: vi.fn(),
  };
});

// Deterministic translations so error toasts assert on a stable key string.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const showToast = vi.fn();
vi.mock('@/components/ui', () => ({
  useToast: () => ({ showToast }),
}));

const promptUpgrade = vi.fn();
vi.mock('@/hooks/usePremiumGate', () => ({
  usePremiumGate: () => ({ promptUpgrade }),
}));

// Mock the CONFIGURED i18n instance so we can assert changeLanguage is called
// without driving the real i18next runtime. `language` starts at 'en'.
// `vi.hoisted` so the spy exists before the hoisted vi.mock factory runs.
const { changeLanguage } = vi.hoisted(() => ({ changeLanguage: vi.fn() }));
vi.mock('@/i18n', () => ({
  default: {
    get language() {
      return 'en';
    },
    changeLanguage,
  },
}));

import {
  updateProfile,
  updateNotificationPrefs,
  updateQuietHours,
  updateUnitPreferences,
  updateEmailDigest,
  deleteAccount,
} from '@/api/users';
import { queryKeys } from '@/lib/queryKeys';
import {
  useUpdateProfile,
  useUpdateNotificationPrefs,
  useUpdateQuietHours,
  useUpdateUnitPrefs,
  useUpdateEmailDigest,
  useDeleteAccount,
} from '@/hooks/useProfile';

const mockUpdateProfile = vi.mocked(updateProfile);
const mockUpdateNotif = vi.mocked(updateNotificationPrefs);
const mockUpdateQuiet = vi.mocked(updateQuietHours);
const mockUpdateUnits = vi.mocked(updateUnitPreferences);
const mockUpdateDigest = vi.mocked(updateEmailDigest);
const mockDeleteAccount = vi.mocked(deleteAccount);

const USER = { id: 'u1', email: 'a@b.co' } as never;

function setup() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
  const setDataSpy = vi.spyOn(queryClient, 'setQueryData');
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, invalidateSpy, setDataSpy, wrapper };
}

type InvalidateArg = Parameters<QueryClient['invalidateQueries']>[0];

function invalidatedWith(
  invalidateSpy: { mock: { calls: [InvalidateArg?, ...unknown[]][] } },
  key: readonly unknown[]
) {
  return invalidateSpy.mock.calls.some(
    (call) => JSON.stringify(call[0]?.queryKey) === JSON.stringify(key)
  );
}

const SUBSCRIPTION_ENVELOPE = {
  success: false,
  error: { code: 'SUBSCRIPTION_REQUIRED', message: 'upgrade' },
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useUpdateProfile', () => {
  it('PATCHes the profile and invalidates currentUser on success', async () => {
    const { invalidateSpy, wrapper } = setup();
    mockUpdateProfile.mockResolvedValue(USER);

    const { result } = renderHook(() => useUpdateProfile(), { wrapper });
    result.current.mutate({ first_name: 'Sam' });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockUpdateProfile).toHaveBeenCalledWith({ first_name: 'Sam' });
    expect(invalidatedWith(invalidateSpy, queryKeys.currentUser)).toBe(true);
    // No language change → i18n untouched.
    expect(changeLanguage).not.toHaveBeenCalled();
  });

  it('calls i18n.changeLanguage when language changes to a new value', async () => {
    const { wrapper } = setup();
    mockUpdateProfile.mockResolvedValue(USER);

    const { result } = renderHook(() => useUpdateProfile(), { wrapper });
    result.current.mutate({ language: 'es' });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(changeLanguage).toHaveBeenCalledWith('es');
  });

  it('does NOT call changeLanguage when language equals the current locale', async () => {
    const { wrapper } = setup();
    mockUpdateProfile.mockResolvedValue(USER);

    const { result } = renderHook(() => useUpdateProfile(), { wrapper });
    result.current.mutate({ language: 'en' }); // current mocked locale is 'en'

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(changeLanguage).not.toHaveBeenCalled();
  });

  it('surfaces a save-failed toast on error', async () => {
    const { wrapper } = setup();
    mockUpdateProfile.mockRejectedValue(new Error('boom'));

    const { result } = renderHook(() => useUpdateProfile(), { wrapper });
    result.current.mutate({ first_name: 'X' });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(showToast).toHaveBeenCalledWith('errors.saveFailed', 'error');
  });
});

describe('useUpdateNotificationPrefs', () => {
  it('PATCHes flags and invalidates currentUser', async () => {
    const { invalidateSpy, wrapper } = setup();
    mockUpdateNotif.mockResolvedValue(USER);

    const { result } = renderHook(() => useUpdateNotificationPrefs(), { wrapper });
    result.current.mutate({ missed_medications: false });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockUpdateNotif).toHaveBeenCalledWith({ missed_medications: false });
    expect(invalidatedWith(invalidateSpy, queryKeys.currentUser)).toBe(true);
  });
});

describe('useUpdateQuietHours', () => {
  it('PATCHes quiet hours and invalidates currentUser', async () => {
    const { invalidateSpy, wrapper } = setup();
    mockUpdateQuiet.mockResolvedValue(USER);

    const { result } = renderHook(() => useUpdateQuietHours(), { wrapper });
    result.current.mutate({ quiet_hours_start: '22:00', quiet_hours_end: '07:00' });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockUpdateQuiet).toHaveBeenCalledWith({
      quiet_hours_start: '22:00',
      quiet_hours_end: '07:00',
    });
    expect(invalidatedWith(invalidateSpy, queryKeys.currentUser)).toBe(true);
  });
});

describe('useUpdateUnitPrefs', () => {
  it('PUTs units, seeds + invalidates the shared unitPreferences key', async () => {
    const { invalidateSpy, setDataSpy, wrapper } = setup();
    const prefs = { weight_unit: 'kg', glucose_unit: 'mmol/L' } as const;
    mockUpdateUnits.mockResolvedValue(prefs);

    const { result } = renderHook(() => useUpdateUnitPrefs(), { wrapper });
    result.current.mutate({ weight_unit: 'kg' });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockUpdateUnits).toHaveBeenCalledWith({ weight_unit: 'kg' });
    expect(setDataSpy).toHaveBeenCalledWith(queryKeys.unitPreferences, prefs);
    expect(invalidatedWith(invalidateSpy, queryKeys.unitPreferences)).toBe(true);
  });
});

describe('useUpdateEmailDigest', () => {
  it('PATCHes the digest and invalidates currentUser on success', async () => {
    const { invalidateSpy, wrapper } = setup();
    mockUpdateDigest.mockResolvedValue(USER);

    const { result } = renderHook(() => useUpdateEmailDigest(), { wrapper });
    result.current.mutate({ enabled: true, day: 1 });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockUpdateDigest).toHaveBeenCalledWith({ enabled: true, day: 1 });
    expect(invalidatedWith(invalidateSpy, queryKeys.currentUser)).toBe(true);
  });

  it('surfaces "open the app to upgrade" on a 402 enable (free tier)', async () => {
    const { wrapper } = setup();
    mockUpdateDigest.mockRejectedValue(SUBSCRIPTION_ENVELOPE);

    const { result } = renderHook(() => useUpdateEmailDigest(), { wrapper });
    result.current.mutate({ enabled: true });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(promptUpgrade).toHaveBeenCalled();
    expect(showToast).not.toHaveBeenCalledWith('errors.saveFailed', 'error');
  });
});

describe('useDeleteAccount', () => {
  it('DELETEs the account (caller handles cache-clear + signOut)', async () => {
    const { wrapper } = setup();
    mockDeleteAccount.mockResolvedValue(undefined);

    const { result } = renderHook(() => useDeleteAccount(), { wrapper });
    result.current.mutate();

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockDeleteAccount).toHaveBeenCalledTimes(1);
  });

  it('surfaces a save-failed toast on error', async () => {
    const { wrapper } = setup();
    mockDeleteAccount.mockRejectedValue(new Error('boom'));

    const { result } = renderHook(() => useDeleteAccount(), { wrapper });
    result.current.mutate();

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(showToast).toHaveBeenCalledWith('errors.saveFailed', 'error');
  });
});

import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

vi.mock('@/api/users', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/users')>();
  return { ...actual, updateProfile: vi.fn() };
});
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
const showToast = vi.fn();
vi.mock('@/components/ui', () => ({ useToast: () => ({ showToast }) }));
vi.mock('@/hooks/usePremiumGate', () => ({ usePremiumGate: () => ({ promptUpgrade: vi.fn() }) }));
vi.mock('@/i18n', () => ({ default: { language: 'en', changeLanguage: vi.fn() } }));
const avatarColorChanged = vi.fn();
vi.mock('@/lib/analytics', () => ({
  Analytics: { avatarColorChanged: (...a: unknown[]) => avatarColorChanged(...a), errorOccurred: vi.fn() },
}));

import { updateProfile, type User } from '@/api/users';
import { queryKeys } from '@/lib/queryKeys';
import { useUpdateAvatarColor } from '@/hooks/useProfile';

const mockUpdate = vi.mocked(updateProfile);

function setup() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  queryClient.setQueryData(queryKeys.currentUser, { id: 'u1', avatar_color: 'moss' } as User);
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, invalidate, ...renderHook(() => useUpdateAvatarColor(), { wrapper }) };
}

const colorOf = (qc: QueryClient) =>
  (qc.getQueryData(queryKeys.currentUser) as User | undefined)?.avatar_color;

beforeEach(() => vi.clearAllMocks());

describe('useUpdateAvatarColor', () => {
  it('paints the new colour before the request resolves, then reports and refreshes', async () => {
    let resolve!: (u: User) => void;
    mockUpdate.mockReturnValue(new Promise<User>((r) => (resolve = r)));
    const { queryClient, invalidate, result } = setup();
    act(() => {
      result.current.mutate('coral');
    });
    await waitFor(() => expect(colorOf(queryClient)).toBe('coral'));
    expect(mockUpdate).toHaveBeenCalledWith({ avatar_color: 'coral' });
    await act(async () => {
      resolve({ id: 'u1', avatar_color: 'coral' } as User);
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(colorOf(queryClient)).toBe('coral');
    expect(avatarColorChanged).toHaveBeenCalledWith('coral');
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.currentUser });
    // Other members see it through the circle detail's members embed.
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.circles });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['circle'] });
    expect(showToast).not.toHaveBeenCalled();
  });

  it('rolls back to the previous colour and toasts when the save fails', async () => {
    mockUpdate.mockRejectedValue(new Error('boom'));
    const { queryClient, result } = setup();
    await act(async () => {
      result.current.mutate('coral');
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(colorOf(queryClient)).toBe('moss');
    expect(showToast).toHaveBeenCalledWith('avatarColor.saveFailed', 'error');
    expect(avatarColorChanged).not.toHaveBeenCalled();
  });
});

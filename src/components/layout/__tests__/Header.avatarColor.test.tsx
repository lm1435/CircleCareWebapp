import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import '@/i18n';
import { Header } from '@/components/layout/Header';
import { useAuthStore } from '@/store/authStore';
import { avatarGradientFor, avatarGradientForKey } from '@/components/ui/Avatar';
import { queryKeys } from '@/lib/queryKeys';

vi.mock('@/hooks/useCircles', () => ({
  useCircles: () => ({ data: [], isLoading: false, isError: false, refetch: vi.fn() }),
}));
vi.mock('@/api/users', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/users')>()),
  getCurrentUser: vi.fn(() => new Promise(() => {})),
}));

const initialAuthState = useAuthStore.getState();

function renderHeader(client?: QueryClient): void {
  const tree = (
    <MemoryRouter initialEntries={['/circles/c1']}>
      <Routes>
        <Route path="/circles/:circleId" element={<Header />} />
      </Routes>
    </MemoryRouter>
  );
  render(client ? <QueryClientProvider client={client}>{tree}</QueryClientProvider> : tree);
}

const gradient = (pair: readonly [string, string]): string =>
  `linear-gradient(135deg, ${pair[0]}, ${pair[1]})`;

describe('Header account avatar colour', () => {
  beforeEach(() => {
    useAuthStore.setState({
      user: { id: 'u1', email: 'fay@example.com', first_name: 'Fay', last_name: 'Lee' },
      isAuthenticated: true,
    });
  });
  afterEach(() => useAuthStore.setState(initialAuthState, true));

  const avatar = () =>
    screen.getByRole('button', { name: 'Account' }).querySelector<HTMLElement>('span[aria-hidden="true"]')!;

  it('paints the avatar with the colour saved on the account (shared currentUser cache)', () => {
    const client = new QueryClient();
    client.setQueryData(queryKeys.currentUser, { id: 'u1', avatar_color: 'dusk' });
    renderHeader(client);
    expect(avatar().style.backgroundImage).toBe(gradient(avatarGradientForKey('dusk')));
  });

  it('keeps the name-derived gradient when the account has no colour', () => {
    const client = new QueryClient();
    client.setQueryData(queryKeys.currentUser, { id: 'u1', avatar_color: null });
    renderHeader(client);
    expect(avatar().style.backgroundImage).toBe(gradient(avatarGradientFor('Fay Lee')));
  });

  it('still renders where there is no QueryClientProvider (name-derived gradient)', () => {
    renderHeader();
    expect(avatar().style.backgroundImage).toBe(gradient(avatarGradientFor('Fay Lee')));
  });
});

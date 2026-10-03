import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { useState } from 'react';
import '@/i18n';
import { AppLayout } from '@/components/layout/AppLayout';
import { ToastProvider } from '@/components/ui/Toast';
import { useAuthStore } from '@/store/authStore';

// P-H2 follow-up (user rule 2026-09-29 "forms should reset and move to the new
// circle"): the layout-level "+ New" AddEventModal belongs to the circle it was
// opened in. AppLayout is NOT keyed by circle (only the page <Outlet> is, by
// pathname), so browser back/forward into another circle while the modal was
// open used to keep the typed input and re-point its save at the NEW circle.
// Mobile twin: mobile/src/navigation/useCloseOnCircleSwitch.ts.

vi.mock('@/hooks/useCircles', () => ({
  useCircles: vi.fn(() => ({
    data: [
      { id: 'c1', name: 'Circle A', recipient_name: 'Rosa' },
      { id: 'c2', name: 'Circle B', recipient_name: 'Ana' },
    ],
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  })),
}));
vi.mock('@/hooks/useCircle', () => ({
  useCircle: vi.fn((id: string) => ({
    circle: { id, owner_id: 'u1', is_self_care: false },
    canEdit: true,
  })),
}));
vi.mock('@/components/NeedsCircleSelectionBanner', () => ({
  NeedsCircleSelectionBanner: () => null,
}));
vi.mock('@/components/ai/AIChatModal', () => ({ AIChatModal: () => null }));

// Stand-in with LOCAL input state (what the real form loses when it unmounts)
// and the circle its save would target.
vi.mock('@/components/calendar/AddEventModal', () => ({
  AddEventModal: ({ circleId, initialType }: { circleId: string; initialType: string }) => {
    const [text, setText] = useState('');
    return (
      <div data-testid="add-event-modal" data-circle={circleId} data-initial-type={initialType}>
        <input aria-label="title" value={text} onChange={(e) => setText(e.target.value)} />
      </div>
    );
  },
}));

const initialAuthState = useAuthStore.getState();

function renderAt(entries: string[], index: number) {
  const router = createMemoryRouter(
    [
      {
        path: '/circles/:circleId',
        element: <AppLayout />,
        children: [
          { path: 'calendar', element: <div>Calendar page stub</div> },
          { path: 'notes', element: <div>Notes page stub</div> },
        ],
      },
    ],
    { initialEntries: entries, initialIndex: index },
  );
  render(
    <ToastProvider>
      <RouterProvider router={router} />
    </ToastProvider>,
  );
  return router;
}

async function openNewAppointment(user: ReturnType<typeof userEvent.setup>) {
  const aside = document.querySelector('aside') as HTMLElement;
  await user.click(within(aside).getByRole('button', { name: 'New' }));
  await user.click(screen.getByRole('menuitem', { name: 'Appt' }));
}

beforeEach(() => {
  useAuthStore.setState({
    user: { id: 'u1', email: 'pat@example.com', first_name: 'Pat', last_name: 'Lee' },
    isAuthenticated: true,
  });
});
afterEach(() => {
  useAuthStore.setState(initialAuthState, true);
  document.documentElement.style.removeProperty('--nav-h');
});

describe('AppLayout "+ New" modal across a circle change', () => {
  it('history back into another circle closes it; forward again does not reopen it', async () => {
    const user = userEvent.setup();
    // History: B's calendar, then A's calendar (current).
    const router = renderAt(['/circles/c2/calendar', '/circles/c1/calendar'], 1);

    await openNewAppointment(user);
    await user.type(screen.getByLabelText('title'), 'A appointment');
    expect(screen.getByTestId('add-event-modal')).toHaveAttribute('data-circle', 'c1');

    await act(async () => {
      await router.navigate(-1);
    });
    expect(router.state.location.pathname).toBe('/circles/c2/calendar');
    expect(screen.queryByTestId('add-event-modal')).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue('A appointment')).not.toBeInTheDocument();

    await act(async () => {
      await router.navigate(1);
    });
    expect(router.state.location.pathname).toBe('/circles/c1/calendar');
    expect(screen.queryByTestId('add-event-modal')).not.toBeInTheDocument();
  });

  it.each(['sidebar', 'nav'] as const)('the type menu (%s trigger) closes too', async (trigger) => {
    const user = userEvent.setup();
    const router = renderAt(['/circles/c2/calendar', '/circles/c1/calendar'], 1);
    const scope =
      trigger === 'sidebar'
        ? (document.querySelector('aside') as HTMLElement)
        : screen.getByTestId('floating-nav');
    await user.click(within(scope).getByRole('button', { name: 'New' }));
    expect(screen.getByRole('menu')).toBeInTheDocument();

    await act(async () => {
      await router.navigate(-1);
    });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('a page change inside the SAME circle keeps the modal and its input', async () => {
    const user = userEvent.setup();
    const router = renderAt(['/circles/c1/notes', '/circles/c1/calendar'], 1);

    await openNewAppointment(user);
    await user.type(screen.getByLabelText('title'), 'A appointment');

    await act(async () => {
      await router.navigate(-1);
    });
    expect(router.state.location.pathname).toBe('/circles/c1/notes');
    expect(screen.getByTestId('add-event-modal')).toHaveAttribute('data-circle', 'c1');
    expect(screen.getByDisplayValue('A appointment')).toBeInTheDocument();
  });
});

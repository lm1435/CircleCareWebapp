import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import '@/i18n';
import { AppLayout } from '@/components/layout/AppLayout';
import { resetAppDownloadBannerDismissal } from '@/components/layout/AppDownloadBanner';
import { useAuthStore } from '@/store/authStore';

vi.mock('@/hooks/useCircles', () => ({
  useCircles: vi.fn(() => ({
    data: [{ id: 'c1', name: "Mom's Care", recipient_name: 'Rosa' }],
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  })),
}));

vi.mock('@/components/meds/TodaysMeds', () => ({
  TodaysMeds: () => <div data-testid="todays-meds" />,
}));

// useCircle is React Query-backed; this layout test has no QueryClientProvider,
// so stub it with the gating fields the global Create menu reads.
vi.mock('@/hooks/useCircle', () => ({
  useCircle: vi.fn(() => ({
    circle: { id: 'c1', owner_id: 'u1', is_self_care: false },
    canEdit: true,
  })),
}));

// Query-backed banner mounted in <main> (plan Task 39b) — mocked like
// TodaysMeds above; its behavior is covered by NeedsCircleSelectionBanner.test.tsx.
vi.mock('@/components/NeedsCircleSelectionBanner', () => ({
  NeedsCircleSelectionBanner: () => null,
}));

// AppLayout mounts the AI assistant modal (uses React Query); stub it so the
// layout test stays focused on chrome/drawer behavior.
vi.mock('@/components/ai/AIChatModal', () => ({
  AIChatModal: () => null,
}));

const initialAuthState = useAuthStore.getState();

function renderLayout(): void {
  render(
    <MemoryRouter initialEntries={['/circles/c1/calendar']}>
      <Routes>
        <Route path="/circles/:circleId" element={<AppLayout />}>
          <Route path="calendar" element={<div>Calendar page stub</div>} />
          <Route path="activity" element={<div>Activity page stub</div>} />
        </Route>
      </Routes>
    </MemoryRouter>
  );
}

describe('AppLayout', () => {
  beforeEach(() => {
    resetAppDownloadBannerDismissal();
    useAuthStore.setState({
      user: { id: 'u1', email: 'pat@example.com', first_name: 'Pat', last_name: 'Lee' },
      isAuthenticated: true,
    });
  });

  afterEach(() => {
    useAuthStore.setState(initialAuthState, true);
    document.body.style.overflow = '';
  });

  it('renders a skip link as the first link, targeting the main landmark', () => {
    renderLayout();

    const firstLink = document.body.querySelector('a');
    expect(firstLink).toHaveTextContent('Skip to content');
    expect(firstLink).toHaveAttribute('href', '#main');
    expect(screen.getByRole('main')).toHaveAttribute('id', 'main');
  });

  it('renders semantic landmarks: banner, navigation, main, and page content', () => {
    renderLayout();

    expect(screen.getByRole('banner')).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Main navigation' })).toBeInTheDocument();
    expect(within(screen.getByRole('main')).getByText('Calendar page stub')).toBeInTheDocument();
  });

  it('opens the drawer from the hamburger, locks scroll, and focuses inside it', async () => {
    const user = userEvent.setup();
    renderLayout();

    const trigger = screen.getByRole('button', { name: 'Navigation menu' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await user.click(trigger);

    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    const dialog = screen.getByRole('dialog', { name: 'Main navigation' });
    expect(dialog).toBeInTheDocument();
    expect(document.body.style.overflow).toBe('hidden');

    // Focus moves into the drawer onto its first focusable. (That's now the brand
    // link, not the close button — assert focus is inside the drawer so the test
    // stays robust to the drawer header's chrome.)
    expect(within(dialog).getByRole('button', { name: 'Close navigation menu' })).toBeInTheDocument();
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it('closes the drawer on Escape, restores scroll, and returns focus to the trigger', async () => {
    const user = userEvent.setup();
    renderLayout();

    const trigger = screen.getByRole('button', { name: 'Navigation menu' });
    await user.click(trigger);
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(document.body.style.overflow).toBe('');
    expect(trigger).toHaveFocus();
  });

  it('traps Tab focus within the open drawer (wraps both directions)', async () => {
    const user = userEvent.setup();
    renderLayout();

    await user.click(screen.getByRole('button', { name: 'Navigation menu' }));
    const dialog = screen.getByRole('dialog');
    const focusables = Array.from(dialog.querySelectorAll<HTMLElement>('a[href], button'));
    const first = focusables[0]!;
    const last = focusables[focusables.length - 1]!;

    last.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(first).toHaveFocus();

    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(last).toHaveFocus();
  });

  it('closes the drawer when a nav link is activated', async () => {
    const user = userEvent.setup();
    renderLayout();

    await user.click(screen.getByRole('button', { name: 'Navigation menu' }));
    const dialog = screen.getByRole('dialog');

    await user.click(within(dialog).getByRole('link', { name: 'Activity' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(within(screen.getByRole('main')).getByText('Activity page stub')).toBeInTheDocument();
  });
});

import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import '@/i18n';
import { AppLayout } from '@/components/layout/AppLayout';
// AppLayout now raises the premium gate itself for a frozen circle's owner
// (the AI entry), and `usePremiumGate` -> `useToast` requires the provider that
// App.tsx already wraps the whole authenticated tree in.
import { ToastProvider } from '@/components/ui/Toast';
import { useAuthStore } from '@/store/authStore';
import { useCircle } from '@/hooks/useCircle';

// AppLayout's create wiring: picking an AddMenu option mounts the right modal
// (or navigates), from BOTH triggers — the sidebar's New button at xl and the
// FloatingNavBar's NEW cell below it. Both feed one `openCreate`, so both are
// exercised here rather than trusted to share.
//
// Document upload and Invite member are NOT create-menu options any more
// (spec §5.2): upload is covered by DocumentsPage's own tests and invite by
// MembersPage's.
//
// Options are addressed by their VISIBLE short label ("Med", "Appt", "Task",
// "Note"), which is also their accessible name: a full-word `aria-label` over a
// short visible label fails WCAG 2.5.3 ("Appt" is not contained in
// "Appointment"). The full word rides along as `title`.

// StoreReviewBanner owns its own tests; here it would need a QueryClient.
vi.mock('@/components/StoreReviewBanner', () => ({
  StoreReviewBanner: () => null,
}));

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

vi.mock('@/hooks/useCircle', () => ({
  useCircle: vi.fn(() => ({
    circle: { id: 'c1', owner_id: 'u1', is_self_care: false },
    canEdit: true,
  })),
}));

vi.mock('@/components/NeedsCircleSelectionBanner', () => ({
  NeedsCircleSelectionBanner: () => null,
}));

vi.mock('@/components/ai/AIChatModal', () => ({
  AIChatModal: () => null,
}));

// The one create modal the layout still mounts. It echoes `initialType` so we
// assert *which* flow opened, and exposes a close button wired to onClose so we
// can assert unmount-on-close.
vi.mock('@/components/calendar/AddEventModal', () => ({
  AddEventModal: ({ initialType, onClose }: { initialType: string; onClose: () => void }) => (
    <div data-testid="add-event-modal" data-initial-type={initialType}>
      <button type="button" onClick={onClose}>
        close-event
      </button>
    </div>
  ),
}));

// Care shifts: the composer and teaser echo which flow opened.
vi.mock('@/components/shifts/ShiftComposer', () => ({
  ShiftComposer: ({ source, onClose }: { source: string; onClose: () => void }) => (
    <div data-testid="shift-composer" data-source={source}>
      <button type="button" onClick={onClose}>
        close-shift
      </button>
    </div>
  ),
}));
vi.mock('@/components/shifts/ShiftsTeaserDialog', () => ({
  ShiftsTeaserDialog: ({ source }: { source: string }) => (
    <div data-testid="shifts-teaser" data-source={source} />
  ),
}));

const initialAuthState = useAuthStore.getState();

function renderLayout(): void {
  render(
    <MemoryRouter initialEntries={['/circles/c1/calendar']}>
      <ToastProvider>
        <Routes>
          <Route path="/circles/:circleId" element={<AppLayout />}>
            <Route path="calendar" element={<div>Calendar page stub</div>} />
            <Route path="notes" element={<div data-testid="notes-page-stub">Notes page stub</div>} />
          </Route>
        </Routes>
      </ToastProvider>
    </MemoryRouter>
  );
}

type Trigger = 'sidebar' | 'nav';

/** The two "New" controls share a name, so each is found inside its own chrome. */
function newButton(trigger: Trigger): HTMLElement {
  const scope =
    trigger === 'sidebar'
      ? (document.querySelector('aside') as HTMLElement)
      : screen.getByTestId('floating-nav');
  return within(scope).getByRole('button', { name: 'New' });
}

async function pick(
  user: ReturnType<typeof userEvent.setup>,
  trigger: Trigger,
  option: string
): Promise<void> {
  await user.click(newButton(trigger));
  await user.click(screen.getByRole('menuitem', { name: option }));
}

describe.each<Trigger>(['sidebar', 'nav'])('AppLayout AddMenu wiring (%s trigger)', (trigger) => {
  beforeEach(() => {
    useAuthStore.setState({
      user: { id: 'u1', email: 'pat@example.com', first_name: 'Pat', last_name: 'Lee' },
      isAuthenticated: true,
    });
  });

  afterEach(() => {
    useAuthStore.setState(initialAuthState, true);
    document.documentElement.style.removeProperty('--nav-h');
    vi.mocked(useCircle).mockReturnValue({
      circle: { id: 'c1', owner_id: 'u1', is_self_care: false },
      canEdit: true,
    } as unknown as ReturnType<typeof useCircle>);
  });

  it('mounts AddEventModal with initialType="appointment" for Appt', async () => {
    const user = userEvent.setup();
    renderLayout();

    await pick(user, trigger, 'Appt');

    expect(screen.getByTestId('add-event-modal')).toHaveAttribute(
      'data-initial-type',
      'appointment'
    );
  });

  it('mounts AddEventModal with initialType="medication" for Med', async () => {
    const user = userEvent.setup();
    renderLayout();

    await pick(user, trigger, 'Med');

    expect(screen.getByTestId('add-event-modal')).toHaveAttribute(
      'data-initial-type',
      'medication'
    );
  });

  it('mounts AddEventModal with initialType="task" for Task', async () => {
    const user = userEvent.setup();
    renderLayout();

    await pick(user, trigger, 'Task');

    expect(screen.getByTestId('add-event-modal')).toHaveAttribute('data-initial-type', 'task');
  });

  it('navigates to the Notes page (no modal) for Note', async () => {
    const user = userEvent.setup();
    renderLayout();

    await pick(user, trigger, 'Note');

    // Notes have no create modal — the composer lives on the Notes page.
    expect(screen.queryByTestId('add-event-modal')).not.toBeInTheDocument();
    expect(await screen.findByTestId('notes-page-stub')).toBeInTheDocument();
  });

  it('closes the menu once an option is picked', async () => {
    const user = userEvent.setup();
    renderLayout();

    await pick(user, trigger, 'Task');

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('unmounts the modal when its onClose fires (createKind resets to null)', async () => {
    const user = userEvent.setup();
    renderLayout();

    await pick(user, trigger, 'Appt');
    expect(screen.getByTestId('add-event-modal')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'close-event' }));

    expect(screen.queryByTestId('add-event-modal')).not.toBeInTheDocument();
  });

  it('offers no Document or Invite member option', async () => {
    const user = userEvent.setup();
    renderLayout();

    await user.click(newButton(trigger));

    expect(screen.queryByRole('menuitem', { name: 'Document' })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Invite member' })).not.toBeInTheDocument();
    // Four classic options + Shift (this mock's circle is free and owned by the
    // viewer, so Shift is offered and opens the teaser).
    expect(screen.getAllByRole('menuitem')).toHaveLength(5);
  });
});

describe('AppLayout AddMenu gating', () => {
  beforeEach(() => {
    useAuthStore.setState({
      user: { id: 'u1', email: 'pat@example.com', first_name: 'Pat', last_name: 'Lee' },
      isAuthenticated: true,
    });
  });

  afterEach(() => {
    useAuthStore.setState(initialAuthState, true);
    document.documentElement.style.removeProperty('--nav-h');
    vi.mocked(useCircle).mockReturnValue({
      circle: { id: 'c1', owner_id: 'u1', is_self_care: false },
      canEdit: true,
    } as unknown as ReturnType<typeof useCircle>);
  });

  it('disables the nav NEW cell and opens no menu for a read-only viewer', async () => {
    vi.mocked(useCircle).mockReturnValue({
      circle: { id: 'c1', owner_id: 'someone-else', is_self_care: false },
      canEdit: false,
    } as unknown as ReturnType<typeof useCircle>);
    const user = userEvent.setup();
    renderLayout();

    // Mobile always shows NEW — it goes inert rather than vanishing.
    const cell = newButton('nav');
    expect(cell).toBeDisabled();
    expect(cell).toHaveAttribute('aria-disabled', 'true');
    expect(cell).toHaveClass('opacity-50');

    await user.click(cell);

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  // The OTHER trigger. Both New buttons are fed `canEdit` separately by the
  // layout, so gating one proves nothing about the other: hand the sidebar
  // `canCreate={true}` and a read-only viewer at xl gets a live create menu.
  it('disables the sidebar New button and opens no menu for a read-only viewer', async () => {
    vi.mocked(useCircle).mockReturnValue({
      circle: { id: 'c1', owner_id: 'someone-else', is_self_care: false },
      canEdit: false,
    } as unknown as ReturnType<typeof useCircle>);
    const user = userEvent.setup();
    renderLayout();

    // `newButton` throws if the sidebar or its New button is missing, so the
    // absence assertions below cannot pass against a layout that rendered none.
    const button = newButton('sidebar');
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-disabled', 'true');

    await user.click(button);

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(screen.queryAllByRole('menuitem')).toHaveLength(0);
  });
});

describe('AppLayout AddMenu: Shift (care shifts)', () => {
  beforeEach(() => {
    useAuthStore.setState({
      user: { id: 'u1', email: 'pat@example.com', first_name: 'Pat', last_name: 'Lee' },
      isAuthenticated: true,
    });
  });
  afterEach(() => {
    useAuthStore.setState(initialAuthState, true);
    vi.mocked(useCircle).mockReturnValue({
      circle: { id: 'c1', owner_id: 'u1', is_self_care: false },
      canEdit: true,
    } as unknown as ReturnType<typeof useCircle>);
  });

  function mockCircle(over: Record<string, unknown>): void {
    vi.mocked(useCircle).mockReturnValue({
      circle: { id: 'c1', owner_id: 'u1', is_self_care: false },
      canEdit: true,
      ...over,
    } as unknown as ReturnType<typeof useCircle>);
  }

  it('premium circle: Shift opens the composer from the add menu', async () => {
    mockCircle({ isPremiumCircle: true });
    const user = userEvent.setup();
    renderLayout();
    await pick(user, 'nav', 'Shift');
    expect(screen.getByTestId('shift-composer')).toHaveAttribute('data-source', 'add_menu');
    expect(screen.queryByTestId('add-event-modal')).not.toBeInTheDocument();
  });

  it('free OWNER: Shift opens the teaser, never the form', async () => {
    mockCircle({ isPremiumCircle: false });
    const user = userEvent.setup();
    renderLayout();
    await pick(user, 'sidebar', 'Shift');
    expect(screen.getByTestId('shifts-teaser')).toHaveAttribute('data-source', 'add_menu');
    expect(screen.queryByTestId('shift-composer')).not.toBeInTheDocument();
  });

  it('free manager / member: no Shift option at all', async () => {
    mockCircle({
      circle: { id: 'c1', owner_id: 'someone-else', is_self_care: false },
      isPremiumCircle: false,
    });
    const user = userEvent.setup();
    renderLayout();
    await user.click(newButton('nav'));
    expect(screen.queryByRole('menuitem', { name: 'Shift' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('menuitem')).toHaveLength(4);
  });

  it.each([['owner', 'u1'], ['manager / member', 'someone-else']])(
    'lapsed Premium (free circle that still has shifts): the %s gets no Shift option',
    async (_who, ownerId) => {
      mockCircle({
        circle: { id: 'c1', owner_id: ownerId, is_self_care: false },
        isPremiumCircle: false,
        hasShifts: true,
      });
      const user = userEvent.setup();
      renderLayout();
      await user.click(newButton('nav'));
      expect(screen.queryByRole('menuitem', { name: 'Shift' })).not.toBeInTheDocument();
      expect(screen.getAllByRole('menuitem')).toHaveLength(4);
    }
  );

  it('a view-only seat never gets Shift, even in a premium circle', async () => {
    mockCircle({
      circle: { id: 'c1', owner_id: 'someone-else', is_self_care: false },
      isPremiumCircle: false,
      viewOnly: true,
      canEdit: true,
    });
    const user = userEvent.setup();
    renderLayout();
    await user.click(newButton('nav'));
    expect(screen.queryByRole('menuitem', { name: 'Shift' })).not.toBeInTheDocument();
  });
});

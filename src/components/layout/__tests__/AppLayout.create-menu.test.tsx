import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import '@/i18n';
import { AppLayout } from '@/components/layout/AppLayout';
import { resetAppDownloadBannerDismissal } from '@/components/layout/AppDownloadBanner';
import { useAuthStore } from '@/store/authStore';
import { useCircle } from '@/hooks/useCircle';

// This suite verifies AppLayout's global Create menu wiring: selecting an option
// mounts the matching modal with the right props, and closing it unmounts the
// modal. CreateMenu itself is covered by CreateMenu.test.tsx — here we mock the
// four modals so we assert *which* modal AppLayout mounts, not the modals' guts.

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
// so stub it with the gating fields the global Create menu reads. The default
// (owner + canEdit) shows all six options; individual tests override it.
vi.mock('@/hooks/useCircle', () => ({
  useCircle: vi.fn(() => ({
    circle: { id: 'c1', owner_id: 'u1', is_self_care: false },
    canEdit: true,
  })),
}));

// CreateDocumentModal reads storage from useDocuments; stub it so the document
// modal mounts without a network call.
vi.mock('@/hooks/useDocuments', () => ({
  useDocuments: vi.fn(() => ({
    storage: { used: 0, limit: 209715200 },
    isLoading: false,
  })),
}));

vi.mock('@/components/NeedsCircleSelectionBanner', () => ({
  NeedsCircleSelectionBanner: () => null,
}));

vi.mock('@/components/ai/AIChatModal', () => ({
  AIChatModal: () => null,
}));

// Modal stubs: each renders an identifiable testid and echoes its key props, and
// exposes a close button wired to onClose so we can assert unmount-on-close.
vi.mock('@/components/calendar/AddEventModal', () => ({
  AddEventModal: ({ initialType, onClose }: { initialType: string; onClose: () => void }) => (
    <div data-testid="add-event-modal" data-initial-type={initialType}>
      <button type="button" onClick={onClose}>
        close-event
      </button>
    </div>
  ),
}));

vi.mock('@/components/vitals/AddVitalModal', () => ({
  AddVitalModal: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="add-vital-modal">
      <button type="button" onClick={onClose}>
        close-vital
      </button>
    </div>
  ),
}));

vi.mock('@/components/members/InviteMemberModal', () => ({
  InviteMemberModal: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="invite-member-modal">
      <button type="button" onClick={onClose}>
        close-invite
      </button>
    </div>
  ),
}));

vi.mock('@/components/documents/DocumentUploadModal', () => ({
  DocumentUploadModal: ({
    storage,
    onClose,
  }: {
    storage: { limit: number };
    onClose: () => void;
  }) => (
    <div data-testid="document-upload-modal" data-storage-limit={storage.limit}>
      <button type="button" onClick={onClose}>
        close-document
      </button>
    </div>
  ),
}));

const initialAuthState = useAuthStore.getState();

function renderLayout(): void {
  render(
    <MemoryRouter initialEntries={['/circles/c1/calendar']}>
      <Routes>
        <Route path="/circles/:circleId" element={<AppLayout />}>
          <Route path="calendar" element={<div>Calendar page stub</div>} />
        </Route>
      </Routes>
    </MemoryRouter>
  );
}

/** Open the Create menu and pick an option by its accessible name. */
async function pickCreateOption(user: ReturnType<typeof userEvent.setup>, name: string): Promise<void> {
  await user.click(screen.getByRole('button', { name: 'Create' }));
  await user.click(screen.getByRole('menuitem', { name }));
}

describe('AppLayout global Create menu wiring', () => {
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
    vi.mocked(useCircle).mockReturnValue({
      circle: { id: 'c1', owner_id: 'u1', is_self_care: false },
      canEdit: true,
    } as unknown as ReturnType<typeof useCircle>);
  });

  it('mounts AddEventModal with initialType="appointment" when Appointment is picked', async () => {
    const user = userEvent.setup();
    renderLayout();

    await pickCreateOption(user, 'Appointment');

    const modal = screen.getByTestId('add-event-modal');
    expect(modal).toBeInTheDocument();
    expect(modal).toHaveAttribute('data-initial-type', 'appointment');
  });

  it('mounts AddEventModal with initialType="medication" when Medication is picked', async () => {
    const user = userEvent.setup();
    renderLayout();

    await pickCreateOption(user, 'Medication');

    expect(screen.getByTestId('add-event-modal')).toHaveAttribute('data-initial-type', 'medication');
  });

  it('mounts AddEventModal with initialType="task" when Task is picked', async () => {
    const user = userEvent.setup();
    renderLayout();

    await pickCreateOption(user, 'Task');

    expect(screen.getByTestId('add-event-modal')).toHaveAttribute('data-initial-type', 'task');
  });

  it('mounts AddVitalModal when Vitals is picked', async () => {
    const user = userEvent.setup();
    renderLayout();

    await pickCreateOption(user, 'Vitals');

    expect(screen.getByTestId('add-vital-modal')).toBeInTheDocument();
    expect(screen.queryByTestId('add-event-modal')).not.toBeInTheDocument();
  });

  it('mounts DocumentUploadModal with storage when Document is picked', async () => {
    const user = userEvent.setup();
    renderLayout();

    await pickCreateOption(user, 'Document');

    const modal = screen.getByTestId('document-upload-modal');
    expect(modal).toBeInTheDocument();
    expect(modal).toHaveAttribute('data-storage-limit', '209715200');
  });

  it('mounts InviteMemberModal when Invite member is picked', async () => {
    const user = userEvent.setup();
    renderLayout();

    await pickCreateOption(user, 'Invite member');

    expect(screen.getByTestId('invite-member-modal')).toBeInTheDocument();
  });

  it('unmounts the modal when its onClose fires (createKind resets to null)', async () => {
    const user = userEvent.setup();
    renderLayout();

    await pickCreateOption(user, 'Appointment');
    expect(screen.getByTestId('add-event-modal')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'close-event' }));

    expect(screen.queryByTestId('add-event-modal')).not.toBeInTheDocument();
  });

  it('does not render the Create button when the viewer cannot edit and is not the owner', () => {
    vi.mocked(useCircle).mockReturnValue({
      circle: { id: 'c1', owner_id: 'someone-else', is_self_care: false },
      canEdit: false,
    } as unknown as ReturnType<typeof useCircle>);

    renderLayout();

    expect(screen.queryByRole('button', { name: 'Create' })).not.toBeInTheDocument();
  });
});

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import '@/i18n';
import EditCirclePage from '../EditCirclePage';
import type { CircleDetail } from '@/api/circleMembers';

// Plan Stage 8, Task 8.5 — EditCirclePage slice. Mocks useCircle, the admin
// mutations, and the auth store so the test focuses on page behavior:
//   - owner gating (non-owner sees read-only notice, no form)
//   - conditions comma-split → string[] on save
//   - delete confirm (type-to-confirm) → useDeleteCircle + navigate

const navigate = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => navigate };
});

const mockUseCircle = vi.fn();
vi.mock('@/hooks/useCircle', () => ({
  useCircle: (circleId: string) => mockUseCircle(circleId),
}));

const updateMutate = vi.fn();
const deleteMutate = vi.fn();
vi.mock('@/hooks/useCircleAdmin', () => ({
  useUpdateCircle: () => ({ mutate: updateMutate, isPending: false }),
  useDeleteCircle: () => ({ mutate: deleteMutate, isPending: false }),
}));

const showToast = vi.fn();
vi.mock('@/components/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/ui')>();
  return { ...actual, useToast: () => ({ showToast }) };
});

vi.mock('@/store/authStore', () => ({
  useAuthStore: (selector: (s: { user: { id: string } | null }) => unknown) =>
    selector({ user: { id: 'owner-1' } }),
}));

const CIRCLE_ID = 'circle-1';

function makeCircle(overrides: Partial<CircleDetail> = {}): CircleDetail {
  return {
    id: CIRCLE_ID,
    name: 'Rose',
    recipient_name: 'Rose Meza',
    recipient_photo_url: null,
    recipient_dob: '1948-05-02',
    recipient_conditions: ['Diabetes'],
    owner_id: 'owner-1',
    created_at: '2026-01-01T00:00:00Z',
    is_self_care: false,
    care_recipient_timezone: 'America/New_York',
    members: [],
    access_level: 'full',
    is_premium_circle: true,
    can_edit: true,
    view_only: false,
    ...overrides,
  };
}

function mockCircleResult(circle: CircleDetail | undefined, extra: Record<string, unknown> = {}) {
  mockUseCircle.mockReturnValue({
    circle,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
    ...extra,
  });
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={[`/circles/${CIRCLE_ID}/edit`]}>
      <Routes>
        <Route path="/circles/:circleId/edit" element={<EditCirclePage />} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('EditCirclePage', () => {
  it('shows the owner-only notice and hides the form for non-owners', () => {
    mockCircleResult(makeCircle({ owner_id: 'someone-else' }));
    renderPage();

    expect(
      screen.getByText('Only the circle owner can edit this')
    ).toBeInTheDocument();
    expect(screen.queryByLabelText('Care recipient name')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete circle' })).not.toBeInTheDocument();
  });

  it('renders the form for the owner and saves conditions as a string array', async () => {
    const user = userEvent.setup();
    mockCircleResult(makeCircle());
    renderPage();

    const conditions = screen.getByLabelText('Health conditions');
    await user.clear(conditions);
    await user.type(conditions, 'Diabetes, Hypertension ,');

    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(updateMutate).toHaveBeenCalled());
    const payload = updateMutate.mock.calls[0][0];
    expect(payload.recipient_name).toBe('Rose Meza');
    expect(payload.recipient_dob).toBe('1948-05-02');
    expect(payload.recipient_conditions).toEqual(['Diabetes', 'Hypertension']);
  });

  it('requires type-to-confirm before deleting, then deletes and navigates', async () => {
    const user = userEvent.setup();
    mockCircleResult(makeCircle());
    renderPage();

    await user.click(screen.getByRole('button', { name: 'Delete circle' }));

    // Confirm button is disabled until the keyword is typed.
    const confirmButton = screen.getAllByRole('button', { name: 'Delete circle' })[1];
    expect(confirmButton).toBeDisabled();

    await user.type(screen.getByLabelText('Type DELETE to confirm'), 'delete');
    expect(confirmButton).toBeEnabled();

    await user.click(confirmButton);

    await waitFor(() => expect(deleteMutate).toHaveBeenCalled());
    // Trigger the success callback passed to mutate to assert navigation.
    const opts = deleteMutate.mock.calls[0][1];
    opts.onSuccess();
    expect(navigate).toHaveBeenCalledWith('/circles');
  });
});

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

/**
 * Same page, but the initial entry carries a URL hash — this is how the real
 * `useLocation()` sees Home's settings-row deep link
 * (`/circles/:id/settings#danger`) without needing to mock the hook itself
 * (which would also have to fake `Routes`' own path matching).
 */
function renderPageAtHash(hash: string) {
  return render(
    <MemoryRouter initialEntries={[`/circles/${CIRCLE_ID}/edit${hash}`]}>
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

  it('renders the form for the owner and saves name + DOB', async () => {
    const user = userEvent.setup();
    mockCircleResult(makeCircle());
    renderPage();

    const name = screen.getByLabelText(/Care recipient name/);
    await user.clear(name);
    await user.type(name, 'Rosa Meza');

    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(updateMutate).toHaveBeenCalled());
    const payload = updateMutate.mock.calls[0][0];
    expect(payload.recipient_name).toBe('Rosa Meza');
    expect(payload.recipient_dob).toBe('1948-05-02');
  });

  it('does not edit conditions — Edit Medical Info is the single input', async () => {
    const user = userEvent.setup();
    mockCircleResult(makeCircle());
    renderPage();

    // No second conditions field on this form, and saving never sends the
    // legacy circle-level list (it drifted from emergency_info.medical_conditions).
    expect(screen.queryByLabelText('Health conditions')).not.toBeInTheDocument();

    // Save starts disabled (nothing changed yet) — see the dirty-gating tests
    // below — so make an edit before saving.
    await user.type(screen.getByLabelText(/Care recipient name/), ' Jr.');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(updateMutate).toHaveBeenCalled());
    expect(updateMutate.mock.calls[0][0]).not.toHaveProperty('recipient_conditions');
  });

  it('disables Save until the name or DOB actually changes', async () => {
    const user = userEvent.setup();
    mockCircleResult(makeCircle());
    renderPage();

    const save = screen.getByRole('button', { name: 'Save changes' });
    expect(save).toBeDisabled();

    await user.type(screen.getByLabelText(/Care recipient name/), ' Jr.');
    expect(save).toBeEnabled();
  });

  it('keeps Save disabled on load even if the API returns a DOB timestamp instead of a bare date', () => {
    // The seed and the dirty-check both slice to the date-only portion, so a
    // `T00:00:00.000Z` suffix from the API can't make the untouched form look
    // dirty on load.
    mockCircleResult(makeCircle({ recipient_dob: '1948-05-02T00:00:00.000Z' }));
    renderPage();

    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
  });

  it('keeps Save disabled and shows an inline hint when clearing DOB is the only change (unsupported by the backend)', async () => {
    const user = userEvent.setup();
    mockCircleResult(makeCircle());
    renderPage();

    const save = screen.getByRole('button', { name: 'Save changes' });
    await user.clear(screen.getByLabelText('Date of birth'));
    // A bare clear can't actually be sent (updateCircleSchema's recipient_dob
    // is optional, not nullable — handleSubmit omits it when empty), so
    // treating this as "dirty" would enable a Save that silently no-ops.
    expect(save).toBeDisabled();
    expect(
      screen.getByText("Clearing the date of birth isn't supported yet. Restore it or pick a different date.")
    ).toBeInTheDocument();
  });

  it('keeps Save disabled and the hint visible when clearing DOB even while editing the name', async () => {
    const user = userEvent.setup();
    mockCircleResult(makeCircle());
    renderPage();

    const save = screen.getByRole('button', { name: 'Save changes' });
    await user.clear(screen.getByLabelText('Date of birth'));
    // Editing the name alongside the DOB clear must NOT enable Save — the
    // payload would still omit recipient_dob and the toast would misleadingly
    // say "Saved" while the field renders blank.
    await user.type(screen.getByLabelText(/Care recipient name/), ' Jr.');
    expect(save).toBeDisabled();
    expect(
      screen.getByText("Clearing the date of birth isn't supported yet. Restore it or pick a different date.")
    ).toBeInTheDocument();
  });

  it('navigates back when Cancel is clicked', async () => {
    const user = userEvent.setup();
    mockCircleResult(makeCircle());
    renderPage();

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(navigate).toHaveBeenCalledWith(-1);
  });

  it('falls back to the circle overview when Cancel has no history to go back to', async () => {
    const user = userEvent.setup();
    mockCircleResult(makeCircle());
    const originalState = window.history.state as unknown;
    Object.defineProperty(window.history, 'state', {
      value: { idx: 0 },
      configurable: true,
    });
    try {
      renderPage();
      await user.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(navigate).toHaveBeenCalledWith(`/circles/${CIRCLE_ID}`);
    } finally {
      Object.defineProperty(window.history, 'state', {
        value: originalState,
        configurable: true,
      });
    }
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

  // Home's settings row links to `/circles/:id/settings#danger` (a plain
  // in-app deep link, not this page's own navigation) — the page must land
  // the user ON the danger-zone row without taking the destructive action
  // for them.
  describe('#danger hash deep link', () => {
    it('scrolls the danger card into view and focuses its row, without opening the confirm dialog', async () => {
      mockCircleResult(makeCircle());
      const scrollIntoView = vi.fn();
      // jsdom does not implement scrollIntoView at all.
      const original = Element.prototype.scrollIntoView;
      Element.prototype.scrollIntoView = scrollIntoView;

      try {
        renderPageAtHash('#danger');

        await waitFor(() => expect(scrollIntoView).toHaveBeenCalledWith({ block: 'center' }));
        expect(screen.getByRole('button', { name: 'Delete circle' })).toHaveFocus();
        // The hash gets the user TO the row — it must not act for them.
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      } finally {
        Element.prototype.scrollIntoView = original;
      }
    });

    it('does not scroll or move focus without the #danger hash', () => {
      mockCircleResult(makeCircle());
      const scrollIntoView = vi.fn();
      const original = Element.prototype.scrollIntoView;
      Element.prototype.scrollIntoView = scrollIntoView;

      try {
        renderPage();
        expect(scrollIntoView).not.toHaveBeenCalled();
      } finally {
        Element.prototype.scrollIntoView = original;
      }
    });
  });
});

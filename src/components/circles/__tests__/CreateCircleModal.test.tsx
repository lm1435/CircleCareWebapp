import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import '@/i18n';
import { CreateCircleModal } from '../CreateCircleModal';

// Plan Stage 8, Task 8.6e — CreateCircleModal slice. Mocks the create mutation,
// navigation, auth, and toast so the test focuses on form behavior:
//   - required-name validation (blocks submit)
//   - conditions comma-split → string[] in the payload
//   - self-care toggle hides the name field + resolves the user's own name
//   - success → close + navigate to the new circle's calendar

const navigate = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => navigate };
});

// Capture the mutate call; invoke its onSuccess so we can assert close+navigate.
const createMutate = vi.fn();
vi.mock('@/hooks/useCircleAdmin', () => ({
  useCreateCircle: () => ({ mutate: createMutate, isPending: false }),
}));

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { first_name: 'Luis', last_name: 'Meza' } }),
}));

const showToast = vi.fn();
vi.mock('@/components/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/ui')>();
  return { ...actual, useToast: () => ({ showToast }) };
});

function renderModal(onClose = vi.fn()) {
  render(
    <MemoryRouter>
      <CreateCircleModal onClose={onClose} />
    </MemoryRouter>
  );
  return { onClose };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('CreateCircleModal', () => {
  it('blocks submit and shows a validation error when the name is empty', async () => {
    const user = userEvent.setup();
    renderModal();

    await user.click(screen.getByRole('button', { name: 'Create circle' }));

    // The empty required name blocks the create mutation entirely.
    expect(createMutate).not.toHaveBeenCalled();
    const nameInput = screen.getByLabelText(/Care recipient name/) as HTMLInputElement;
    expect(nameInput.validity.valid).toBe(false);
  });

  it('sends recipient_name in the payload (conditions are NOT collected at creation)', async () => {
    const user = userEvent.setup();
    renderModal();

    await user.type(screen.getByLabelText(/Care recipient name/), 'Rose Meza');
    await user.click(screen.getByRole('button', { name: 'Create circle' }));

    await waitFor(() => expect(createMutate).toHaveBeenCalled());
    const payload = createMutate.mock.calls[0][0];
    expect(payload.recipient_name).toBe('Rose Meza');
    expect(payload.recipient_conditions).toBeUndefined();
    expect(payload.is_self_care).toBe(false);
    // Health-conditions field is intentionally absent (mobile parity).
    expect(screen.queryByLabelText('Health conditions')).not.toBeInTheDocument();
  });

  it('self-care toggle hides the name field and resolves the user own name', async () => {
    const user = userEvent.setup();
    renderModal();

    await user.click(screen.getByRole('switch', { name: 'This circle is for myself' }));
    expect(screen.queryByLabelText(/Care recipient name/)).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Create circle' }));

    await waitFor(() => expect(createMutate).toHaveBeenCalled());
    const payload = createMutate.mock.calls[0][0];
    expect(payload.recipient_name).toBe('Luis Meza');
    expect(payload.is_self_care).toBe(true);
  });

  it('on success closes the modal and navigates to the new circle calendar', async () => {
    const user = userEvent.setup();
    // Drive the mutation onSuccess with a created circle.
    createMutate.mockImplementation((_data, opts) => {
      opts?.onSuccess?.({ id: 'circle-new' });
    });
    const { onClose } = renderModal();

    await user.type(screen.getByLabelText(/Care recipient name/), 'Rose Meza');
    await user.click(screen.getByRole('button', { name: 'Create circle' }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(navigate).toHaveBeenCalledWith('/circles/circle-new');
    expect(showToast).toHaveBeenCalledWith('Circle created.', 'success');
  });
});

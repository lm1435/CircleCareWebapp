import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import i18n from '@/i18n';
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

// R4-5 onboarding funnel — a successful create must report completion (the
// once-per-browser guard lives inside the mocked module).
const trackOnboardingCompleted = vi.fn();
vi.mock('@/lib/onboardingAnalytics', () => ({
  trackOnboardingCompleted: (path: string) => trackOnboardingCompleted(path),
}));

function renderModal(onClose = vi.fn()) {
  render(
    <MemoryRouter>
      <CreateCircleModal onClose={onClose} />
    </MemoryRouter>
  );
  return { onClose };
}

/**
 * Zod's own English defaults, verbatim. If one of these ever reaches the UI the
 * i18n mapping in `@/api/circles` → `messageFor()` has regressed.
 */
const ZOD_ENGLISH_DEFAULTS = [
  'String must contain at least 1 character(s)',
  'Too small: expected string to have >=1 characters',
];

/**
 * The pending `circles:validation.*` bundle (see the i18n key patch). Registered
 * with `overwrite = false` so once the patch is merged into
 * `src/i18n/{en,es}/circles.json` the REAL copy wins and this becomes a no-op —
 * the assertions below read whatever i18n actually resolves, never a literal.
 */
function ensureValidationKeys(): void {
  i18n.addResourceBundle(
    'en',
    'circles',
    { validation: { invalid: 'Please check this value.', nameRequired: "Please enter the care recipient's name." } },
    true,
    false
  );
  i18n.addResourceBundle(
    'es',
    'circles',
    { validation: { invalid: 'Revisa este valor.', nameRequired: 'Ingresa el nombre de la persona a tu cuidado.' } },
    true,
    false
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  ensureValidationKeys();
});

afterEach(async () => {
  await i18n.changeLanguage('en');
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
    // R4-5: successful create reports onboarding completion via 'created'.
    expect(trackOnboardingCompleted).toHaveBeenCalledWith('created');
  });

  // The ONE reachable i18n defect in this batch: HTML `required` is satisfied by
  // whitespace, `.trim()` empties it, and Zod's `min(1)` fires — which used to
  // render its raw English default ("String must contain at least 1
  // character(s)") on an otherwise-Spanish page.
  it('shows a TRANSLATED error (never Zod English) for a whitespace-only name', async () => {
    const user = userEvent.setup();
    renderModal();

    await user.type(screen.getByLabelText(/Care recipient name/), '   ');
    await user.click(screen.getByRole('button', { name: 'Create circle' }));

    expect(createMutate).not.toHaveBeenCalled();

    const error = await screen.findByText(i18n.t('circles:validation.nameRequired'));
    expect(error).toBeInTheDocument();
    // The key itself must have RESOLVED — an unresolved key renders as its name.
    expect(error.textContent).not.toBe('validation.nameRequired');
    for (const zodDefault of ZOD_ENGLISH_DEFAULTS) {
      expect(screen.queryByText(zodDefault)).not.toBeInTheDocument();
    }
    // Wired to the field for a11y (WCAG SC 3.3.1), not just floating text.
    const nameInput = screen.getByLabelText(/Care recipient name/);
    expect(nameInput).toHaveAttribute('aria-invalid', 'true');
    expect(nameInput.getAttribute('aria-describedby')).toContain(error.id);
  });

  it('renders that same error in Spanish when the app language is es', async () => {
    await i18n.changeLanguage('es');
    const user = userEvent.setup();
    renderModal();

    const nameInput = screen.getByLabelText(new RegExp(i18n.t('circles:create.recipientName')));
    await user.type(nameInput, '   ');
    await user.click(
      screen.getByRole('button', { name: i18n.t('circles:create.create') })
    );

    expect(createMutate).not.toHaveBeenCalled();
    const spanish = i18n.t('circles:validation.nameRequired');
    expect(await screen.findByText(spanish)).toBeInTheDocument();
    // Must differ from the English copy — proves it followed the APP language.
    expect(spanish).not.toBe(i18n.getFixedT('en', 'circles')('validation.nameRequired'));
  });

  it('does NOT report onboarding completion when creation fails', async () => {
    const user = userEvent.setup();
    createMutate.mockImplementation((_data, opts) => {
      opts?.onError?.({ error: { code: 'CIRCLE_LIMIT_REACHED' } });
    });
    renderModal();

    await user.type(screen.getByLabelText(/Care recipient name/), 'Rose Meza');
    await user.click(screen.getByRole('button', { name: 'Create circle' }));

    await waitFor(() => expect(createMutate).toHaveBeenCalled());
    expect(trackOnboardingCompleted).not.toHaveBeenCalled();
  });
});

import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { submitFormTwice } from '@/test/doubleSubmit';
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

// The onboarding-paywall gate reads the pre-create circle list and the plan
// tier. Both are React Query hooks; this suite renders without a
// QueryClientProvider, so they are mocked at the hook boundary. Defaults put
// the modal on the NO-paywall branch (the user already has a circle) so every
// pre-existing assertion below keeps exercising the plain create → navigate
// path; the paywall suite overrides them per test.
const circlesData = vi.fn(() => [{ id: 'existing' }]);
vi.mock('@/hooks/useCircles', () => ({ useCircles: () => ({ data: circlesData() }) }));
const subscriptionData = vi.fn(() => ({ tier: 'free' }));
vi.mock('@/hooks/useSubscriptionStatus', () => ({
  useSubscriptionStatus: () => ({ data: subscriptionData() }),
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
  // Modal footer convention (M4): actions live in the Modal footer prop, the
  // ghost secondary comes before the filled primary in DOM order, and the
  // form still submits via `form="create-circle-form"` even though the button
  // is no longer nested inside the <form> element.
  it('puts the ghost Cancel before the filled Create circle in the footer', () => {
    renderModal();

    const labels = screen.getAllByRole('button').map((button) => button.textContent);
    expect(labels.indexOf('Cancel')).toBeGreaterThan(-1);
    expect(labels.indexOf('Cancel')).toBeLessThan(labels.indexOf('Create circle'));
  });

  // WCAG 2.4.3: Modal always used to grab initial focus for its own close
  // button, which made the field's own `autoFocus` dead on arrival.
  it('focuses the recipient name field on open, not the close button', () => {
    renderModal();
    expect(screen.getByLabelText(/Care recipient name/)).toHaveFocus();
  });

  it('blocks submit and shows a validation error when the name is empty', async () => {
    const user = userEvent.setup();
    renderModal();
    const nameInput = screen.getByLabelText(/Care recipient name/) as HTMLInputElement;
    const invalid = vi.fn();
    nameInput.addEventListener('invalid', invalid);

    await user.click(screen.getByRole('button', { name: 'Create circle' }));

    // The empty required name blocks the create mutation entirely.
    expect(createMutate).not.toHaveBeenCalled();
    expect(nameInput.validity.valid).toBe(false);
    // THE ERROR SHOWN. On an EMPTY name it is the browser's, not ours: the
    // field's `required` stops the submit before React's handler runs, and the
    // form's constraint validation fires `invalid` on the field — the event the
    // browser raises its "fill out this field" message from. jsdom draws no
    // bubble, so the event is the observable. (A whitespace-only name passes
    // `required`, reaches Zod, and gets the app's own translated error — the
    // test below.)
    expect(invalid).toHaveBeenCalledTimes(1);
    // …and nothing swallowed it: `preventDefault()` on `invalid` is precisely
    // how a page suppresses that message while the submit stays blocked — a
    // dead button with no explanation.
    expect((invalid.mock.calls[0]![0] as Event).defaultPrevented).toBe(false);
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
    // FIRST RUN rides on the navigation. Landing on the circle alone drops the
    // owner on an empty app, which is the moment the four-step wizard exists to
    // fix; the flag is `location.state` rather than a query param so it is not
    // shareable, not bookmarkable, and gone on reload.
    expect(navigate).toHaveBeenCalledWith('/circles/circle-new', {
      state: { firstRun: true, firstRunRecipientName: 'Rose Meza' },
    });
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

  // THE WRONG DOOR. Without this, an invited family member who opened the
  // create form can only finish creating a circle nobody needs, or cancel back
  // to a page whose loudest control sends them straight back in.
  describe('join-instead escape hatch', () => {
    it('offers joining with a code when the caller owns a join surface', async () => {
      const user = userEvent.setup();
      const onJoinInstead = vi.fn();
      render(
        <MemoryRouter>
          <CreateCircleModal onClose={vi.fn()} onJoinInstead={onJoinInstead} />
        </MemoryRouter>
      );

      expect(screen.getByText('Were you invited to a circle?')).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Join with an invite code' }));
      expect(onJoinInstead).toHaveBeenCalledTimes(1);
    });

    // Offering an exit the caller cannot deliver is worse than not offering it.
    it('offers nothing when no join surface was supplied', () => {
      renderModal();

      expect(screen.queryByText('Were you invited to a circle?')).not.toBeInTheDocument();
    });

    // It is NOT a form control: an Enter press in the name field must submit
    // the create form, never navigate the user out of it.
    it('keeps the affordance outside the create form', () => {
      render(
        <MemoryRouter>
          <CreateCircleModal onClose={vi.fn()} onJoinInstead={vi.fn()} />
        </MemoryRouter>
      );

      const joinButton = screen.getByRole('button', { name: 'Join with an invite code' });
      expect(joinButton.closest('form')).toBeNull();
    });
  });
  // ──────────────────────────────────────────────────────────────────────────
  // DOUBLE SUBMIT — this form had NO in-flight guard at all, not even a
  // pending check: `useZodForm.submit` calls `onValid` synchronously every time
  // it is handed valid values, and `create.mutate(...)` returns immediately.
  // Two submits in one tick therefore created TWO CIRCLES, and fired
  // `Analytics.circleCreated` and `trackOnboardingCompleted` twice each —
  // the second circle lands in the picker with the same recipient name, and the
  // activation funnel counts one household as two.
  //
  // `submitFormTwice`, not two awaited clicks: userEvent commits a render
  // between interactions, which is precisely the window this bug lives in.
  // ──────────────────────────────────────────────────────────────────────────
  describe('double submit', () => {
    function createCircleForm(): HTMLFormElement {
      const form = document.getElementById('create-circle-form');
      if (!(form instanceof HTMLFormElement)) throw new Error('create-circle-form not found');
      return form;
    }

    it('creates ONE circle when the form is submitted twice in one tick', async () => {
      const user = userEvent.setup();
      // A `mutate` that never calls back: the request is still in flight when
      // the second submit arrives, which is the only state under test.
      createMutate.mockImplementation(() => {});
      renderModal();

      await user.type(screen.getByLabelText(/Care recipient name/), 'Rose Meza');
      await submitFormTwice(createCircleForm());

      expect(createMutate).toHaveBeenCalledTimes(1);
    });

    it('reports circle creation and onboarding completion exactly once', async () => {
      const user = userEvent.setup();
      createMutate.mockImplementation((_data, opts) => {
        opts?.onSuccess?.({ id: 'c-new' });
      });
      renderModal();

      await user.type(screen.getByLabelText(/Care recipient name/), 'Rose Meza');
      await submitFormTwice(createCircleForm());

      await waitFor(() => expect(createMutate).toHaveBeenCalledTimes(1));
      expect(trackOnboardingCompleted).toHaveBeenCalledTimes(1);
    });

    it('still creates on a genuine RESUBMIT after the first attempt failed', async () => {
      const user = userEvent.setup();
      // The callbacks are held, not fired inline: React Query runs
      // `onError`/`onSettled` when the REQUEST comes back, not inside
      // `mutate()`. A mock that calls them synchronously would release the
      // guard before `mutate` even returned, and this test would then pass
      // against no guard at all.
      let pending: Parameters<typeof createMutate>[1] | undefined;
      createMutate.mockImplementation((_data, opts) => {
        pending = opts;
      });
      renderModal();

      await user.type(screen.getByLabelText(/Care recipient name/), 'Rose Meza');
      await submitFormTwice(createCircleForm());
      expect(createMutate).toHaveBeenCalledTimes(1);

      await act(async () => {
        pending?.onError?.({ error: { code: 'CIRCLE_LIMIT_REACHED' } });
        pending?.onSettled?.();
      });

      await submitFormTwice(createCircleForm());
      await waitFor(() => expect(createMutate).toHaveBeenCalledTimes(2));
    });
  });
});

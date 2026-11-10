import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import i18n from '@/i18n';
import { Analytics } from '@/lib/analytics';
import { CreateCircleModal } from '../CreateCircleModal';

// Circle-timezone spec, web T11: the optional "Where does {name} live?" field
// on circle creation. Prefilled from the browser zone; only a DIFFERENT pick is
// sent, so skipping it keeps today's automatic behavior.
//
// The browser zone is pinned (never the dev machine's America/Denver): Bogota
// observes no DST, so its "(GMT-5)" label is stable all year.

vi.mock('@/utils/timezone', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/timezone')>();
  return { ...actual, getDeviceTimezone: () => 'America/Bogota' };
});

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => vi.fn() };
});

const createMutate = vi.fn();
vi.mock('@/hooks/useCircleAdmin', () => ({
  useCreateCircle: () => ({ mutate: createMutate, isPending: false }),
}));
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { first_name: 'Luis', last_name: 'Meza' } }),
}));
vi.mock('@/hooks/useCircles', () => ({ useCircles: () => ({ data: [{ id: 'existing' }] }) }));
vi.mock('@/hooks/useSubscriptionStatus', () => ({
  useSubscriptionStatus: () => ({ data: { tier: 'premium' } }),
}));
vi.mock('@/lib/onboardingAnalytics', () => ({ trackOnboardingCompleted: vi.fn() }));
vi.mock('@/components/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/ui')>();
  return { ...actual, useToast: () => ({ showToast: vi.fn() }) };
});

function renderModal() {
  render(
    <MemoryRouter>
      <CreateCircleModal onClose={vi.fn()} />
    </MemoryRouter>
  );
}

let tzSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.clearAllMocks();
  tzSpy = vi.spyOn(Analytics, 'circleTimezoneSet').mockImplementation(() => {});
});
afterEach(async () => {
  tzSpy.mockRestore();
  await i18n.changeLanguage('en');
});

/** Run the success callback the real mutation would. */
function succeed(): void {
  const [data, opts] = createMutate.mock.calls[0];
  opts.onSuccess({ id: 'circle-new', ...data });
}

describe('CreateCircleModal — time zone', () => {
  it('prefills the browser zone, names the person, and shows the caption', async () => {
    const user = userEvent.setup();
    renderModal();
    expect(screen.getByRole('combobox', { name: 'Where does the person you care for live?' })).toHaveValue(
      'Bogota (GMT-5)'
    );
    await user.type(screen.getByLabelText(/Care recipient name/), 'Maria');
    const field = screen.getByRole('combobox', { name: 'Where does Maria live?' });
    expect(field).toHaveAccessibleDescription(
      'Prefilled from your browser. You can change it any time in Circle settings.'
    );
  });

  it('skipped: no timezone is sent and no event fires', async () => {
    const user = userEvent.setup();
    renderModal();
    await user.type(screen.getByLabelText(/Care recipient name/), 'Maria');
    await user.click(screen.getByRole('button', { name: 'Create circle' }));
    await waitFor(() => expect(createMutate).toHaveBeenCalled());
    expect(createMutate.mock.calls[0][0]).not.toHaveProperty('timezone');
    succeed();
    expect(tzSpy).not.toHaveBeenCalled();
  });

  it('a different pick is sent and fires circle_timezone_set (create_circle)', async () => {
    const user = userEvent.setup();
    renderModal();
    await user.type(screen.getByLabelText(/Care recipient name/), 'Maria');
    const field = screen.getByRole('combobox', { name: 'Where does Maria live?' });
    await user.type(field, 'Mexico City');
    await user.click(screen.getByRole('option', { name: 'Mexico City (GMT-6)' }));
    expect(field).toHaveValue('Mexico City (GMT-6)');
    // No "Automatic" choice here: leaving the prefill IS automatic.
    await user.click(field);
    expect(screen.queryByRole('option', { name: /Automatic/ })).toBeNull();
    await user.keyboard('{Escape}');

    await user.click(screen.getByRole('button', { name: 'Create circle' }));
    await waitFor(() => expect(createMutate).toHaveBeenCalled());
    expect(createMutate.mock.calls[0][0]).toMatchObject({
      recipient_name: 'Maria',
      timezone: 'America/Mexico_City',
    });
    succeed();
    expect(tzSpy).toHaveBeenCalledWith({
      source: 'create_circle',
      cleared: false,
      zone: 'America/Mexico_City',
      recipient_zone_mismatch: false,
    });
  });

  it('picking the browser zone back is the same as skipping', async () => {
    const user = userEvent.setup();
    renderModal();
    await user.type(screen.getByLabelText(/Care recipient name/), 'Maria');
    const field = screen.getByRole('combobox', { name: 'Where does Maria live?' });
    await user.type(field, 'Lima');
    await user.click(screen.getByRole('option', { name: 'Lima (GMT-5)' }));
    await user.type(field, 'Bogota');
    await user.click(screen.getByRole('option', { name: 'Bogota (GMT-5)' }));
    await user.click(screen.getByRole('button', { name: 'Create circle' }));
    await waitFor(() => expect(createMutate).toHaveBeenCalled());
    expect(createMutate.mock.calls[0][0]).not.toHaveProperty('timezone');
  });

  it('self-care hides the field (the creator IS the recipient)', async () => {
    const user = userEvent.setup();
    renderModal();
    await user.click(screen.getByRole('switch', { name: 'This circle is for myself' }));
    expect(screen.queryByRole('combobox')).toBeNull();
  });

  it('Spanish copy', async () => {
    await i18n.changeLanguage('es');
    const user = userEvent.setup();
    renderModal();
    await user.type(screen.getByRole('textbox', { name: /Nombre/ }), 'María');
    expect(screen.getByRole('combobox', { name: '¿Dónde vive María?' })).toBeInTheDocument();
    expect(
      screen.getByText('Tomada de tu navegador. Puedes cambiarla cuando quieras en la configuración del círculo.')
    ).toBeInTheDocument();
  });
});

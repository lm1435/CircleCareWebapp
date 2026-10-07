// The inline amber note under a medication dose time when the time falls inside
// the quiet hours of the person who gets the at-due reminder. Mirrors mobile's
// DoseQuietHoursNote.test.tsx case for case (same rule, same copy).
//
// Deterministic: the viewer's zone IS the device zone (whatever it is), and the
// dose is built with `viewerInstant` in that same zone, so no assertion depends
// on the machine's timezone. Copy is read from the REAL en/es calendar.json.

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@/i18n';
import i18n from '@/i18n';
import { useAuthStore } from '@/store/authStore';
import { getDeviceTimezone } from '@/utils/timezone';
import { AddEventModal } from '../AddEventModal';
import { DoseQuietHoursNote } from '../DoseQuietHoursNote';

const CIRCLE_ID = 'circle-1';
const DEVICE_TZ = getDeviceTimezone();

let mockUser: Record<string, unknown> | undefined;
vi.mock('@/api/users', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/users')>();
  return { ...actual, getCurrentUser: () => Promise.resolve(mockUser) };
});

let mockMembers: Array<Record<string, unknown>> = [];
vi.mock('@/api/drugs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/drugs')>();
  return { ...actual, searchDrugs: vi.fn().mockResolvedValue([]) };
});
vi.mock('@/hooks/useCalendarEvents', () => ({
  useCreateEvent: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateEvent: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useCachedCircleEvents: () => [],
}));
vi.mock('@/hooks/useSeriesRoot', () => ({
  useSeriesRoot: (_c: string, event: unknown) => ({ root: event ?? null }),
}));
vi.mock('@/hooks/useCircle', () => ({
  useCircle: () => ({
    circle: { owner_id: 'me', recipient_name: 'Margaret' },
    circleSummary: undefined,
    timezone: DEVICE_TZ,
    members: mockMembers,
    canEdit: true,
    accessLevel: 'full',
    viewOnly: false,
    readOnly: false,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
}));
vi.mock('@/hooks/useHourCycle', () => ({ useHourCycle: () => '12h' }));
vi.mock('@/components/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/ui')>();
  return { ...actual, useToast: () => ({ showToast: vi.fn() }) };
});

const OWNER_ONLY = [{ id: 'me', email: 'me@example.com', role: 'owner' }];
const OTHER_RESPONSIBLE = [
  { id: 'me', email: 'me@example.com', role: 'owner' },
  { id: 'other', email: 'o@example.com', role: 'member', is_medication_responsible: true },
];

const EN_COPY =
  'This time is during quiet hours, so no reminder will be sent then. You can change quiet hours in Account.';
const ES_COPY =
  'Esta hora cae dentro de tu horario sin interrupciones, así que no se enviará ningún recordatorio. Puedes cambiar el horario sin interrupciones en Cuenta.';

const quietUser = (over: Record<string, unknown> = {}) => ({
  id: 'me',
  timezone: DEVICE_TZ,
  quiet_hours_start: '22:00:00',
  quiet_hours_end: '07:00:00',
  ...over,
});

function wrap(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

function renderNote(
  timeStr: string,
  over: Partial<React.ComponentProps<typeof DoseQuietHoursNote>> = {}
) {
  return wrap(
    <DoseQuietHoursNote
      applies
      dateStr="2026-07-10"
      timeStr={timeStr}
      members={OWNER_ONLY}
      ownerId="me"
      {...over}
    />
  );
}

const noteSelector = () => screen.queryByTestId('dose-quiet-hours-note');
/** Let the current-user query settle, then report the note. */
async function settle() {
  await new Promise((r) => setTimeout(r, 20));
}

beforeEach(async () => {
  mockUser = quietUser();
  mockMembers = OWNER_ONLY;
  useAuthStore.setState({ user: { id: 'me' } as never });
  await i18n.changeLanguage('en');
});
afterEach(async () => {
  await i18n.changeLanguage('en');
  useAuthStore.setState({ user: null });
});

describe('DoseQuietHoursNote', () => {
  it('shows the amber note, in the exact EN copy, when the dose is inside quiet hours', async () => {
    renderNote('22:00');
    expect(await screen.findByTestId('dose-quiet-hours-note')).toHaveTextContent(EN_COPY);
  });

  it('is natural Latin-American Spanish in ES', async () => {
    await i18n.changeLanguage('es');
    renderNote('22:00');
    expect(await screen.findByTestId('dose-quiet-hours-note')).toHaveTextContent(ES_COPY);
  });

  it('shows after midnight too (the overnight window wraps)', async () => {
    renderNote('03:00');
    expect(await screen.findByTestId('dose-quiet-hours-note')).toBeInTheDocument();
  });

  it('is absent outside quiet hours', async () => {
    renderNote('12:00');
    await settle();
    expect(noteSelector()).toBeNull();
  });

  it('is absent when quiet hours are OFF (NULL, the new-account default)', async () => {
    mockUser = quietUser({ quiet_hours_start: null, quiet_hours_end: null });
    renderNote('22:00');
    await settle();
    expect(noteSelector()).toBeNull();
  });

  it('is absent when the reminder goes to someone else (responsible member)', async () => {
    renderNote('22:00', { members: OTHER_RESPONSIBLE });
    await settle();
    expect(noteSelector()).toBeNull();
  });

  it('shows when the viewer IS the responsible member', async () => {
    renderNote('22:00', {
      members: [
        { id: 'me', role: 'member', is_medication_responsible: true },
        { id: 'o', role: 'owner' },
      ],
      ownerId: 'o',
    });
    expect(await screen.findByTestId('dose-quiet-hours-note')).toBeInTheDocument();
  });

  it('is absent when no at-due reminder applies, or no time is set', async () => {
    renderNote('22:00', { applies: false });
    await settle();
    expect(noteSelector()).toBeNull();
    renderNote('');
    await settle();
    expect(noteSelector()).toBeNull();
  });

  it('FALSIFIER: the same dose is judged in the viewer zone from the profile', async () => {
    // A zone 12h away from the device turns 22:00 into midday-ish: outside 22:00-07:00.
    const far = DEVICE_TZ === 'Pacific/Auckland' ? 'America/Denver' : 'Pacific/Auckland';
    mockUser = quietUser({ timezone: far, quiet_hours_start: '23:00', quiet_hours_end: '06:00' });
    renderNote('02:00');
    await settle();
    // Control: the same time with the device zone as the profile zone DOES warn.
    mockUser = quietUser({ quiet_hours_start: '23:00', quiet_hours_end: '06:00' });
    renderNote('02:00');
    await waitFor(() => expect(screen.getAllByTestId('dose-quiet-hours-note')).toHaveLength(1));
  });
});

describe('in the medication form', () => {
  function renderForm() {
    return wrap(<AddEventModal circleId={CIRCLE_ID} initialType="medication" onClose={vi.fn()} />);
  }

  it('appears under the Time field when a dose time inside quiet hours is typed, never blocks Save', async () => {
    renderForm();
    expect(noteSelector()).toBeNull();
    fireEvent.change(screen.getByLabelText(/^Time/), { target: { value: '22:30' } });
    expect(await screen.findByTestId('dose-quiet-hours-note')).toHaveTextContent(EN_COPY);
    // Display only: the Save button is still enabled.
    const save = screen.getAllByRole('button').find((b) => /^(save|add)/i.test(b.textContent || ''));
    if (save) expect(save).not.toBeDisabled();
  });

  it('does not appear for a daytime dose, and goes away when the time moves out of the window', async () => {
    renderForm();
    const time = screen.getByLabelText(/^Time/);
    fireEvent.change(time, { target: { value: '22:30' } });
    await screen.findByTestId('dose-quiet-hours-note');
    fireEvent.change(time, { target: { value: '09:00' } });
    await waitFor(() => expect(noteSelector()).toBeNull());
  });

  it('does not appear when the reminder goes to a different responsible member', async () => {
    mockMembers = OTHER_RESPONSIBLE;
    renderForm();
    fireEvent.change(screen.getByLabelText(/^Time/), { target: { value: '22:30' } });
    await settle();
    expect(noteSelector()).toBeNull();
  });
});

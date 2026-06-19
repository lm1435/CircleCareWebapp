// Plan Task 48 — TodaysMeds + ConfirmMedDialog: status rendering, confirm
// flow, skip-with-note flow, can_edit=false gating + banners, permission
// (402/403) toast handling.
//
// Time is pinned two ways so tests never depend on the dev machine
// (America/Denver):
// - vi.useFakeTimers({ toFake: ['Date'] }) freezes "now" (setTimeout stays
//   real so React Testing Library and userEvent work normally).
// - Intl.resolvedOptions is spied to America/New_York (same pattern as
//   src/utils/__tests__/timezone.test.ts) — only getDeviceTimezone reads it.

import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Mock } from 'vitest';
import '@/i18n';
import { apiClient } from '@/lib/api';
import { ToastProvider } from '@/components/ui';
import { TodaysMeds } from '@/components/meds/TodaysMeds';
import type { Circle } from '@/api/circles';
import type { TodaysMedication } from '@/api/medicationConfirmations';

const mockedGet = apiClient.get as unknown as Mock;
const mockedPost = apiClient.post as unknown as Mock;

const CIRCLE_ID = 'circle-1';
const TZ = 'America/New_York';
// 2026-06-12T16:00:00Z = 12:00 PM ET → "today" in the recipient TZ is 2026-06-12.
const NOW = new Date('2026-06-12T16:00:00Z');
const TODAY = '2026-06-12';

function makeCircle(overrides: Partial<Circle> = {}): Circle {
  return {
    id: CIRCLE_ID,
    name: 'Mom',
    recipient_name: 'Mom',
    recipient_photo_url: null,
    role: 'member',
    is_care_recipient: false,
    member_count: 3,
    created_at: '2026-01-01T00:00:00Z',
    access_level: 'edit',
    is_premium_circle: true,
    can_edit: true,
    view_only: false,
    read_only: false,
    ...overrides,
  };
}

function makeMed(overrides: Partial<TodaysMedication>): TodaysMedication {
  return {
    id: 'med-x',
    event_type: 'medication',
    title: 'Medication',
    medication_name: null,
    medication_dosage: null,
    scheduled_date: TODAY,
    scheduled_time: '08:00:00',
    confirmation: null,
    ...overrides,
  };
}

const DEFAULT_MEDS: TodaysMedication[] = [
  makeMed({
    id: 'med-1',
    medication_name: 'Lisinopril',
    scheduled_time: '08:00:00',
    confirmation: { status: 'taken', confirmed_at: '2026-06-12T12:05:00Z', confirmed_by: 'u1' },
  }),
  makeMed({
    id: 'med-2',
    medication_name: 'Metformin',
    scheduled_time: '09:00:00',
    confirmation: { status: 'skipped', confirmed_at: '2026-06-12T13:00:00Z', confirmed_by: 'u1' },
  }),
  // 10:00 ET is before the pinned 12:00 ET "now" → past due, unconfirmed → Missed
  makeMed({ id: 'med-3', medication_name: 'Atorvastatin', scheduled_time: '10:00:00' }),
  // 8:00 PM ET is after "now" → Pending
  makeMed({
    id: 'med-4',
    medication_name: 'Levothyroxine',
    medication_dosage: '50 mcg',
    scheduled_time: '20:00:00',
  }),
];

function mockApi({
  circles = [makeCircle()],
  events = DEFAULT_MEDS,
}: { circles?: Circle[]; events?: TodaysMedication[] } = {}): void {
  mockedGet.mockImplementation((url: string) => {
    if (url === '/circles') {
      return Promise.resolve({ success: true, data: { circles } });
    }
    if (url === `/circles/${CIRCLE_ID}`) {
      return Promise.resolve({
        success: true,
        data: { circle: { id: CIRCLE_ID, care_recipient_timezone: TZ } },
      });
    }
    if (url === `/circles/${CIRCLE_ID}/events`) {
      return Promise.resolve({ success: true, data: { events } });
    }
    return Promise.reject(new Error(`unexpected GET ${url}`));
  });
}

function renderWidget(): { queryClient: QueryClient } {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <TodaysMeds circleId={CIRCLE_ID} />
      </ToastProvider>
    </QueryClientProvider>
  );
  return { queryClient };
}

function medRow(name: string): HTMLElement {
  const row = screen.getByText(name).closest('li');
  if (!row) throw new Error(`list item for ${name} not found`);
  return row;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: NOW });
  vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({
    timeZone: 'America/New_York',
  } as Intl.ResolvedDateTimeFormatOptions);
  mockedGet.mockReset();
  mockedPost.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('TodaysMeds', () => {
  it('renders today\'s medications with times and status badges', async () => {
    mockApi();
    renderWidget();

    expect(await screen.findByText('Lisinopril')).toBeInTheDocument();

    // Fetch uses "today" computed in the care recipient's timezone
    expect(mockedGet).toHaveBeenCalledWith(`/circles/${CIRCLE_ID}/events`, {
      params: { start_date: TODAY, end_date: TODAY, event_type: 'medication' },
    });

    // Status badges per state
    expect(within(medRow('Lisinopril')).getByText('Taken')).toBeInTheDocument();
    expect(within(medRow('Metformin')).getByText('Skipped')).toBeInTheDocument();
    expect(within(medRow('Atorvastatin')).getByText('Missed')).toBeInTheDocument();
    expect(within(medRow('Levothyroxine')).getByText('Pending')).toBeInTheDocument();

    // Scheduled time shown (care recipient TZ, same as pinned device TZ)
    expect(within(medRow('Levothyroxine')).getByText('8:00 PM ET')).toBeInTheDocument();
    expect(screen.getByText('50 mcg')).toBeInTheDocument();

    // Confirm/skip only on unconfirmed meds (missed + pending)
    expect(screen.getAllByRole('button', { name: 'Confirm' })).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: 'Skip' })).toHaveLength(2);
    expect(within(medRow('Lisinopril')).queryByRole('button')).not.toBeInTheDocument();
  });

  it('renders the empty state when there are no medications today', async () => {
    mockApi({ events: [] });
    renderWidget();

    expect(await screen.findByText('No medications today')).toBeInTheDocument();
  });

  it('shows an error with retry that refetches', async () => {
    let failEvents = true;
    mockedGet.mockImplementation((url: string) => {
      if (url === '/circles') {
        return Promise.resolve({ success: true, data: { circles: [makeCircle()] } });
      }
      if (url === `/circles/${CIRCLE_ID}`) {
        return Promise.resolve({
          success: true,
          data: { circle: { id: CIRCLE_ID, care_recipient_timezone: TZ } },
        });
      }
      if (url === `/circles/${CIRCLE_ID}/events`) {
        return failEvents
          ? Promise.reject({ success: false, error: { code: 'SERVER_ERROR' } })
          : Promise.resolve({ success: true, data: { events: DEFAULT_MEDS } });
      }
      return Promise.reject(new Error(`unexpected GET ${url}`));
    });
    renderWidget();

    expect(await screen.findByText("Couldn't load today's medications")).toBeInTheDocument();

    failEvents = false;
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByText('Lisinopril')).toBeInTheDocument();
  });

  it('confirms a medication as taken through the dialog with the correct payload', async () => {
    mockApi();
    mockedPost.mockResolvedValue({
      success: true,
      data: { confirmation: { id: 'conf-1', event_id: 'med-4', status: 'taken' } },
    });
    renderWidget();
    const user = userEvent.setup();

    await screen.findByText('Levothyroxine');
    await user.click(within(medRow('Levothyroxine')).getByRole('button', { name: 'Confirm' }));

    const dialog = await screen.findByRole('dialog', { name: 'Confirm medication' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(within(dialog).getByRole('radio', { name: 'Taken' })).toHaveAttribute(
      'aria-checked',
      'true'
    );

    await user.click(within(dialog).getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(mockedPost).toHaveBeenCalledWith(`/circles/${CIRCLE_ID}/medications/confirm`, {
        event_id: 'med-4',
        status: 'taken',
        notes: undefined,
        scheduled_time: '20:00:00',
      });
    });

    // Success toast + dialog closed
    expect(await screen.findByText('Medication updated')).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Confirm medication' })).not.toBeInTheDocument();
  });

  it('skips a medication with an optional note', async () => {
    mockApi();
    mockedPost.mockResolvedValue({
      success: true,
      data: { confirmation: { id: 'conf-2', event_id: 'med-4', status: 'skipped' } },
    });
    renderWidget();
    const user = userEvent.setup();

    await screen.findByText('Levothyroxine');
    await user.click(within(medRow('Levothyroxine')).getByRole('button', { name: 'Skip' }));

    const dialog = await screen.findByRole('dialog', { name: 'Confirm medication' });
    expect(within(dialog).getByRole('radio', { name: 'Skipped' })).toHaveAttribute(
      'aria-checked',
      'true'
    );

    await user.type(within(dialog).getByLabelText('Note (optional)'), 'Felt nauseous');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(mockedPost).toHaveBeenCalledWith(`/circles/${CIRCLE_ID}/medications/confirm`, {
        event_id: 'med-4',
        status: 'skipped',
        notes: 'Felt nauseous',
        scheduled_time: '20:00:00',
      });
    });
  });

  it('hides confirm/skip and shows the view-only banner when can_edit is false (view_only)', async () => {
    mockApi({
      circles: [makeCircle({ can_edit: false, view_only: true, access_level: 'view' })],
    });
    renderWidget();

    expect(await screen.findByText('Levothyroxine')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Confirm' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Skip' })).not.toBeInTheDocument();
    expect(screen.getByText('View-only access')).toBeInTheDocument();
  });

  it('shows the owner read-only banner when the circle is read_only', async () => {
    mockApi({
      circles: [makeCircle({ can_edit: false, read_only: true, role: 'owner' })],
    });
    renderWidget();

    expect(await screen.findByText('Levothyroxine')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Confirm' })).not.toBeInTheDocument();
    expect(screen.getByText('Re-subscribe to manage this circle.')).toBeInTheDocument();
  });

  it('shows the member read-only banner when a member views a read_only circle', async () => {
    mockApi({
      circles: [makeCircle({ can_edit: false, read_only: true, role: 'member' })],
    });
    renderWidget();

    expect(await screen.findByText('Levothyroxine')).toBeInTheDocument();
    expect(screen.getByText('You can view but not edit this circle.')).toBeInTheDocument();
  });

  it('shows a permission toast and refetches circles when the backend rejects with 402/403', async () => {
    mockApi();
    // The api client rejects with the backend envelope (requireCircleEditAccess).
    mockedPost.mockRejectedValue({
      success: false,
      error: { code: 'SUBSCRIPTION_REQUIRED', message: 'This circle requires a subscription' },
    });
    renderWidget();
    const user = userEvent.setup();

    await screen.findByText('Levothyroxine');
    const circlesCallsBefore = mockedGet.mock.calls.filter(([url]) => url === '/circles').length;

    await user.click(within(medRow('Levothyroxine')).getByRole('button', { name: 'Confirm' }));
    const dialog = await screen.findByRole('dialog', { name: 'Confirm medication' });
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));

    expect(
      await screen.findByText("You don't have permission to confirm medications in this circle.")
    ).toBeInTheDocument();

    // Dialog closes and circle access flags refetch
    await waitFor(() => {
      expect(
        screen.queryByRole('dialog', { name: 'Confirm medication' })
      ).not.toBeInTheDocument();
    });
    await waitFor(() => {
      const circlesCallsAfter = mockedGet.mock.calls.filter(([url]) => url === '/circles').length;
      expect(circlesCallsAfter).toBeGreaterThan(circlesCallsBefore);
    });
  });
});

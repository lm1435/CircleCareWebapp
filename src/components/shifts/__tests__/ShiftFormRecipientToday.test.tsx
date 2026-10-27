import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import '@/i18n';
import type { CircleMember } from '@/api/circleMembers';
import { ToastProvider } from '@/components/ui';
import { useCircle } from '@/hooks/useCircle';
import { useAuthStore } from '@/store/authStore';
import { getDateInTimezone, getDeviceTimezone } from '@/utils/timezone';
import { ShiftFormModal } from '../ShiftFormModal';

/**
 * A shift's date is RECIPIENT-frame (stored naive, shown in the recipient's
 * zone), so the date picker's Today ring and Today button must use the
 * RECIPIENT's today. They used the viewer's.
 *
 * The device zone is the process zone; the recipient is picked at runtime as a
 * zone whose calendar day differs from the device's at the pinned instant, so
 * this is red from any device zone without the fix.
 */

vi.mock('@/api/shifts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/shifts')>()),
  createShift: vi.fn(),
  updateShift: vi.fn(),
}));
vi.mock('@/hooks/useCircle', () => ({ useCircle: vi.fn() }));
vi.mock('@/hooks/useHourCycle', () => ({ useHourCycle: () => '12h' }));
vi.mock('@/lib/analytics', () => ({
  Analytics: {
    shiftCreated: vi.fn(),
    shiftEdited: vi.fn(),
    shiftAddNextTapped: vi.fn(),
    shiftTakeConflict: vi.fn(),
  },
}));

const NOW = new Date('2026-10-28T03:00:00Z');
const CANDIDATES = ['Australia/Sydney', 'America/Denver', 'Pacific/Kiritimati', 'Pacific/Midway'];

function recipientZoneOnAnotherDay(): string {
  const device = getDateInTimezone(getDeviceTimezone(), NOW);
  const zone = CANDIDATES.find((z) => getDateInTimezone(z, NOW) !== device);
  if (!zone) throw new Error('no candidate zone on a different day');
  return zone;
}

const members = [
  { id: 'u-me', first_name: 'Pat', last_name: 'L', email: 'pat@x.test', role: 'owner', is_care_recipient: false },
] as unknown as CircleMember[];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  useAuthStore.setState({
    user: { id: 'u-me', email: 'pat@x.test', first_name: 'Pat', last_name: 'L' },
    isAuthenticated: true,
  } as never);
});
afterEach(() => {
  vi.useRealTimers();
});

describe('ShiftFormModal date picker uses the recipient today', () => {
  it('rings the recipient today and Today picks it', async () => {
    const zone = recipientZoneOnAnotherDay();
    const recipientToday = getDateInTimezone(zone, NOW);
    vi.mocked(useCircle).mockReturnValue({
      circle: { id: 'c', recipient_name: 'Rosa', owner_id: 'u-me' },
      timezone: zone,
      members,
      canEdit: true,
      canManageMembers: true,
      viewerRole: 'owner',
    } as unknown as ReturnType<typeof useCircle>);

    const user = userEvent.setup({ advanceTimers: () => undefined });
    render(
      <QueryClientProvider client={new QueryClient()}>
        <ToastProvider>
          <MemoryRouter>
            <ShiftFormModal circleId="c" initialDate="2026-10-01" onClose={vi.fn()} />
          </MemoryRouter>
        </ToastProvider>
      </QueryClientProvider>
    );

    const dateInput = screen.getByLabelText(/^Date/) as HTMLInputElement;
    await user.click(screen.getAllByRole('button', { name: 'Choose a date' })[0]);
    await screen.findByRole('dialog', { name: 'Date picker' });
    // Navigate to the month that holds today before reading the ring.
    await user.click(screen.getByRole('button', { name: 'Today' }));
    expect(dateInput.value).toBe(recipientToday);

    await user.click(screen.getAllByRole('button', { name: 'Choose a date' })[0]);
    await screen.findByRole('dialog', { name: 'Date picker' });
    const ringed = document.querySelector<HTMLElement>('[aria-current="date"]');
    expect(ringed?.getAttribute('data-day')).toBe(recipientToday);
  });
});

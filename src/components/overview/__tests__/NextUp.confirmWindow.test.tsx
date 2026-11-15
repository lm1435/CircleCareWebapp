// Re-homed from TodaysMeds.test.tsx "confirm window" (dead host): Taken is offered from scheduled_time minus 2 h,
// measured in the CARE RECIPIENT's zone, never the viewer's. Live host: NextUp (isDoseConfirmable). Now is the fixed
// instant 2026-06-12T16:00Z = 12:00 PM New York = 10:00 AM Denver.

import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@/i18n';
import { NextUp } from '../NextUp';
import { ToastProvider } from '@/components/ui/Toast';
import type { NextUpItem } from '../nextUpItems';

vi.mock('@/hooks/useHourCycle', () => ({ useHourCycle: () => '12h' }));
vi.mock('@/components/meds/useMedicationUndo', () => ({
  useMedicationUndo: () => ({ pending: {}, confirm: vi.fn(), undo: vi.fn(), hold: vi.fn() }),
}));
vi.mock('@/hooks/useTaskCompletion', () => ({
  useTaskCompletion: () => ({
    pendingIds: new Set<string>(),
    handleComplete: vi.fn(),
    handleUndo: vi.fn(),
    handleHoldUndo: vi.fn(),
    flushPending: vi.fn(),
  }),
}));

const TODAY = '2026-06-12';
const dose = (name: string, time: string): NextUpItem => ({
  key: `medication:${name}`,
  type: 'medication',
  id: name,
  title: name,
  detail: null,
  time,
  date: TODAY,
  late: false,
  lateHours: null,
  med: { id: name, event_type: 'medication', title: name, scheduled_date: TODAY, scheduled_time: time } as NextUpItem['med'],
});

function renderList(items: NextUpItem[], timezone: string, canEdit = true) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <ToastProvider>
          <NextUp
            circleId="c1"
            timezone={timezone}
            recipientName="Mom"
            isSelfCare={false}
            canEdit={canEdit}
            items={items}
            loading={false}
            error={false}
            onRetry={vi.fn()}
            stacked={false}
          />
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );
}
const hasTaken = (name: string) =>
  screen.queryByRole('button', { name: new RegExp(`^Taken, ${name}`) }) !== null;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-06-12T16:00:00Z') });
});
afterEach(() => vi.useRealTimers());

describe('NextUp confirm window', () => {
  it('offers Taken exactly at scheduled_time - 2h, and not a minute earlier', () => {
    renderList([dose('Boundary', '14:00:00'), dose('JustOutside', '14:01:00')], 'America/New_York');
    expect(hasTaken('Boundary')).toBe(true);
    expect(hasTaken('JustOutside')).toBe(false);
  });

  it('NEGATIVE hides Taken on a dose more than 2h out', () => {
    renderList([dose('Levothyroxine', '20:00:00')], 'America/New_York');
    expect(screen.getByText('Levothyroxine')).toBeInTheDocument();
    expect(hasTaken('Levothyroxine')).toBe(false);
  });

  it('keeps Taken on an overdue dose earlier today', () => {
    renderList([dose('Atorvastatin', '08:00:00')], 'America/New_York');
    expect(hasTaken('Atorvastatin')).toBe(true);
  });

  it('NEGATIVE measures the window in the recipient zone, not the device: 13:00 is open for New York, closed for Denver', () => {
    renderList([dose('Lisinopril', '13:00:00')], 'America/Denver');
    expect(screen.getByText('Lisinopril')).toBeInTheDocument();
    expect(hasTaken('Lisinopril')).toBe(false);
  });

  it('the same 13:00 dose IS open for a New York recipient (control)', () => {
    renderList([dose('Lisinopril', '13:00:00')], 'America/New_York');
    expect(hasTaken('Lisinopril')).toBe(true);
  });

  it('NEGATIVE a view-only member gets no Taken on an overdue dose', () => {
    renderList([dose('Atorvastatin', '08:00:00')], 'America/New_York', false);
    expect(screen.getByText('Atorvastatin')).toBeInTheDocument();
    expect(hasTaken('Atorvastatin')).toBe(false);
  });
});

// Re-homed from medsZoneReference.test.tsx (hosted on the dead TodaysMeds): a dose's zone label is judged against
// ITS OWN day, not against today. Across 2026-03-08 (US spring-forward) a Phoenix viewer of a Denver recipient
// sees one clock on the 7th (no label) and two on the 8th (label). Live host: NextUp rows (yesterday's backlog
// dose beside today's), `zoneReferenceInstant(item.date)`.

import { render, screen, within } from '@testing-library/react';
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

const RECIPIENT_TZ = 'America/Denver';
const VIEWER_TZ = 'America/Phoenix';
// 2026-03-08T19:00:00Z = 1:00 PM MDT in Denver on the day the clocks moved.
const NOW = new Date('2026-03-08T19:00:00Z');
const TODAY = '2026-03-08';
const YESTERDAY = '2026-03-07';

const dose = (id: string, date: string): NextUpItem => ({
  key: `medication:${id}`,
  type: 'medication',
  id,
  title: `Warfarin ${id}`,
  detail: null,
  time: '14:00:00',
  date,
  late: false,
  lateHours: null,
  med: { id, event_type: 'medication', title: 'Warfarin', scheduled_date: date, scheduled_time: '14:00:00' } as NextUpItem['med'],
});

function pinDeviceTimezone(timeZone: string) {
  vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({
    timeZone,
  } as Intl.ResolvedDateTimeFormatOptions);
}

function renderList() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <ToastProvider>
          <NextUp
            circleId="c1"
            timezone={RECIPIENT_TZ}
            recipientName="Mom"
            isSelfCare={false}
            canEdit
            items={[dose('yesterday', YESTERDAY), dose('today', TODAY)]}
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

const row = (name: string): HTMLElement => {
  const li = screen.getByText(name).closest('li');
  if (!li) throw new Error(`row for ${name} not found`);
  return li;
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: NOW });
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('NextUp zone label against the dose\'s own day', () => {
  it('labels today\'s dose and leaves yesterday\'s bare across a DST transition', () => {
    pinDeviceTimezone(VIEWER_TZ);
    renderList();
    expect(within(row('Warfarin today')).getByText(/2:00 PM \(Denver\)/)).toBeInTheDocument();
    const yesterdayRow = row('Warfarin yesterday');
    expect(within(yesterdayRow).getByText(/2:00 PM/)).toBeInTheDocument();
    // NEGATIVE: judged at "now" this row would be labelled too.
    expect(within(yesterdayRow).queryByText(/\(Denver\)/)).not.toBeInTheDocument();
  });

  it('NEGATIVE leaves both doses bare for a viewer in the recipient\'s own zone', () => {
    pinDeviceTimezone(RECIPIENT_TZ);
    renderList();
    expect(screen.getByText('Warfarin today')).toBeInTheDocument();
    expect(screen.queryByText(/\(Denver\)/)).not.toBeInTheDocument();
  });
});

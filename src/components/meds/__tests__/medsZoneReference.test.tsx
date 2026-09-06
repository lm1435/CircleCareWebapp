import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Mock } from 'vitest';
import '@/i18n';
import { apiClient } from '@/lib/api';
import { ToastProvider } from '@/components/ui';
import { TodaysMeds } from '@/components/meds/TodaysMeds';
import { ConfirmMedDialog } from '../ConfirmMedDialog';
import type { Circle } from '@/api/circles';
import type { TodaysMedication } from '@/api/medicationConfirmations';

// Only the MUTATION is stubbed — `useTodaysMeds` beside it is what feeds the
// widget, and must stay real.
vi.mock('@/hooks/useMedConfirmation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/hooks/useMedConfirmation')>()),
  useConfirmMedication: () => ({ mutate: vi.fn(), isPending: false }),
}));

// The viewer's 12h/24h clock — pinned so the rendered digits never depend on
// the runner's navigator.language.
vi.mock('@/hooks/useHourCycle', () => ({
  useHourCycle: () => '12h',
}));

// ---------------------------------------------------------------------------
// A DOSE IS LABELLED AGAINST ITS OWN DAY, NOT AGAINST TODAY.
//
// Every other surface passes `zoneReferenceInstant(<the row's own date>)` into
// `formatEventTimeCompact`; the two medication surfaces did not, so their zone
// label was judged at `new Date()`.
//
// The window where that is wrong is narrow and completely real: the day AFTER a
// DST transition, which is exactly when the "Needs attention" group is showing
// YESTERDAY's unanswered dose beside today's. America/Phoenix does not observe
// DST and America/Denver does, so across the 2026-03-08 spring-forward:
//
//   2026-03-07 (Sat)  Denver MST = UTC-7  = Phoenix  -> one clock, NO label
//   2026-03-08 (Sun)  Denver MDT = UTC-6 != Phoenix  -> two clocks, label
//
// Judged at "now" both doses read the same way. Judged at their own dates they
// disagree, and the disagreement is the correct answer.
//
// TIME IS PINNED THE SAME TWO WAYS AS TodaysMeds.test.tsx, and the `toFake`
// list is load-bearing: vitest's DEFAULT `vi.useFakeTimers()` replaces the
// global `Intl.DateTimeFormat`, which silently kills the `resolvedOptions` spy
// and reverts `getDeviceTimezone()` to the real machine zone. `toFake: ['Date']`
// freezes the clock without touching Intl.
// ---------------------------------------------------------------------------

const CIRCLE_ID = 'circle-1';
const RECIPIENT_TZ = 'America/Denver';
const VIEWER_TZ = 'America/Phoenix';
// 2026-03-08T19:00:00Z = 1:00 PM MDT in Denver on the day the clocks moved.
const NOW = new Date('2026-03-08T19:00:00Z');
const TODAY = '2026-03-08';
const YESTERDAY = '2026-03-07';

const mockedGet = apiClient.get as unknown as Mock;

function makeMed(id: string, scheduled_date: string): TodaysMedication {
  return {
    id,
    event_type: 'medication',
    title: 'Warfarin',
    medication_name: `Warfarin ${id}`,
    medication_dosage: null,
    scheduled_date,
    // 14:00 sits well clear of the 02:00 transition itself, so nothing here
    // depends on how the gap hour resolves.
    scheduled_time: '14:00:00',
    confirmation: null,
  } as TodaysMedication;
}

function mockApi(): void {
  mockedGet.mockImplementation((url: string, config?: { params?: { start_date?: string } }) => {
    if (url === '/circles') {
      return Promise.resolve({
        success: true,
        data: {
          circles: [
            {
              id: CIRCLE_ID,
              name: 'Mom',
              recipient_name: 'Mom',
              role: 'member',
              access_level: 'edit',
              can_edit: true,
              view_only: false,
              read_only: false,
            } as unknown as Circle,
          ],
        },
      });
    }
    if (url === `/circles/${CIRCLE_ID}`) {
      return Promise.resolve({
        success: true,
        data: { circle: { id: CIRCLE_ID, care_recipient_timezone: RECIPIENT_TZ } },
      });
    }
    if (url === `/circles/${CIRCLE_ID}/events`) {
      const forYesterday = config?.params?.start_date === YESTERDAY;
      return Promise.resolve({
        success: true,
        data: {
          events: forYesterday ? [makeMed('yesterday', YESTERDAY)] : [makeMed('today', TODAY)],
        },
      });
    }
    return Promise.reject(new Error(`unexpected GET ${url}`));
  });
}

function pinDeviceTimezone(timeZone: string) {
  vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({
    timeZone,
  } as Intl.ResolvedDateTimeFormatOptions);
}

function renderWidget() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <TodaysMeds circleId={CIRCLE_ID} />
        </ToastProvider>
      </QueryClientProvider>
    </MemoryRouter>
  );
}

function medRow(name: string): HTMLElement {
  const row = screen.getByText(name).closest('li');
  if (!row) throw new Error(`list item for ${name} not found`);
  return row;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: NOW });
  mockedGet.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('TodaysMeds', () => {
  it('labels today’s dose and leaves yesterday’s bare across a DST transition', async () => {
    pinDeviceTimezone(VIEWER_TZ);
    mockApi();
    renderWidget();

    expect(await screen.findByText('Warfarin today')).toBeInTheDocument();
    expect(await screen.findByText('Warfarin yesterday')).toBeInTheDocument();

    // Denver is an hour off Phoenix on the 8th, so today's dose has to say so.
    expect(within(medRow('Warfarin today')).getByText(/2:00 PM \(Denver\)/)).toBeInTheDocument();

    // On the 7th the two were one clock, and a label answers a question nobody
    // asked. Judged at "now" this row would be labelled too.
    const yesterdayRow = medRow('Warfarin yesterday');
    expect(within(yesterdayRow).getByText(/2:00 PM/)).toBeInTheDocument();
    expect(within(yesterdayRow).queryByText(/\(Denver\)/)).not.toBeInTheDocument();
  });

  it('leaves both doses bare for a viewer in the recipient’s own zone', async () => {
    pinDeviceTimezone(RECIPIENT_TZ);
    mockApi();
    renderWidget();

    expect(await screen.findByText('Warfarin today')).toBeInTheDocument();
    expect(await screen.findByText('Warfarin yesterday')).toBeInTheDocument();
    expect(screen.queryByText(/\(Denver\)/)).not.toBeInTheDocument();
  });
});

describe('ConfirmMedDialog heading', () => {
  function renderDialog(med: TodaysMedication) {
    return render(
      <ToastProvider>
        <ConfirmMedDialog
          source="care_profile"
          circleId={CIRCLE_ID}
          med={med}
          careRecipientTimezone={RECIPIENT_TZ}
          onClose={vi.fn()}
        />
      </ToastProvider>
    ).container;
  }

  it('judges the label against the day being confirmed', () => {
    // This matters more here than on the card: the dialog prints a day label
    // ("Yesterday") immediately beside the time, so a zone label resolved
    // against today contradicts the very day the sentence names.
    pinDeviceTimezone(VIEWER_TZ);

    const today = renderDialog(makeMed('today', TODAY));
    const yesterday = renderDialog(makeMed('yesterday', YESTERDAY));

    expect(within(today).getByText(/2:00 PM \(Denver\)/)).toBeInTheDocument();
    expect(within(yesterday).queryByText(/\(Denver\)/)).not.toBeInTheDocument();
  });
});

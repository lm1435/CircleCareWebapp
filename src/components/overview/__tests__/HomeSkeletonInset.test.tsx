import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Mock } from 'vitest';
import '@/i18n';
import { apiClient } from '@/lib/api';
import { ToastProvider } from '@/components/ui';
import { TodaysMeds } from '@/components/meds/TodaysMeds';
import { TaskRow } from '@/components/tasks/TaskRow';
import type { CalendarEvent } from '@/api/calendarEvents';
import { AdherenceCard, ADHERENCE_SHEET_PADDING } from '../AdherenceCard';
import { CareCardSkeleton } from '@/components/ui/Skeleton';
import { careCardShell } from '@/components/ui/careCard';
import { useWeeklyAdherence } from '@/hooks/useMedConfirmation';
import type { WeeklyAdherence } from '@/api/medicationConfirmations';

/**
 * HOME'S LOADING CARDS HAVE THE LOADED CARDS' INSET (owner report 2026-10-17,
 * mobile; web brought to parity). jsdom computes no Tailwind CSS, so this pins
 * the CLASS TOKENS; e2e/home-skeleton-inset.spec.ts measures the real pixels.
 */
vi.mock('@/hooks/useMedConfirmation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/hooks/useMedConfirmation')>()),
  useWeeklyAdherence: vi.fn(),
}));
vi.mock('@/hooks/useHourCycle', () => ({ useHourCycle: () => '12h' }));
const mockUseWeeklyAdherence = vi.mocked(useWeeklyAdherence);

function classes(el: HTMLElement): string[] {
  return el.className.split(/\s+/).filter(Boolean);
}

function setQuery(isLoading: boolean): void {
  mockUseWeeklyAdherence.mockReturnValue({
    data: isLoading
      ? undefined
      : ({
          taken: 12,
          scheduled: 14,
          adherence_rate: 86,
          start_date: '2026-08-30',
          end_date: '2026-09-05',
          daily_breakdown: [],
        } as WeeklyAdherence),
    isLoading,
    isError: false,
  } as unknown as ReturnType<typeof useWeeklyAdherence>);
}

describe('Home skeleton insets', () => {
  it('a care-card placeholder is drawn in the real care card shell (14px inset, 1.5px border)', () => {
    render(<CareCardSkeleton action="dose" />);
    const card = screen.getByTestId('care-card-skeleton');
    for (const token of careCardShell.split(' ')) expect(classes(card)).toContain(token);
    expect(classes(card)).toContain('p-3.5');
  });

  it('the adherence placeholder and the loaded adherence card share one inset', () => {
    setQuery(true);
    const { unmount } = render(<AdherenceCard circleId="c1" />);
    const skeleton = screen.getByTestId('adherence-skeleton');
    for (const token of ADHERENCE_SHEET_PADDING.split(' ')) expect(classes(skeleton)).toContain(token);
    unmount();

    setQuery(false);
    render(<AdherenceCard circleId="c1" />);
    const loaded = screen.getByTestId('adherence-card');
    for (const token of ADHERENCE_SHEET_PADDING.split(' ')) expect(classes(loaded)).toContain(token);
    expect(ADHERENCE_SHEET_PADDING).toBe('px-[22px] py-[22px]');
  });
});

/**
 * THE SKELETON'S ACTION AREA IS THE REAL CARD'S (owner report 2026-10-17: the
 * loading dose card drew one FULL-WIDTH pill under the text; the loaded card
 * puts Skip / Confirm INLINE at the end of the meta line).
 *
 * Compared against the REAL cards rendered here: the same two slots (inline
 * inside the meta line / content row, stacked row as the card's last child)
 * under the same container-query classes, the same count, and the same pill
 * box (size floor, padding, radius). Fill/colour tokens are the only thing a
 * placeholder is allowed to differ on.
 */
describe('CareCardSkeleton action area matches the real card', () => {
  // Fill, colour and press feedback: what a placeholder legitimately swaps.
  const LOOK = /^(bg-|text-(?!left|right|center)|transition|duration-|ease-|active:|cc-shimmer)/;
  const layout = (el: Element) => classes(el as HTMLElement).filter((c) => !LOOK.test(c)).sort();

  const CIRCLE_ID = 'circle-1';
  const TODAY = '2026-06-12';
  const mockedGet = apiClient.get as unknown as Mock;

  async function renderRealDoseCard(): Promise<HTMLElement> {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-06-12T16:00:00Z'));
    const med = {
      id: 'med-3',
      event_type: 'medication',
      title: 'Medication',
      medication_name: 'Atorvastatin',
      medication_dosage: '10 mg',
      scheduled_date: TODAY,
      scheduled_time: '10:00:00',
      confirmation: null,
    };
    mockedGet.mockImplementation((url: string, config?: { params?: { start_date?: string } }) => {
      if (url === '/circles')
        return Promise.resolve({
          success: true,
          data: { circles: [{ id: CIRCLE_ID, name: 'Mom', can_edit: true, access_level: 'edit', role: 'member' }] },
        });
      if (url === `/circles/${CIRCLE_ID}`)
        return Promise.resolve({
          success: true,
          data: { circle: { id: CIRCLE_ID, care_recipient_timezone: 'America/New_York' } },
        });
      if (url === `/circles/${CIRCLE_ID}/events/presence`)
        return Promise.resolve({ success: true, data: { medication: true, appointment: false, task: false } });
      if (url === `/circles/${CIRCLE_ID}/events`)
        return Promise.resolve({
          success: true,
          data: { events: config?.params?.start_date === TODAY ? [med] : [] },
        });
      return Promise.reject(new Error(`unexpected GET ${url}`));
    });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <MemoryRouter>
        <QueryClientProvider client={queryClient}>
          <ToastProvider>
            <TodaysMeds circleId={CIRCLE_ID} />
          </ToastProvider>
        </QueryClientProvider>
      </MemoryRouter>
    );
    const card = (await screen.findByText('Atorvastatin')).closest('li');
    if (!card) throw new Error('dose card not found');
    return card;
  }
  afterEach(() => vi.useRealTimers());

  it('dose: Skip + Confirm INLINE on the meta line (stacked row only under 360px), like TodaysMeds', async () => {
    const real = await renderRealDoseCard();
    const realButtons = Array.from(real.querySelectorAll('button')).filter((b) =>
      /Atorvastatin/.test(b.getAttribute('aria-label') ?? '')
    );
    // The real pair renders twice: inline slot + stacked row.
    expect(realButtons).toHaveLength(4);
    const [realSkip, realTake] = realButtons;
    const realInline = realSkip.parentElement!;
    const realRow = realButtons[2].parentElement!;
    expect(realRow.parentElement).toBe(real);

    render(<CareCardSkeleton action="dose" />);
    const sk = screen.getByTestId('care-card-skeleton');
    // The defect: no full-width placeholder anywhere in the card.
    expect(sk.querySelectorAll('.w-full')).toHaveLength(0);

    const inline = screen.getByTestId('care-card-skeleton-actions-inline');
    const row = screen.getByTestId('care-card-skeleton-actions-row');
    // Same slots, same container-query visibility rules, same placement.
    expect(classes(inline)).toEqual(classes(realInline));
    expect(classes(inline.parentElement!)).toEqual(classes(realInline.parentElement!));
    expect(classes(row)).toEqual(classes(realRow));
    expect(row.parentElement).toBe(sk);
    // Same count, same order, same box per action.
    expect(inline.children).toHaveLength(2);
    expect(row.children).toHaveLength(2);
    for (const slot of [inline, row]) {
      expect(layout(slot.children[0])).toEqual(layout(realSkip));
      expect(layout(slot.children[1])).toEqual(layout(realTake));
    }
    expect(layout(realTake)).toEqual(expect.arrayContaining(['min-h-[44px]', 'min-w-[88px]', 'rounded-full']));
  });

  it('task: ONE Done pill trailing the content row (stacked row only under 360px), like TaskRow', () => {
    render(
      <ToastProvider>
        <TaskRow
          task={{
            id: 'task-1',
            circle_id: 'circle-1',
            title: 'Refill pill box',
            event_type: 'task',
            scheduled_date: '2026-10-01',
            scheduled_time: '12:00:00',
            status: 'open',
            assigned_to: null,
            created_at: '2026-01-01T00:00:00Z',
            updated_at: '2026-01-01T00:00:00Z',
          } as CalendarEvent}
          timezone="America/Denver"
          canEdit
          members={[]}
          onComplete={vi.fn()}
          onUndo={vi.fn()}
          onEdit={vi.fn()}
          isPendingComplete={false}
        />
      </ToastProvider>
    );
    const dones = screen.getAllByRole('button', { name: 'Mark "Refill pill box" complete' });
    expect(dones).toHaveLength(2);
    const realInline = dones[0].parentElement!;
    const realRow = dones[1].parentElement!;
    const realCard = realRow.parentElement!;
    expect(realInline.parentElement!.parentElement).toBe(realCard);

    render(<CareCardSkeleton action="task" />);
    const inline = screen.getByTestId('care-card-skeleton-actions-inline');
    const row = screen.getByTestId('care-card-skeleton-actions-row');
    expect(classes(inline)).toEqual(classes(realInline));
    expect(classes(row)).toEqual(classes(realRow));
    // Trailing slot of the content row, not inside the text column.
    expect(classes(inline.parentElement!)).toEqual(classes(realInline.parentElement!));
    expect(inline.parentElement!.parentElement).toBe(screen.getByTestId('care-card-skeleton'));
    for (const slot of [inline, row]) {
      expect(slot.children).toHaveLength(1);
      expect(layout(slot.children[0])).toEqual(layout(dones[0]));
    }
  });

  it('no action → no action area (a view-only card has none)', () => {
    render(<CareCardSkeleton />);
    expect(screen.queryByTestId('care-card-skeleton-actions-inline')).toBeNull();
    expect(screen.queryByTestId('care-card-skeleton-actions-row')).toBeNull();
  });
});

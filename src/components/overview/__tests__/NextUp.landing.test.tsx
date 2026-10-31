import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@/i18n';
import { NextUp, LANDING_HIGHLIGHT_MS } from '../NextUp';
import { ToastProvider } from '@/components/ui/Toast';
import { useMedicationUndo } from '@/components/meds/useMedicationUndo';
import { useTaskCompletion } from '@/hooks/useTaskCompletion';
import { Analytics } from '@/lib/analytics';
import type { NextUpItem } from '../nextUpItems';
import { getDateInTimezone } from '@/utils/timezone';

// A notification (web: an inbox row) landed on ONE dose row of Today: it is shown even past
// the first 3, scrolled to, highlighted for a moment, focused, announced, and its Taken press
// carries entry:'inbox' on medication_confirmed.

vi.mock('@/components/meds/useMedicationUndo', () => ({ useMedicationUndo: vi.fn() }));
vi.mock('@/hooks/useTaskCompletion', () => ({ useTaskCompletion: vi.fn() }));

const TZ = 'America/Denver';
const TODAY = getDateInTimezone(TZ);
const confirm = vi.fn();
const scrollIntoView = vi.fn();

const dose = (id: string): NextUpItem => ({
  key: `medication:${id}`,
  type: 'medication',
  id,
  title: `Med ${id}`,
  detail: '10mg',
  time: '00:00:00',
  date: TODAY,
  late: true,
  lateHours: null,
  med: { id, event_type: 'medication', title: `Med ${id}`, scheduled_date: TODAY, scheduled_time: '00:00:00' } as NextUpItem['med'],
});

const ITEMS = ['1', '2', '3', '4', '5'].map(dose);

function renderNextUp(over: Partial<React.ComponentProps<typeof NextUp>> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ToastProvider>
          <NextUp
            circleId="c1"
            timezone={TZ}
            recipientName="Mom"
            isSelfCare={false}
            canEdit
            items={ITEMS}
            loading={false}
            error={false}
            onRetry={vi.fn()}
            stacked={false}
            {...over}
          />
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

const rowOf = (n: string): HTMLElement =>
  screen.getAllByTestId('next-up-row').find((r) => r.dataset.nextUpKey === `medication:${n}`)!;

describe('NextUp landing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Element.prototype.scrollIntoView = scrollIntoView;
    vi.mocked(useMedicationUndo).mockImplementation(
      () =>
        ({ pending: {}, confirm, undo: vi.fn(), hold: vi.fn() }) as unknown as ReturnType<typeof useMedicationUndo>
    );
    vi.mocked(useTaskCompletion).mockImplementation(
      () =>
        ({
          pendingIds: new Set(),
          handleComplete: vi.fn(),
          handleUndo: vi.fn(),
          handleHoldUndo: vi.fn(),
          flushPending: vi.fn(),
        }) as unknown as ReturnType<typeof useTaskCompletion>
    );
    vi.spyOn(Analytics, 'nextUpAction').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.useRealTimers();
    // @ts-expect-error restore jsdom default (no scrollIntoView)
    delete Element.prototype.scrollIntoView;
  });

  it('brings a 4th row into view, highlights it, focuses its Taken button and announces why', () => {
    renderNextUp({ landing: { key: 'medication:4', entry: 'inbox' } });
    // Past the first three, but rendered; the 5th stays folded.
    expect(screen.getAllByTestId('next-up-row')).toHaveLength(4);
    expect(screen.queryByText('Med 5')).not.toBeInTheDocument();

    const target = rowOf('4');
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView.mock.instances[0]).toBe(target);
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'center', behavior: 'smooth' });
    expect(target.querySelector('[data-highlighted="true"]')).not.toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /^Taken, Med 4/ }));
    expect(screen.getByRole('status')).toHaveTextContent("This dose hasn't been marked yet.");
    // Only the landed row is marked.
    expect(document.querySelectorAll('[data-highlighted="true"]')).toHaveLength(1);
  });

  it('the highlight is temporary', () => {
    vi.useFakeTimers();
    renderNextUp({ landing: { key: 'medication:2', entry: 'inbox' } });
    expect(document.querySelectorAll('[data-highlighted="true"]')).toHaveLength(1);
    act(() => {
      vi.advanceTimersByTime(LANDING_HIGHLIGHT_MS + 10);
    });
    expect(document.querySelectorAll('[data-highlighted="true"]')).toHaveLength(0);
    expect(screen.getByRole('status')).toHaveTextContent('');
  });

  it('prefers-reduced-motion: no smooth scroll', () => {
    const original = window.matchMedia;
    window.matchMedia = ((q: string) => ({
      matches: q.includes('reduce'),
      media: q,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      onchange: null,
      dispatchEvent: vi.fn(),
    })) as unknown as typeof window.matchMedia;
    try {
      renderNextUp({ landing: { key: 'medication:1', entry: 'inbox' } });
      expect(scrollIntoView).toHaveBeenCalledWith({ block: 'center', behavior: 'auto' });
    } finally {
      window.matchMedia = original;
    }
  });

  it('view-only: the row is highlighted and its link is focused; no Taken button is added', () => {
    renderNextUp({ canEdit: false, landing: { key: 'medication:2', entry: 'inbox' } });
    expect(screen.queryByRole('button', { name: /^Taken/ })).not.toBeInTheDocument();
    expect(rowOf('2').querySelector('[data-highlighted="true"]')).not.toBeNull();
    expect(document.activeElement).toBe(rowOf('2').querySelector('a'));
  });

  it('Taken on the landed row sends entry inbox; on any other row it does not', async () => {
    const user = userEvent.setup();
    renderNextUp({ landing: { key: 'medication:2', entry: 'inbox' } });
    await user.click(screen.getByRole('button', { name: /^Taken, Med 2/ }));
    expect(confirm).toHaveBeenLastCalledWith(expect.objectContaining({ id: '2' }), 'taken', {
      entry: 'inbox',
    });
    await user.click(screen.getByRole('button', { name: /^Taken, Med 1/ }));
    expect(confirm).toHaveBeenLastCalledWith(expect.objectContaining({ id: '1' }), 'taken');
    expect(confirm.mock.calls[1]).toHaveLength(2);
  });

  it('a normal Taken press (no landing) carries no entry', async () => {
    const user = userEvent.setup();
    renderNextUp();
    await user.click(screen.getByRole('button', { name: /^Taken, Med 1/ }));
    expect(confirm.mock.calls[0]).toHaveLength(2);
    expect(scrollIntoView).not.toHaveBeenCalled();
    expect(document.querySelectorAll('[data-highlighted="true"]')).toHaveLength(0);
  });

  it('a landing for a row that is not in the list does nothing', () => {
    renderNextUp({ landing: { key: 'medication:zzz', entry: 'inbox' } });
    expect(scrollIntoView).not.toHaveBeenCalled();
    expect(screen.getAllByTestId('next-up-row')).toHaveLength(3);
  });
});

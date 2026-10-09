// WCAG 2.2.1 on web, for EVERY delayed write behind an UndoBadge: dose marks
// (useMedicationUndo), as-needed doses (useAsNeededUndo) and task completion
// (useTaskCompletion). A held countdown (badge hovered / keyboard-focused)
// does not commit; releasing it resumes with the time that was left; the write
// goes out only when the timer actually runs out. Undo still cancels, and the
// existing flushes (pagehide, document hidden, unmount) still send at once,
// held or not. The 5 s base is unchanged.

import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import type { Mock } from 'vitest';
import { apiClient } from '@/lib/api';
import { ToastProvider } from '@/components/ui';
import { MEDICATION_UNDO_DELAY_MS, useMedicationUndo } from '@/components/meds/useMedicationUndo';
import { useAsNeededUndo } from '@/components/meds/useAsNeededUndo';
import { UNDO_DELAY_MS, useTaskCompletion } from '@/hooks/useTaskCompletion';
import type { TodaysMedication } from '@/api/medicationConfirmations';
import type { CalendarEvent } from '@/api/calendarEvents';

const post = apiClient.post as unknown as Mock;

const MED = {
  id: 'med-1',
  event_type: 'medication',
  title: 'Metformin',
  medication_name: 'Metformin',
  medication_dosage: '5 mg',
  scheduled_date: '2026-09-05',
  scheduled_time: '08:00:00',
  confirmation: null,
} as unknown as TodaysMedication;

const TASK = {
  id: 'task-1',
  circle_id: 'c1',
  event_type: 'task',
  title: 'Water plants',
  scheduled_date: '2026-03-15',
  scheduled_time: null,
  completed_at: null,
  assigned_to: null,
  created_at: '2026-03-01T00:00:00Z',
  updated_at: '2026-03-01T00:00:00Z',
} as unknown as CalendarEvent;

interface Surface {
  name: string;
  mount: () => { result: { current: unknown }; unmount: () => void };
  start: (r: any) => void;
  hold: (r: any, held: boolean) => void;
  undo: (r: any) => void;
}

const SURFACES: Surface[] = [
  {
    name: 'dose mark (useMedicationUndo)',
    mount: () => renderHook(() => useMedicationUndo({ circleId: 'c1', source: 'care_profile' }), { wrapper }),
    start: (r) => r.confirm(MED, 'taken'),
    hold: (r, held) => r.hold('med-1', held),
    undo: (r) => r.undo('med-1'),
  },
  {
    name: 'as-needed dose (useAsNeededUndo)',
    mount: () => renderHook(() => useAsNeededUndo({ circleId: 'c1' }), { wrapper }),
    start: (r) =>
      r.log({
        eventId: 'prn-1',
        name: 'Ibuprofen',
        body: { client_request_id: '5b1c8c0e-3e1f-4a43-9f43-0d2c1f3d9a11', note: null, known_last_dose_id: null },
      }),
    hold: (r, held) => r.hold('prn-1', held),
    undo: (r) => r.undo('prn-1'),
  },
  {
    name: 'task completion (useTaskCompletion)',
    mount: () => renderHook(() => useTaskCompletion('c1'), { wrapper }),
    start: (r) => r.handleComplete(TASK),
    hold: (r, held) => r.handleHoldUndo('task-1', held),
    undo: (r) => r.handleUndo('task-1'),
  },
];

let qc: QueryClient;
function wrapper({ children }: { children: ReactNode }) {
  return (
    <MemoryRouter>
      <QueryClientProvider client={qc}>
        <ToastProvider>{children}</ToastProvider>
      </QueryClientProvider>
    </MemoryRouter>
  );
}

const sent = (): number => post.mock.calls.length;
/** Run the clock forward, then let the mutation's microtasks reach `apiClient.post`. */
const advance = async (ms: number): Promise<void> => {
  await act(async () => {
    vi.advanceTimersByTime(ms);
    for (let i = 0; i < 10; i++) await Promise.resolve();
  });
};
const settle = (): Promise<void> => advance(0);

function setVisibility(state: DocumentVisibilityState): void {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
  document.dispatchEvent(new Event('visibilitychange'));
}

beforeEach(() => {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  post.mockReset();
  post.mockResolvedValue({ success: true, data: {} });
  vi.useFakeTimers();
});
afterEach(() => {
  setVisibility('visible');
  vi.useRealTimers();
});

it('keeps the 5 s base on every surface', () => {
  expect(MEDICATION_UNDO_DELAY_MS).toBe(5000);
  expect(UNDO_DELAY_MS).toBe(5000);
});

describe.each(SURFACES)('$name', (surface) => {
  it('commits at 5 s when never held', async () => {
    const { result } = surface.mount();
    act(() => surface.start(result.current));
    await advance(4999);
    expect(sent()).toBe(0);
    await advance(1);
    expect(sent()).toBe(1);
  });

  it('a hold pauses the countdown; release resumes it with the time left, and it commits at expiry', async () => {
    const { result } = surface.mount();
    act(() => surface.start(result.current));
    await advance(2000);
    act(() => surface.hold(result.current, true));
    await advance(60000);
    expect(sent()).toBe(0);
    act(() => surface.hold(result.current, false));
    await advance(2999);
    expect(sent()).toBe(0);
    await advance(1);
    expect(sent()).toBe(1);
  });

  it('Undo while held cancels: nothing is ever sent', async () => {
    const { result } = surface.mount();
    act(() => surface.start(result.current));
    act(() => surface.hold(result.current, true));
    await advance(30000);
    act(() => surface.undo(result.current));
    act(() => surface.hold(result.current, false));
    await advance(60000);
    expect(sent()).toBe(0);
  });

  it('pagehide while held still flushes at once, and only once', async () => {
    const { result } = surface.mount();
    act(() => surface.start(result.current));
    act(() => surface.hold(result.current, true));
    await advance(1000);
    act(() => {
      window.dispatchEvent(new Event('pagehide'));
    });
    await settle();
    expect(sent()).toBe(1);
    act(() => surface.hold(result.current, false));
    await advance(60000);
    expect(sent()).toBe(1);
  });

  it('the document going hidden while held still flushes at once', async () => {
    const { result } = surface.mount();
    act(() => surface.start(result.current));
    act(() => surface.hold(result.current, true));
    act(() => setVisibility('hidden'));
    await settle();
    expect(sent()).toBe(1);
  });

  it('unmount while held still flushes at once', async () => {
    const { result, unmount } = surface.mount();
    act(() => surface.start(result.current));
    act(() => surface.hold(result.current, true));
    unmount();
    await settle();
    expect(sent()).toBe(1);
  });
});

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '@/i18n';
import { QuickAccess } from '../QuickAccess';
import { useTasks } from '@/hooks/useTasks';
import { useCareNotes } from '@/hooks/useCareNotes';
import { useCalendarEvents, useEventsPresence } from '@/hooks/useCalendarEvents';

// N10: QuickAccess (a `useCareNotes` consumer) must never mark a note as seen.

const mockMark = vi.fn();
vi.mock('@/api/careNotes', async () => {
  const actual = await vi.importActual<typeof import('@/api/careNotes')>('@/api/careNotes');
  return { ...actual, markCareNotesSeen: (...a: unknown[]) => mockMark(...a) };
});
vi.mock('@/hooks/useTasks', () => ({ useTasks: vi.fn() }));
vi.mock('@/hooks/useCareNotes', () => ({ useCareNotes: vi.fn() }));
vi.mock('@/hooks/useCalendarEvents', () => ({
  useCalendarEvents: vi.fn(),
  useEventsPresence: vi.fn(),
}));
vi.mock('@/lib/analytics', () => ({ Analytics: { quickAccessTapped: vi.fn() } }));

describe('QuickAccess never marks notes seen', () => {
  it('N10: even with every observed element reported fully visible, no POST and no observer', async () => {
    vi.useFakeTimers();
    const ctor = vi.fn();
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(cb: IntersectionObserverCallback) {
          ctor(cb);
        }
        observe = vi.fn();
        unobserve = vi.fn();
        disconnect = vi.fn();
      }
    );
    vi.mocked(useTasks).mockReturnValue({ data: { tasks: [], total: 0 } } as never);
    vi.mocked(useCalendarEvents).mockReturnValue({ data: [], events: [] } as never);
    vi.mocked(useEventsPresence).mockReturnValue({
      data: { medication: false, appointment: false, task: false },
      isSuccess: true,
      isPending: false,
      isError: false,
    } as never);
    vi.mocked(useCareNotes).mockReturnValue({
      data: {
        today: '2026-03-15',
        timezone: 'America/Denver',
        notes: [
          {
            id: '00000000-0000-4000-8000-000000000001',
            circle_id: 'c1',
            author_id: 'someone-else',
            note_date: '2026-03-15',
            body: 'hi',
            mood: null,
            categories: [],
            created_at: '2026-03-15T14:00:00Z',
            updated_at: '2026-03-15T14:00:00Z',
            author: null,
          },
        ],
      },
    } as never);
    try {
      render(
        <MemoryRouter>
          <QuickAccess circleId="c1" timezone="America/Denver" showShiftsLink={false} stacked={false} />
        </MemoryRouter>
      );
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000);
      });
      expect(ctor).not.toHaveBeenCalled();
      expect(mockMark).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });

  it('N10b: the shared hooks file (useCareNotes) knows nothing of marking', () => {
    const src = readFileSync(resolve(process.cwd(), 'src/hooks/useCareNotes.ts'), 'utf8');
    expect(src).not.toMatch(/markCareNotesSeen|useMarkCareNotesSeen/);
  });
});

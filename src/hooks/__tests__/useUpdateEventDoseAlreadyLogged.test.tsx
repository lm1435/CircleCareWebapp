import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import en from '@/i18n/en/calendar.json';
import es from '@/i18n/es/calendar.json';

// Scenario E9: editing the TIME of a dose that was already logged is refused by
// the backend with 409 DOSE_ALREADY_LOGGED (backend/src/routes/calendarEvents.ts,
// PATCH /events/:id). The caregiver must be told exactly that — the time of a
// logged dose can't change — never the generic "Couldn't save, try again" copy,
// because a retry re-sends the same refused edit. The calendar is refetched so
// the screen shows the real (logged) state.

vi.mock('@/api/calendarEvents', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/calendarEvents')>();
  return { ...actual, updateEvent: vi.fn() };
});

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}));

const showToast = vi.fn();
vi.mock('@/components/ui', () => ({
  useToast: () => ({ showToast }),
}));

vi.mock('@/hooks/usePremiumGate', () => ({
  usePremiumGate: () => ({ promptUpgrade: vi.fn(), promptLapsed: vi.fn() }),
}));

import { updateEvent } from '@/api/calendarEvents';
import { queryKeys } from '@/lib/queryKeys';
import { useUpdateEvent } from '@/hooks/useCalendarEvents';

const CIRCLE_ID = 'circle-1';
const mockUpdate = vi.mocked(updateEvent);

function setup() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { invalidateSpy, wrapper };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('editing the time of a logged dose', () => {
  it('says the logged dose time cannot change (not the retry copy) and refetches the calendar', async () => {
    const { invalidateSpy, wrapper } = setup();
    // The envelope the backend sends; apiClient rejects with the body (err.error.code).
    mockUpdate.mockRejectedValue({
      success: false,
      error: {
        code: 'DOSE_ALREADY_LOGGED',
        message: "This dose has already been logged and its time can't be changed",
      },
    });

    const { result } = renderHook(() => useUpdateEvent(CIRCLE_ID), { wrapper });
    result.current.mutate({ eventId: 'child-1', data: { scheduled_time: '09:15' } });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(showToast).toHaveBeenCalledTimes(1);
    expect(showToast).toHaveBeenCalledWith('errors.doseAlreadyLogged', 'error');
    expect(showToast).not.toHaveBeenCalledWith('errors.saveFailed', 'error');
    expect(
      invalidateSpy.mock.calls.some(
        (call) => JSON.stringify(call[0]?.queryKey) === JSON.stringify(queryKeys.calendarEvents(CIRCLE_ID))
      )
    ).toBe(true);
  });

  it('a different 409 still gets the generic copy (the mapping keys on the code, not the status)', async () => {
    const { wrapper } = setup();
    mockUpdate.mockRejectedValue({ success: false, error: { code: 'CONFLICT', message: 'x' } });
    const { result } = renderHook(() => useUpdateEvent(CIRCLE_ID), { wrapper });
    result.current.mutate({ eventId: 'child-1', data: { scheduled_time: '09:15' } });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(showToast).not.toHaveBeenCalledWith('errors.doseAlreadyLogged', 'error');
  });

  it('the copy names the cause in EN and ES', () => {
    expect(en.errors.doseAlreadyLogged).toBe("This dose was already logged — its time can't be changed.");
    expect(es.errors.doseAlreadyLogged).toBe('Esta dosis ya fue registrada; su hora no se puede cambiar.');
  });
});

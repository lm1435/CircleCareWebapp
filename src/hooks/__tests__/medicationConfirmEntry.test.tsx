import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { Mock } from 'vitest';

// `entry` ('inbox') rides on medication_confirmed ONLY when a notification landed the person on
// the dose: threaded useMedicationUndo.confirm -> useConfirmMedication -> Analytics, and it
// never reaches the POST body.

vi.mock('@/components/ui', () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock('@/hooks/usePremiumGate', () => ({ usePremiumGate: () => ({ promptUpgrade: vi.fn() }) }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}));
vi.mock('@/lib/analytics', () => ({
  Analytics: { medicationConfirmed: vi.fn(), errorOccurred: vi.fn() },
}));

import { apiClient } from '@/lib/api';
import { Analytics } from '@/lib/analytics';
import { useMedicationUndo, MEDICATION_UNDO_DELAY_MS } from '@/components/meds/useMedicationUndo';
import type { TodaysMedication } from '@/api/medicationConfirmations';

const get = apiClient.get as unknown as Mock;
const post = apiClient.post as unknown as Mock;

const MED = {
  id: 'med-1',
  event_type: 'medication',
  title: 'Metformin',
  scheduled_date: '2026-09-05',
  scheduled_time: '08:00:00',
  confirmation: null,
} as TodaysMedication;

function setup() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return renderHook(() => useMedicationUndo({ circleId: 'c1', source: 'care_profile' }), { wrapper });
}

async function fire(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(MEDICATION_UNDO_DELAY_MS);
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(0);
  });
}

beforeEach(() => {
  vi.mocked(Analytics.medicationConfirmed).mockClear();
  get.mockReset();
  post.mockReset();
  get.mockResolvedValue({ success: true, data: [] });
  post.mockResolvedValue({ success: true, data: { confirmation: { id: 'x', event_id: 'med-1' } } });
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

describe('medication_confirmed entry', () => {
  it('a confirm landed from the inbox sends entry inbox, and the POST body has no entry', async () => {
    const { result } = setup();
    act(() => result.current.confirm(MED, 'taken', { entry: 'inbox' }));
    await fire();
    expect(Analytics.medicationConfirmed).toHaveBeenCalledWith('c1', 'taken', 'care_profile', 'inbox');
    expect(post.mock.calls[0][1]).toEqual({
      event_id: 'med-1',
      status: 'taken',
      scheduled_time: '08:00:00',
    });
  });

  it('an ordinary confirm sends no entry argument at all', async () => {
    const { result } = setup();
    act(() => result.current.confirm(MED, 'taken'));
    await fire();
    expect(Analytics.medicationConfirmed).toHaveBeenCalledWith('c1', 'taken', 'care_profile');
    expect(vi.mocked(Analytics.medicationConfirmed).mock.calls[0]).toHaveLength(3);
  });
});

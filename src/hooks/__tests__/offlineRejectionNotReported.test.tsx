import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { Mock } from 'vitest';

// 1.4.3 audit item 10 (client): an OFFLINE refusal is not an app bug and never fires
// `error_occurred`, exactly like a 402 paywall refusal. A real network failure still does.
// REAL hooks against a mocked HTTP layer (`apiClient`, global mock in
// src/test/setup.ts); only Analytics is observed.

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}));
vi.mock('@/components/ui', () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock('@/hooks/usePremiumGate', () => ({
  usePremiumGate: () => ({ promptUpgrade: vi.fn(), promptLapsed: vi.fn() }),
}));
vi.mock('@/hooks/useCircle', () => ({
  useCircle: () => ({ circle: undefined, timezone: 'America/Denver', canEdit: true, members: [] }),
}));

import { apiClient } from '@/lib/api';
import { Analytics } from '@/lib/analytics';
import { useDeleteVital } from '@/hooks/useVitals';
import { useRemoveMember } from '@/hooks/useCircleMembers';
import { useDeleteCareNote } from '@/hooks/useCareNotes';
import { useDeleteDocument } from '@/hooks/useDocuments';
import { useDeleteEvent } from '@/hooks/useCalendarEvents';

const CIRCLE = 'circle-1';
const del = apiClient.delete as unknown as Mock;
const post = apiClient.post as unknown as Mock;

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

let spy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  spy = vi.spyOn(Analytics, 'errorOccurred').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  del.mockReset();
  post.mockReset();
});


const OFFLINE = { success: false, error: { code: 'OFFLINE', message: 'offline' } };
const FORBIDDEN = { success: false, error: { code: 'FORBIDDEN', message: 'x' } };

async function fail(run: () => Promise<unknown>) {
  await act(async () => {
    await run().catch(() => undefined);
  });
}

describe('item 10: error_occurred skips an OFFLINE refusal', () => {
  it.each([
    ['vitals', () => useDeleteVital(CIRCLE), (h: ReturnType<typeof useDeleteVital>) => h.mutateAsync('v1'), del],
    ['members', () => useRemoveMember(CIRCLE), (h: ReturnType<typeof useRemoveMember>) => h.mutateAsync({ userId: 'u1' }), del],
    ['documents', () => useDeleteDocument(CIRCLE), (h: ReturnType<typeof useDeleteDocument>) => h.mutateAsync('d1'), del],
    ['care_notes', () => useDeleteCareNote(), (h: ReturnType<typeof useDeleteCareNote>) => h.mutateAsync({ circleId: CIRCLE, noteId: 'n1' }), del],
    ['calendar_events', () => useDeleteEvent(CIRCLE), (h: ReturnType<typeof useDeleteEvent>) => h.mutateAsync({ eventId: 'e1' } as never), del],
  ] as const)('%s: OFFLINE is not reported', async (_s, hook, run, verb) => {
    (verb as Mock).mockRejectedValue(OFFLINE);
    const { result } = renderHook(hook as () => unknown, { wrapper });
    await fail(() => (run as (h: unknown) => Promise<unknown>)(result.current));
    expect(spy).not.toHaveBeenCalled();
  });

  it('NEGATIVE: a real refusal (403) and a network failure are still reported', async () => {
    del.mockRejectedValue(FORBIDDEN);
    const a = renderHook(() => useDeleteVital(CIRCLE), { wrapper });
    await fail(() => a.result.current.mutateAsync('v1'));
    expect(spy).toHaveBeenCalledTimes(1);
    del.mockRejectedValue({ code: 'ERR_NETWORK', message: 'Network Error' });
    const b = renderHook(() => useDeleteVital(CIRCLE), { wrapper });
    await fail(() => b.result.current.mutateAsync('v1'));
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(2));
  });
});

import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { Mock } from 'vitest';

// The `error_occurred` contract shared with mobile: every failed save/delete
// reports { source, action, error_kind, fatal:false } (+ the bounded `code`).
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
import { useDeleteCircle } from '@/hooks/useCircleAdmin';
import { useDeleteCareNote } from '@/hooks/useCareNotes';
import { useDeleteDocument } from '@/hooks/useDocuments';
import { useDeleteEvent, useCompleteEvent } from '@/hooks/useCalendarEvents';
import { useDeleteShift } from '@/hooks/useShifts';

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

const FORBIDDEN = { success: false, error: { code: 'FORBIDDEN', message: 'x' } };

async function failWith<T>(hook: () => T, run: (h: T) => Promise<unknown>) {
  const { result } = renderHook(hook, { wrapper });
  await act(async () => {
    await run(result.current).catch(() => undefined);
  });
}

function lastCall(): { screen: string; ctx: Record<string, unknown> } {
  const [screen, , ctx] = spy.mock.calls[spy.mock.calls.length - 1] as [
    string,
    string,
    Record<string, unknown>,
  ];
  return { screen, ctx };
}

describe('error_occurred carries source/action/error_kind/fatal', () => {
  it.each([
    ['vitals', 'delete', () => useDeleteVital(CIRCLE), (h: ReturnType<typeof useDeleteVital>) => h.mutateAsync('v1'), del],
    ['members', 'delete', () => useRemoveMember(CIRCLE), (h: ReturnType<typeof useRemoveMember>) => h.mutateAsync({ userId: 'u1' }), del],
    ['circle_edit', 'delete', () => useDeleteCircle(CIRCLE), (h: ReturnType<typeof useDeleteCircle>) => h.mutateAsync(), del],
    ['care_notes', 'delete', () => useDeleteCareNote(), (h: ReturnType<typeof useDeleteCareNote>) => h.mutateAsync({ circleId: CIRCLE, noteId: 'n1' }), del],
    ['documents', 'delete', () => useDeleteDocument(CIRCLE), (h: ReturnType<typeof useDeleteDocument>) => h.mutateAsync('d1'), del],
    ['calendar_events', 'delete', () => useDeleteEvent(CIRCLE), (h: ReturnType<typeof useDeleteEvent>) => h.mutateAsync({ eventId: 'e1' } as never), del],
    ['shifts', 'delete', () => useDeleteShift(CIRCLE), (h: ReturnType<typeof useDeleteShift>) => h.mutateAsync({ shift: { id: 's1' }, scope: 'one' } as never), del],
  ] as const)('%s (%s)', async (source, action, hook, run, verb) => {
    (verb as Mock).mockRejectedValue(FORBIDDEN);
    await failWith(hook as () => unknown, run as (h: unknown) => Promise<unknown>);
    expect(spy).toHaveBeenCalled();
    const { ctx } = lastCall();
    expect(ctx).toMatchObject({ source, action, error_kind: 'forbidden', fatal: false });
    expect(ctx).not.toHaveProperty('message');
  });

  it("task undo-window commits report source 'tasks', other completes 'calendar_events'", async () => {
    post.mockRejectedValue(FORBIDDEN);
    await failWith(
      () => useCompleteEvent(CIRCLE),
      (h) => h.mutateAsync({ eventId: 't1', source: 'tasks' })
    );
    expect(lastCall().ctx).toMatchObject({ source: 'tasks', action: 'update', fatal: false });
    spy.mockClear();
    await failWith(
      () => useCompleteEvent(CIRCLE),
      (h) => h.mutateAsync({ eventId: 't1' })
    );
    expect(lastCall().ctx).toMatchObject({ source: 'calendar_events' });
  });

  it('network failures classify as network', async () => {
    del.mockRejectedValue({ code: 'ERR_NETWORK', message: 'Network Error' });
    await failWith(
      () => useDeleteVital(CIRCLE),
      (h) => h.mutateAsync('v1')
    );
    await waitFor(() => expect(lastCall().ctx.error_kind).toBe('network'));
  });
});

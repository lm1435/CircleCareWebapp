// THE 403 MUST REFRESH THE CACHE THE EDIT GATE ACTUALLY READS.
//
// Every circle-scoped write hook already has a "the server said no, so the
// cached access flags are stale — refetch them" branch. Every one of them
// refetched `queryKeys.circles` (`['circles']`), the circle LIST.
//
// But the gate that hides every write affordance in this app is
// `useCircle(circleId).canEdit`, and `useCircle` reads `can_edit` off
// `useCircleMembers` → `queryKeys.circleDetail(circleId)` (`['circle', id]`) —
// a DIFFERENT root key that `['circles']` does not prefix-match. So the
// recovery pointed at a cache almost nothing gates on:
//
//   - `components/meds/TodaysMeds.tsx` reads the LIST, so it self-corrected.
//   - every OTHER surface (Calendar, Medications, Vitals, Documents, Notes,
//     Tasks, Emergency Info, the Add menu, the Overview cards) reads the
//     DETAIL, so after a 403 they kept offering Edit / Delete / Done / Take
//     for the rest of the session. The user clicks, the request 403s again,
//     an optimistic row flips back — a view-only member is shown a working
//     app that silently refuses every write.
//
// These tests pin the DETAIL key on every hook family that can receive a
// VIEW_ONLY / SUBSCRIPTION_REQUIRED rejection. The existing per-hook write
// tests assert the LIST key; they stay, because both caches carry gating
// flags (`read_only` and `is_premium_circle` live only on the list) and both
// must be refreshed.

import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

vi.mock('@/api/calendarEvents', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/calendarEvents')>();
  return { ...actual, createEvent: vi.fn(), completeEvent: vi.fn() };
});
vi.mock('@/api/medicationConfirmations', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/medicationConfirmations')>();
  return { ...actual, confirmMedication: vi.fn() };
});
vi.mock('@/api/vitals', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/vitals')>();
  return { ...actual, createVital: vi.fn() };
});
vi.mock('@/api/documents', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/documents')>();
  return { ...actual, deleteDocument: vi.fn() };
});
vi.mock('@/api/careNotes', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/careNotes')>();
  return { ...actual, updateCareNote: vi.fn() };
});
vi.mock('@/api/eventNotes', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/eventNotes')>();
  return { ...actual, updateNote: vi.fn() };
});
vi.mock('@/api/emergencyInfo', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/emergencyInfo')>();
  return { ...actual, updateEmergencyInfo: vi.fn() };
});
vi.mock('@/api/circleMembers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/circleMembers')>();
  return { ...actual, removeMember: vi.fn() };
});
vi.mock('@/api/circles', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/circles')>();
  return { ...actual, updateCircle: vi.fn() };
});
vi.mock('@/api/invites', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/invites')>();
  return { ...actual, createInvite: vi.fn() };
});
vi.mock('@/api/ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/ai')>();
  return { ...actual, sendAiMessage: vi.fn(), getAiSuggestions: vi.fn() };
});

vi.mock('react-i18next', () => ({
  // `i18n.language` is read by useAiChat / useAiSuggestions, which normalize it
  // to the 'en' | 'es' the backend accepts.
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}));

const showToast = vi.fn();
vi.mock('@/components/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/ui')>();
  return { ...actual, useToast: () => ({ showToast }) };
});

const promptUpgrade = vi.fn();
vi.mock('@/hooks/usePremiumGate', () => ({ usePremiumGate: () => ({ promptUpgrade }) }));

vi.mock('@/lib/analytics', () => ({
  Analytics: new Proxy({}, { get: () => vi.fn() }),
}));

import { createEvent, completeEvent } from '@/api/calendarEvents';
import { confirmMedication } from '@/api/medicationConfirmations';
import { createVital } from '@/api/vitals';
import { deleteDocument } from '@/api/documents';
import { updateCareNote } from '@/api/careNotes';
import { updateNote } from '@/api/eventNotes';
import { updateEmergencyInfo } from '@/api/emergencyInfo';
import { removeMember } from '@/api/circleMembers';
import { updateCircle } from '@/api/circles';
import { createInvite } from '@/api/invites';
import { sendAiMessage, getAiSuggestions } from '@/api/ai';
import { queryKeys } from '@/lib/queryKeys';
import { useCreateEvent, useCompleteEvent } from '@/hooks/useCalendarEvents';
import { useConfirmMedication } from '@/hooks/useMedConfirmation';
import { useCreateVital } from '@/hooks/useVitals';
import { useDeleteDocument } from '@/hooks/useDocuments';
import { useUpdateCareNote } from '@/hooks/useCareNotes';
import { useUpdateNote } from '@/hooks/useEventNotes';
import { useUpdateEmergencyInfo } from '@/hooks/useEmergencyInfo';
import { useRemoveMember } from '@/hooks/useCircleMembers';
import { useUpdateCircle } from '@/hooks/useCircleAdmin';
import { useCreateInvite } from '@/hooks/useInvites';
import { useAiChat } from '@/hooks/useAiChat';
import { useAiSuggestions } from '@/hooks/useAiSuggestions';

const CIRCLE_ID = 'circle-1';
const EVENT_ID = 'event-1';

/** A view-only member's rejection: `requireCircleEditAccess` → 403 VIEW_ONLY. */
const VIEW_ONLY_ENVELOPE = {
  success: false,
  error: { code: 'VIEW_ONLY', message: 'View-only member' },
};
/** A frozen (non-selected free-tier) circle: 403 SUBSCRIPTION_REQUIRED. */
const SUBSCRIPTION_ENVELOPE = {
  success: false,
  error: { code: 'SUBSCRIPTION_REQUIRED', message: 'Subscription required' },
};

type InvalidateArg = Parameters<QueryClient['invalidateQueries']>[0];

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

function invalidatedWith(
  invalidateSpy: { mock: { calls: [InvalidateArg?, ...unknown[]][] } },
  key: readonly unknown[]
): boolean {
  return invalidateSpy.mock.calls.some(
    (call) => JSON.stringify(call[0]?.queryKey) === JSON.stringify(key)
  );
}

const DETAIL_KEY = queryKeys.circleDetail(CIRCLE_ID);
const LIST_KEY = queryKeys.circles;

/**
 * BOTH caches, every time. The DETAIL half is what `useCircle().canEdit` reads
 * and was the gap these tests were written for — but `read_only`, the
 * frozen-circle flag `components/meds/TodaysMeds.tsx` and `useCircle().readOnly`
 * gate on, exists ONLY on the LIST response, and `resolveAiEntry` reads
 * `view_only` and `is_premium_circle` off it too. Asserting one half is how the
 * other half goes unpinned: deleting `invalidateQueries({ queryKey: ['circles'] })`
 * used to fail nothing at all in this file, whose 159 tests are the ones that
 * exist specifically to hold this contract.
 */
function expectBothAccessCachesRefreshed(spy: {
  mock: { calls: [InvalidateArg?, ...unknown[]][] };
}): void {
  expect(invalidatedWith(spy, DETAIL_KEY)).toBe(true);
  expect(invalidatedWith(spy, LIST_KEY)).toBe(true);
}

/** Neither cache — for the errors that are not about access at all. */
function expectNoAccessCacheRefreshed(spy: {
  mock: { calls: [InvalidateArg?, ...unknown[]][] };
}): void {
  expect(invalidatedWith(spy, DETAIL_KEY)).toBe(false);
  expect(invalidatedWith(spy, LIST_KEY)).toBe(false);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('a rejected circle-scoped write refreshes BOTH access caches (the detail useCircle().canEdit reads AND the list read_only lives on)', () => {
  it('useCreateEvent — VIEW_ONLY', async () => {
    const { invalidateSpy, wrapper } = setup();
    vi.mocked(createEvent).mockRejectedValue(VIEW_ONLY_ENVELOPE);

    const { result } = renderHook(() => useCreateEvent(CIRCLE_ID), { wrapper });
    result.current.mutate({ title: 'x', event_type: 'task', scheduled_date: '2026-09-08' });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expectBothAccessCachesRefreshed(invalidateSpy);
  });

  it('useCompleteEvent — SUBSCRIPTION_REQUIRED (the frozen-circle path)', async () => {
    const { invalidateSpy, wrapper } = setup();
    vi.mocked(completeEvent).mockRejectedValue(SUBSCRIPTION_ENVELOPE);

    const { result } = renderHook(() => useCompleteEvent(CIRCLE_ID), { wrapper });
    result.current.mutate({ eventId: EVENT_ID });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expectBothAccessCachesRefreshed(invalidateSpy);
  });

  it('useConfirmMedication — VIEW_ONLY', async () => {
    const { invalidateSpy, wrapper } = setup();
    vi.mocked(confirmMedication).mockRejectedValue(VIEW_ONLY_ENVELOPE);

    const { result } = renderHook(() => useConfirmMedication(CIRCLE_ID, 'care_profile'), {
      wrapper,
    });
    result.current.mutate({ event_id: EVENT_ID, status: 'taken', scheduled_time: '08:00' });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expectBothAccessCachesRefreshed(invalidateSpy);
  });

  it('useCreateVital — VIEW_ONLY', async () => {
    const { invalidateSpy, wrapper } = setup();
    vi.mocked(createVital).mockRejectedValue(VIEW_ONLY_ENVELOPE);

    const { result } = renderHook(() => useCreateVital(CIRCLE_ID), { wrapper });
    result.current.mutate({
      vital_type: 'heart_rate',
      value1: 72,
      unit: 'bpm',
      recorded_at: '2026-09-08T10:00:00.000Z',
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expectBothAccessCachesRefreshed(invalidateSpy);
  });

  it('useDeleteDocument — VIEW_ONLY', async () => {
    const { invalidateSpy, wrapper } = setup();
    vi.mocked(deleteDocument).mockRejectedValue(VIEW_ONLY_ENVELOPE);

    const { result } = renderHook(() => useDeleteDocument(CIRCLE_ID), { wrapper });
    result.current.mutate('doc-1');

    await waitFor(() => expect(result.current.isError).toBe(true));
    expectBothAccessCachesRefreshed(invalidateSpy);
  });

  it('useUpdateCareNote — VIEW_ONLY', async () => {
    const { invalidateSpy, wrapper } = setup();
    vi.mocked(updateCareNote).mockRejectedValue(VIEW_ONLY_ENVELOPE);

    const { result } = renderHook(() => useUpdateCareNote(), { wrapper });
    result.current.mutate({
      circleId: CIRCLE_ID,
      noteId: 'note-1',
      input: { body: 'x' },
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expectBothAccessCachesRefreshed(invalidateSpy);
  });

  it('useUpdateNote (event note) — VIEW_ONLY', async () => {
    const { invalidateSpy, wrapper } = setup();
    vi.mocked(updateNote).mockRejectedValue(VIEW_ONLY_ENVELOPE);

    const { result } = renderHook(() => useUpdateNote(), { wrapper });
    result.current.mutate({
      circleId: CIRCLE_ID,
      eventId: EVENT_ID,
      noteId: 'note-1',
      body: 'x',
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expectBothAccessCachesRefreshed(invalidateSpy);
  });

  it('useUpdateEmergencyInfo — VIEW_ONLY', async () => {
    const { invalidateSpy, wrapper } = setup();
    vi.mocked(updateEmergencyInfo).mockRejectedValue(VIEW_ONLY_ENVELOPE);

    const { result } = renderHook(() => useUpdateEmergencyInfo(CIRCLE_ID), { wrapper });
    result.current.mutate({ blood_type: 'O+' });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expectBothAccessCachesRefreshed(invalidateSpy);
  });

  // The owner-gated writes. Their affordances key on `isOwner`, not `canEdit`,
  // so the gate itself cannot go stale the same way — but the DETAIL is also
  // where `pending_invites` and the member roster live, and a rejection means
  // both are stale. Same handler, same rule.
  it('useRemoveMember — VIEW_ONLY', async () => {
    const { invalidateSpy, wrapper } = setup();
    vi.mocked(removeMember).mockRejectedValue(VIEW_ONLY_ENVELOPE);

    const { result } = renderHook(() => useRemoveMember(CIRCLE_ID), { wrapper });
    result.current.mutate({ userId: 'user-2' });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expectBothAccessCachesRefreshed(invalidateSpy);
  });

  it('useUpdateCircle — VIEW_ONLY', async () => {
    const { invalidateSpy, wrapper } = setup();
    vi.mocked(updateCircle).mockRejectedValue(VIEW_ONLY_ENVELOPE);

    const { result } = renderHook(() => useUpdateCircle(CIRCLE_ID), { wrapper });
    result.current.mutate({ recipient_name: 'x' });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expectBothAccessCachesRefreshed(invalidateSpy);
  });

  it('useCreateInvite — VIEW_ONLY', async () => {
    const { invalidateSpy, wrapper } = setup();
    vi.mocked(createInvite).mockRejectedValue(VIEW_ONLY_ENVELOPE);

    const { result } = renderHook(() => useCreateInvite(CIRCLE_ID), { wrapper });
    result.current.mutate({ email: 'a@b.com', member_type: 'caregiver' });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expectBothAccessCachesRefreshed(invalidateSpy);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// THE AI PATH WAS THE ONE REJECTION BRANCH THAT REFRESHED NOTHING.
//
// Ten circle-scoped write hooks were upgraded to `invalidateCircleAccessFlags`;
// the assistant's two were not. `useAiChat` classified the 403 for analytics
// and stopped — its own docstring even names the condition ("a 403 here means
// the CLIENT's cached flags were stale") — and `useAiSuggestions` classified it
// only to stop retrying.
//
// The consequence is specific: `AppLayout` gates the assistant's ENTRY POINTS
// AND ITS MOUNT on `resolveAiEntry(...)`, which reads `view_only` and
// `is_premium_circle` off exactly those two caches. So a member downgraded to
// view-only mid-session — or whose circle freezes — keeps the Assistant button,
// keeps the open modal, and keeps sending messages the server refuses, until
// `staleTime` expires or the window is refocused.
//
// The structural drift guard cannot see this by design: it flags a rejection
// branch that refetches the WRONG cache, not one that refetches nothing at all
// (`src/__tests__/bans/circleAccessFlagRefresh.test.ts`, "NOT covered"). These
// are the runtime half; both hooks are now on that file's
// MUST_REFRESH_ACCESS_FLAGS list so deleting the call fails loudly.
// ────────────────────────────────────────────────────────────────────────────
describe('the AI assistant refreshes the gating flags its own mount is gated on', () => {
  it('useAiChat — VIEW_ONLY', async () => {
    const { invalidateSpy, wrapper } = setup();
    vi.mocked(sendAiMessage).mockRejectedValue(VIEW_ONLY_ENVELOPE);

    const { result } = renderHook(() => useAiChat(CIRCLE_ID), { wrapper });
    result.current.mutation.mutate({ message: 'how is adherence?' });

    await waitFor(() => expect(result.current.mutation.isError).toBe(true));
    expectBothAccessCachesRefreshed(invalidateSpy);
  });

  it('useAiChat — SUBSCRIPTION_REQUIRED (the frozen-circle path)', async () => {
    const { invalidateSpy, wrapper } = setup();
    vi.mocked(sendAiMessage).mockRejectedValue(SUBSCRIPTION_ENVELOPE);

    const { result } = renderHook(() => useAiChat(CIRCLE_ID), { wrapper });
    result.current.mutation.mutate({ message: 'how is adherence?' });

    await waitFor(() => expect(result.current.mutation.isError).toBe(true));
    expectBothAccessCachesRefreshed(invalidateSpy);
  });

  it('useAiChat — a plain 500 refreshes NOTHING', async () => {
    // The flags are only stale when the SERVER disagreed about access. A
    // network blip must not fan out cache invalidations.
    const { invalidateSpy, wrapper } = setup();
    vi.mocked(sendAiMessage).mockRejectedValue({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'boom' },
    });

    const { result } = renderHook(() => useAiChat(CIRCLE_ID), { wrapper });
    result.current.mutation.mutate({ message: 'how is adherence?' });

    await waitFor(() => expect(result.current.mutation.isError).toBe(true));
    expectNoAccessCacheRefreshed(invalidateSpy);
  });

  it('useAiSuggestions — VIEW_ONLY on the modal-open fetch', async () => {
    const { invalidateSpy, wrapper } = setup();
    vi.mocked(getAiSuggestions).mockRejectedValue(VIEW_ONLY_ENVELOPE);

    const { result } = renderHook(() => useAiSuggestions(CIRCLE_ID, true), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
    await waitFor(() => expectBothAccessCachesRefreshed(invalidateSpy));
  });

  it('useAiSuggestions — a plain 500 refreshes NOTHING', async () => {
    const { invalidateSpy, wrapper } = setup();
    vi.mocked(getAiSuggestions).mockRejectedValue({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'boom' },
    });

    const { result } = renderHook(() => useAiSuggestions(CIRCLE_ID, true), { wrapper });

    // A non-terminal error is RETRIED once (see the hook's `retry`), so this
    // settles a retry delay later than the terminal cases above.
    await waitFor(() => expect(result.current.isError).toBe(true), { timeout: 5000 });
    expectNoAccessCacheRefreshed(invalidateSpy);
  });
});

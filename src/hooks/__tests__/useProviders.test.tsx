import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import '@/i18n';
import {
  archiveProvider,
  createProvider,
  getProviders,
  getProviderVisits,
  updateProvider,
  type Provider,
  type ProviderVisit,
  type ProviderVisitsPage,
} from '@/api/providers';
import { Analytics } from '@/lib/analytics';
import { queryKeys } from '@/lib/queryKeys';
import {
  invalidateProviderQueries,
  useArchiveProvider,
  useCreateProvider,
  useProviderVisits,
  useProviders,
  useUpdateProvider,
} from '../useProviders';

vi.mock('@/api/providers', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/providers')>()),
  getProviders: vi.fn(),
  getProviderVisits: vi.fn(),
  createProvider: vi.fn(),
  updateProvider: vi.fn(),
  archiveProvider: vi.fn(),
}));

const showToast = vi.fn();
vi.mock('@/components/ui', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/components/ui')>()),
  useToast: () => ({ showToast }),
}));
const promptUpgrade = vi.fn();
vi.mock('@/hooks/usePremiumGate', () => ({ usePremiumGate: () => ({ promptUpgrade }) }));
vi.mock('@/lib/analytics', () => ({
  Analytics: { errorOccurred: vi.fn(), emergencyInfoUpdated: vi.fn() },
}));

const CIRCLE = 'c1';

function provider(id: string, over: Partial<Provider> = {}): Provider {
  return {
    id,
    name: `Dr ${id}`,
    specialty: null,
    phone: null,
    country_code: null,
    phone_extension: null,
    address: null,
    is_primary: false,
    sort_order: 0,
    archived_at: null,
    created_at: '',
    updated_at: '',
    ...over,
  };
}

function visit(id: string, date: string): ProviderVisit {
  return {
    id,
    series_id: null,
    parent_event_id: null,
    title: 'Checkup',
    location: null,
    scheduled_date: date,
    scheduled_time: null,
    duration_minutes: null,
    recurrence_rule: null,
    completed_at: null,
    is_virtual: false,
    is_upcoming: false,
    note_count: 0,
    notes: [],
  };
}

function page(over: Partial<ProviderVisitsPage>): ProviderVisitsPage {
  return {
    provider: provider('p1'),
    next_visit: null,
    upcoming: [],
    visits: [],
    page: { limit: 20, has_more: false, next_before: null },
    ...over,
  };
}

let client: QueryClient;
function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  vi.clearAllMocks();
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
});

describe('useProviders', () => {
  it('keeps the active list and the include-archived list in separate cache entries', async () => {
    vi.mocked(getProviders).mockImplementation(async (_c, opts) =>
      opts?.includeArchived
        ? [provider('a'), provider('gone', { archived_at: '2026-10-01T00:00:00Z' })]
        : [provider('a')]
    );
    const active = renderHook(() => useProviders(CIRCLE), { wrapper });
    const all = renderHook(() => useProviders(CIRCLE, { includeArchived: true }), { wrapper });
    await waitFor(() => expect(active.result.current.isSuccess).toBe(true));
    await waitFor(() => expect(all.result.current.isSuccess).toBe(true));
    expect(active.result.current.providers.map((p) => p.id)).toEqual(['a']);
    expect(all.result.current.providers.map((p) => p.id)).toEqual(['a', 'gone']);
    expect(getProviders).toHaveBeenCalledWith(CIRCLE, { includeArchived: false });
    expect(getProviders).toHaveBeenCalledWith(CIRCLE, { includeArchived: true });
  });

  it('does not fetch without a circle id, or when disabled', () => {
    renderHook(() => useProviders(undefined), { wrapper });
    renderHook(() => useProviders(CIRCLE, { enabled: false }), { wrapper });
    expect(getProviders).not.toHaveBeenCalled();
  });
});

describe('useProviderVisits (infinite)', () => {
  it('asks for the first page without a cursor, then pages on next_before until has_more is false', async () => {
    vi.mocked(getProviderVisits)
      .mockResolvedValueOnce(
        page({
          visits: [visit('v3', '2026-10-02')],
          page: { limit: 20, has_more: true, next_before: '2026-10-02' },
        })
      )
      .mockResolvedValueOnce(
        page({
          next_visit: null,
          visits: [visit('v2', '2026-07-18'), visit('v1', '2025-12-03')],
          page: { limit: 20, has_more: false, next_before: null },
        })
      );
    const { result } = renderHook(() => useProviderVisits(CIRCLE, 'p1'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(getProviderVisits).toHaveBeenNthCalledWith(1, CIRCLE, 'p1', {
      before: undefined,
      limit: 20,
    });
    expect(result.current.hasNextPage).toBe(true);

    await act(async () => {
      await result.current.fetchNextPage();
    });
    expect(getProviderVisits).toHaveBeenNthCalledWith(2, CIRCLE, 'p1', {
      before: '2026-10-02',
      limit: 20,
    });
    await waitFor(() => expect(result.current.hasNextPage).toBe(false));
    const ids = result.current.data?.pages.flatMap((p) => p.visits.map((v) => v.id));
    expect(ids).toEqual(['v3', 'v2', 'v1']);
  });

  it('has no next page when has_more is true but there is no cursor (never loops)', async () => {
    vi.mocked(getProviderVisits).mockResolvedValue(
      page({ page: { limit: 20, has_more: true, next_before: null } })
    );
    const { result } = renderHook(() => useProviderVisits(CIRCLE, 'p1'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.hasNextPage).toBe(false);
  });

  it('stays idle until it has a doctor id', () => {
    renderHook(() => useProviderVisits(CIRCLE, undefined), { wrapper });
    expect(getProviderVisits).not.toHaveBeenCalled();
  });
});

describe('provider writes: invalidation (contract section 5)', () => {
  it('invalidateProviderQueries refreshes lists, visits, emergency info, the calendar and the feed', () => {
    const spy = vi.spyOn(client, 'invalidateQueries');
    invalidateProviderQueries(client, CIRCLE);
    const keys = spy.mock.calls.map((call) => (call[0] as { queryKey: unknown }).queryKey);
    expect(keys).toEqual(
      expect.arrayContaining([
        queryKeys.providers(CIRCLE),
        queryKeys.providerVisits(CIRCLE),
        queryKeys.emergencyInfo(CIRCLE),
        queryKeys.calendarEvents(CIRCLE),
        queryKeys.activityFeed(CIRCLE),
      ])
    );
  });

  it('create, update and archive each invalidate on success', async () => {
    const write = { provider: provider('p1'), providers: [provider('p1')] };
    vi.mocked(createProvider).mockResolvedValue(write);
    vi.mocked(updateProvider).mockResolvedValue(write);
    vi.mocked(archiveProvider).mockResolvedValue(write);
    const spy = vi.spyOn(client, 'invalidateQueries');

    const create = renderHook(() => useCreateProvider(CIRCLE), { wrapper });
    await act(async () => {
      await create.result.current.mutateAsync({ name: 'Dr New' });
    });
    const update = renderHook(() => useUpdateProvider(CIRCLE), { wrapper });
    await act(async () => {
      await update.result.current.mutateAsync({ providerId: 'p1', data: { address: null } });
    });
    const archive = renderHook(() => useArchiveProvider(CIRCLE), { wrapper });
    await act(async () => {
      await archive.result.current.mutateAsync({ providerId: 'p1' });
    });

    expect(createProvider).toHaveBeenCalledWith(CIRCLE, { name: 'Dr New' });
    expect(updateProvider).toHaveBeenCalledWith(CIRCLE, 'p1', { address: null });
    expect(archiveProvider).toHaveBeenCalledWith(CIRCLE, 'p1');
    const providersInvalidations = spy.mock.calls.filter(
      (c) => JSON.stringify((c[0] as { queryKey: unknown }).queryKey) === JSON.stringify(queryKeys.providers(CIRCLE))
    );
    expect(providersInvalidations).toHaveLength(3);
  });
});

describe('provider writes keep firing emergency_info_updated (field names only)', () => {
  it('add / edit / remove of an additional doctor name additional_doctors; the primary names its flat fields', async () => {
    const additional = { provider: provider('p1'), providers: [] };
    const primary = { provider: provider('p2', { is_primary: true }), providers: [] };
    vi.mocked(createProvider).mockResolvedValue(additional);
    vi.mocked(updateProvider).mockResolvedValueOnce(additional).mockResolvedValueOnce(primary);
    vi.mocked(archiveProvider).mockResolvedValue(additional);
    const spy = vi.mocked(Analytics.emergencyInfoUpdated);

    const create = renderHook(() => useCreateProvider(CIRCLE), { wrapper });
    await act(async () => {
      await create.result.current.mutateAsync({ name: 'Dr New', is_primary: false });
    });
    expect(spy).toHaveBeenLastCalledWith(CIRCLE, ['additional_doctors']);

    const update = renderHook(() => useUpdateProvider(CIRCLE), { wrapper });
    await act(async () => {
      await update.result.current.mutateAsync({ providerId: 'p1', data: { name: 'x' } });
    });
    expect(spy).toHaveBeenLastCalledWith(CIRCLE, ['additional_doctors']);
    await act(async () => {
      await update.result.current.mutateAsync({ providerId: 'p2', data: { name: 'x' } });
    });
    expect(spy.mock.calls.at(-1)?.[1]).toContain('primary_doctor_name');
    expect(spy.mock.calls.at(-1)?.[1]).not.toContain('additional_doctors');

    const archive = renderHook(() => useArchiveProvider(CIRCLE), { wrapper });
    await act(async () => {
      await archive.result.current.mutateAsync({ providerId: 'p1' });
    });
    expect(spy).toHaveBeenLastCalledWith(CIRCLE, ['additional_doctors']);
    await act(async () => {
      await archive.result.current.mutateAsync({ providerId: 'p2', wasPrimary: true });
    });
    expect(spy.mock.calls.at(-1)?.[1]).toEqual([
      'primary_doctor_name',
      'primary_doctor_specialty',
      'primary_doctor_phone',
      'primary_doctor_address',
    ]);
  });

  it('a failed write fires nothing', async () => {
    vi.mocked(createProvider).mockRejectedValue({ success: false, error: { code: 'SERVER_ERROR' } });
    const { result } = renderHook(() => useCreateProvider(CIRCLE), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ name: 'Dr New' }).catch(() => undefined);
    });
    expect(Analytics.emergencyInfoUpdated).not.toHaveBeenCalled();
  });
});

describe('provider writes: friendly errors per code', () => {
  const env = (code: string) => ({ success: false, error: { code, message: 'x' } });

  async function failWith(code: string): Promise<void> {
    vi.mocked(createProvider).mockRejectedValue(env(code));
    const { result } = renderHook(() => useCreateProvider(CIRCLE), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ name: 'Dr New' }).catch(() => undefined);
    });
  }

  it('PROVIDER_LIMIT_REACHED says so and does not reload (nothing changed)', async () => {
    const spy = vi.spyOn(client, 'invalidateQueries');
    await failWith('PROVIDER_LIMIT_REACHED');
    expect(showToast).toHaveBeenCalledWith(expect.stringMatching(/limit of 50 doctors/i), 'error');
    expect(spy).not.toHaveBeenCalled();
  });

  it('PROVIDER_CONFLICT reloads the lists and asks the user to try again', async () => {
    const spy = vi.spyOn(client, 'invalidateQueries');
    await failWith('PROVIDER_CONFLICT');
    expect(showToast).toHaveBeenCalledWith(expect.stringMatching(/try again/i), 'error');
    const keys = spy.mock.calls.map((call) => (call[0] as { queryKey: unknown }).queryKey);
    expect(keys).toContainEqual(queryKeys.providers(CIRCLE));
    expect(keys).toContainEqual(queryKeys.emergencyInfo(CIRCLE));
  });

  it('PROVIDER_ARCHIVED says the doctor was removed and reloads', async () => {
    const spy = vi.spyOn(client, 'invalidateQueries');
    await failWith('PROVIDER_ARCHIVED');
    expect(showToast).toHaveBeenCalledWith(expect.stringMatching(/already removed/i), 'error');
    expect(spy).toHaveBeenCalled();
  });

  it('a view-only 403 gets the permission copy; a 402 routes to the upgrade prompt; anything else is a generic save failure', async () => {
    await failWith('VIEW_ONLY');
    expect(showToast).toHaveBeenLastCalledWith(expect.stringMatching(/permission/i), 'error');

    showToast.mockClear();
    await failWith('SUBSCRIPTION_REQUIRED');
    expect(promptUpgrade).toHaveBeenCalledTimes(1);
    expect(showToast).not.toHaveBeenCalled();

    await failWith('SERVER_ERROR');
    expect(showToast).toHaveBeenLastCalledWith(expect.stringMatching(/couldn.t save/i), 'error');
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from '@/lib/api';
import {
  archiveProvider,
  createProvider,
  createProviderSchema,
  getProviders,
  getProviderVisits,
  updateProvider,
  updateProviderSchema,
} from '../providers';

// PROVIDERS_API_CONTRACT.md: paths, query params and bodies of the doctor API.

vi.mock('@/lib/api', () => ({
  apiClient: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

const get = vi.mocked(apiClient.get);
const post = vi.mocked(apiClient.post);
const patch = vi.mocked(apiClient.patch);

const PROVIDER = { id: 'p1', name: 'Dr Patel' };

beforeEach(() => vi.clearAllMocks());

describe('providers API', () => {
  it('lists active doctors by default (no query) and removed ones with include_archived', async () => {
    get.mockResolvedValue({ success: true, data: { providers: [PROVIDER] } });

    expect(await getProviders('c1')).toEqual([PROVIDER]);
    expect(get).toHaveBeenLastCalledWith('/circles/c1/providers', { params: undefined });

    await getProviders('c1', { includeArchived: true });
    expect(get).toHaveBeenLastCalledWith('/circles/c1/providers', {
      params: { include_archived: 'true' },
    });
  });

  it('creates with POST and returns the doctor plus the active list', async () => {
    post.mockResolvedValue({
      success: true,
      data: { provider: PROVIDER, providers: [PROVIDER] },
    });
    const out = await createProvider('c1', { name: 'Dr Patel', is_primary: false });
    expect(post).toHaveBeenCalledWith('/circles/c1/providers', {
      name: 'Dr Patel',
      is_primary: false,
    });
    expect(out.provider.id).toBe('p1');
    expect(out.providers).toHaveLength(1);
  });

  it('patches by id and archives with an empty body; the id is ONE encoded path segment', async () => {
    patch.mockResolvedValue({ success: true, data: { provider: PROVIDER, providers: [] } });
    post.mockResolvedValue({ success: true, data: { provider: PROVIDER, providers: [] } });

    await updateProvider('c1', 'p1', { specialty: null });
    expect(patch).toHaveBeenCalledWith('/circles/c1/providers/p1', { specialty: null });

    await archiveProvider('c1', 'p1');
    expect(post).toHaveBeenCalledWith('/circles/c1/providers/p1/archive', {});

    // An id that came out of a URL can never rebuild the Bearer-carrying path.
    await archiveProvider('c1', 'x/../y?z=1');
    expect(post).toHaveBeenLastCalledWith('/circles/c1/providers/x%2F..%2Fy%3Fz%3D1/archive', {});
  });

  it('pages visits with before / limit, sending neither on the first page', async () => {
    const page = {
      success: true,
      data: {
        provider: PROVIDER,
        next_visit: null,
        upcoming: [],
        visits: [],
        page: { limit: 20, has_more: false, next_before: null },
      },
    };
    get.mockResolvedValue(page);

    await getProviderVisits('c1', 'p1');
    expect(get).toHaveBeenLastCalledWith('/circles/c1/providers/p1/visits', { params: {} });

    const out = await getProviderVisits('c1', 'p1', { before: '2026-10-07', limit: 20 });
    expect(get).toHaveBeenLastCalledWith('/circles/c1/providers/p1/visits', {
      params: { before: '2026-10-07', limit: 20 },
    });
    expect(out.page.has_more).toBe(false);
  });
});

describe('request schemas mirror the backend caps', () => {
  it('only name is required, and it cannot be blank', () => {
    expect(createProviderSchema.safeParse({ name: 'Dr A' }).success).toBe(true);
    expect(createProviderSchema.safeParse({ name: '   ' }).success).toBe(false);
    expect(createProviderSchema.safeParse({}).success).toBe(false);
  });

  it('enforces the field caps and the digits-only extension', () => {
    const base = { name: 'Dr A' };
    expect(createProviderSchema.safeParse({ ...base, name: 'x'.repeat(101) }).success).toBe(false);
    expect(createProviderSchema.safeParse({ ...base, specialty: 'x'.repeat(101) }).success).toBe(false);
    expect(createProviderSchema.safeParse({ ...base, phone: 'x'.repeat(21) }).success).toBe(false);
    expect(createProviderSchema.safeParse({ ...base, country_code: '+12345' }).success).toBe(false);
    expect(createProviderSchema.safeParse({ ...base, address: 'x'.repeat(1001) }).success).toBe(false);
    expect(createProviderSchema.safeParse({ ...base, phone_extension: '12a' }).success).toBe(false);
    expect(createProviderSchema.safeParse({ ...base, phone_extension: '1234567890' }).success).toBe(true);
    expect(createProviderSchema.safeParse({ ...base, specialty: null, address: null }).success).toBe(true);
  });

  it('PATCH is partial: any single key validates on its own', () => {
    expect(updateProviderSchema.safeParse({ address: null }).success).toBe(true);
    expect(updateProviderSchema.safeParse({}).success).toBe(true);
    expect(updateProviderSchema.safeParse({ phone_extension: 'abc' }).success).toBe(false);
  });
});

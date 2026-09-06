import { apiClient } from '@/lib/api';
import { DRUG_SEARCH_MIN_CHARS, searchDrugs } from '../drugs';

const get = vi.mocked(apiClient.get);

describe('searchDrugs (mirrors mobile api/drugs.ts)', () => {
  beforeEach(() => get.mockReset());

  it('hits /drugs/search with the trimmed query and unwraps the envelope', async () => {
    const drugs = [{ rxcui: '6809', name: 'Metformin', strength: null, dosageForm: null }];
    get.mockResolvedValue({ data: { drugs } });

    await expect(searchDrugs('  metf ')).resolves.toEqual(drugs);
    expect(get).toHaveBeenCalledWith('/drugs/search', { params: { q: 'metf' }, signal: undefined });
  });

  it('short-circuits queries under the minimum without a request', async () => {
    await expect(searchDrugs('m')).resolves.toEqual([]);
    await expect(searchDrugs('   ')).resolves.toEqual([]);
    expect(get).not.toHaveBeenCalled();
    expect(DRUG_SEARCH_MIN_CHARS).toBe(2);
  });

  it('returns an empty list when the envelope carries no drugs', async () => {
    get.mockResolvedValue({ data: {} });
    await expect(searchDrugs('aspirin')).resolves.toEqual([]);
  });

  it('forwards an abort signal so a stale keystroke can be cancelled', async () => {
    get.mockResolvedValue({ data: { drugs: [] } });
    const controller = new AbortController();
    await searchDrugs('aspirin', controller.signal);
    expect(get).toHaveBeenCalledWith('/drugs/search', {
      params: { q: 'aspirin' },
      signal: controller.signal,
    });
  });
});

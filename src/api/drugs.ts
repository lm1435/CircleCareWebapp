import { apiClient } from '@/lib/api';

/** One RxNorm concept, as `GET /drugs/search` returns it (mobile `api/drugs.ts`). */
export interface DrugSearchResult {
  rxcui: string;
  name: string;
  strength: string | null;
  dosageForm: string | null;
}

// The API client's response interceptor returns the backend's
// `{ success, data, error }` envelope, so `response.data.drugs` is the payload.
interface DrugSearchEnvelope {
  data?: { drugs?: DrugSearchResult[] };
}

/** Backend short-circuits anything shorter to an empty list; save the round trip. */
export const DRUG_SEARCH_MIN_CHARS = 2;

/**
 * Search RxNorm by name through the backend (`/drugs/search`, rate limited and
 * cached server-side). Resolves to `[]` for a query under two characters
 * without calling the network. `signal` lets a caller abandon a stale
 * keystroke's request.
 */
export async function searchDrugs(query: string, signal?: AbortSignal): Promise<DrugSearchResult[]> {
  const q = query.trim();
  if (q.length < DRUG_SEARCH_MIN_CHARS) return [];
  const response = (await apiClient.get('/drugs/search', {
    params: { q },
    signal,
  })) as unknown as DrugSearchEnvelope;
  return response.data?.drugs ?? [];
}

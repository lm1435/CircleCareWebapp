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

/**
 * Outcome of a FAILED lookup for `drug_search_completed` (mobile `api/drugs.ts`): 'timeout' when the
 * backend's RxNorm deadline passed (504 RXNORM_API_TIMEOUT) or the client gave up (axios ECONNABORTED /
 * ETIMEDOUT); else 'error'. The client rejects with the unwrapped body (`err.error.code`) or the raw error.
 */
export function drugSearchFailureKind(error: unknown): 'timeout' | 'error' {
  const e = error as { error?: { code?: unknown }; code?: unknown; name?: unknown } | null | undefined;
  const code = e?.error?.code ?? e?.code;
  if (code === 'RXNORM_API_TIMEOUT' || code === 'ECONNABORTED' || code === 'ETIMEDOUT') return 'timeout';
  if (e?.name === 'TimeoutError') return 'timeout';
  return 'error';
}

import { z } from 'zod';
import { apiClient } from '@/lib/api';

// Providers (doctors) + "Visits & notes" — web half of docs/plans/notes-by-doctor.md,
// built against /PROVIDERS_API_CONTRACT.md (backend: routes/providers.ts).
//
// Every call goes through the apiClient response interceptor, which unwraps the
// transport and rejects with the error envelope `{ success:false, error:{code} }`
// (branch on `err.error.code`, never on the message).
//
// PHI: doctor names, addresses and visit notes are health data. NEVER log them
// and never attach any of them to an analytics event.

/** A doctor. `archived_at` non-null = removed (never deleted; links survive). */
export interface Provider {
  id: string;
  name: string;
  specialty: string | null;
  phone: string | null;
  country_code: string | null;
  phone_extension: string | null;
  address: string | null;
  is_primary: boolean;
  sort_order: number;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
  /** GET /providers only: PHYSICAL visits linked to the doctor. Absent elsewhere. */
  visit_count?: number;
}

export interface VisitNote {
  id: string;
  event_id: string;
  body: string;
  created_at: string;
  updated_at: string;
  author_id: string | null;
  /** Names can be null for a nameless (or departed, nameless) author. */
  author: { id: string; first_name: string | null; last_name: string | null } | null;
}

/** One occurrence of an appointment linked to a doctor. */
export interface ProviderVisit {
  /** Event id to open. VIRTUAL: `<rootId>_<YYYY-MM-DD>`. */
  id: string;
  /** Series root id for a recurring root, its occurrences and virtual rows; else null. */
  series_id: string | null;
  parent_event_id: string | null;
  title: string;
  location: string | null;
  scheduled_date: string; // YYYY-MM-DD, naive in the care recipient's timezone
  scheduled_time: string | null; // HH:MM:SS; null = all day
  duration_minutes: number | null;
  recurrence_rule: string | null;
  completed_at: string | null;
  is_virtual: boolean;
  is_upcoming: boolean;
  note_count: number;
  notes: VisitNote[];
}

export interface ProviderVisitsPage {
  provider: Provider;
  /** First page only; null afterwards. */
  next_visit: ProviderVisit | null;
  /** First page only (soonest 5, first === next_visit); [] afterwards. */
  upcoming: ProviderVisit[];
  /** PAST visits, newest first. A page is cut between whole dates. */
  visits: ProviderVisit[];
  page: { limit: number; has_more: boolean; next_before: string | null };
}

// --- Request schemas: mirror backend routes/providers.ts caps exactly --------

const extensionSchema = z.string().regex(/^\d{1,10}$/);

export const createProviderSchema = z.object({
  name: z.string().trim().min(1).max(100),
  specialty: z.string().max(100).nullable().optional(),
  phone: z.string().max(20).nullable().optional(),
  country_code: z.string().max(5).nullable().optional(),
  phone_extension: extensionSchema.nullable().optional(),
  address: z.string().max(1000).nullable().optional(),
  is_primary: z.boolean().optional(),
});
export type CreateProviderRequest = z.infer<typeof createProviderSchema>;

/** PATCH is partial: only the keys sent change; null/"" clears an optional field. */
export const updateProviderSchema = createProviderSchema.partial();
export type UpdateProviderRequest = z.infer<typeof updateProviderSchema>;

// --- Calls ------------------------------------------------------------------

interface ProvidersEnvelope {
  success: boolean;
  data: { providers: Provider[] };
}

interface ProviderWriteEnvelope {
  success: boolean;
  data: { provider: Provider; providers: Provider[] };
}

interface VisitsEnvelope {
  success: boolean;
  data: ProviderVisitsPage;
}

/** One path segment, however it got here (an id can come out of a URL). */
function seg(id: string): string {
  return encodeURIComponent(id);
}

/**
 * GET /circles/:circleId/providers. Active doctors (primary first, then
 * `sort_order`); `includeArchived` appends the removed ones, newest archive first.
 */
export async function getProviders(
  circleId: string,
  opts: { includeArchived?: boolean } = {}
): Promise<Provider[]> {
  const response = (await apiClient.get(`/circles/${circleId}/providers`, {
    params: opts.includeArchived ? { include_archived: 'true' } : undefined,
  })) as unknown as ProvidersEnvelope;
  return response.data.providers;
}

/** POST /circles/:circleId/providers -> the created doctor + every ACTIVE doctor. */
export async function createProvider(
  circleId: string,
  body: CreateProviderRequest
): Promise<{ provider: Provider; providers: Provider[] }> {
  const response = (await apiClient.post(
    `/circles/${circleId}/providers`,
    body
  )) as unknown as ProviderWriteEnvelope;
  return response.data;
}

/** PATCH /circles/:circleId/providers/:id (partial). */
export async function updateProvider(
  circleId: string,
  providerId: string,
  body: UpdateProviderRequest
): Promise<{ provider: Provider; providers: Provider[] }> {
  const response = (await apiClient.patch(
    `/circles/${circleId}/providers/${seg(providerId)}`,
    body
  )) as unknown as ProviderWriteEnvelope;
  return response.data;
}

/** POST /circles/:circleId/providers/:id/archive ("remove"; idempotent). */
export async function archiveProvider(
  circleId: string,
  providerId: string
): Promise<{ provider: Provider; providers: Provider[] }> {
  const response = (await apiClient.post(
    `/circles/${circleId}/providers/${seg(providerId)}/archive`,
    {}
  )) as unknown as ProviderWriteEnvelope;
  return response.data;
}

/**
 * GET /circles/:circleId/providers/:id/visits. `before` (YYYY-MM-DD, exclusive)
 * pages backwards; absent = the first page (which also carries next_visit /
 * upcoming). Readable by every member, view-only included, and for an archived
 * doctor.
 */
export async function getProviderVisits(
  circleId: string,
  providerId: string,
  opts: { before?: string; limit?: number } = {}
): Promise<ProviderVisitsPage> {
  const params: Record<string, string | number> = {};
  if (opts.before) params.before = opts.before;
  if (opts.limit) params.limit = opts.limit;
  const response = (await apiClient.get(
    `/circles/${circleId}/providers/${seg(providerId)}/visits`,
    { params }
  )) as unknown as VisitsEnvelope;
  return response.data;
}

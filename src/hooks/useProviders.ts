import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
  type QueryClient,
  type UseInfiniteQueryResult,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  archiveProvider,
  createProvider,
  getProviders,
  getProviderVisits,
  updateProvider,
  type CreateProviderRequest,
  type Provider,
  type ProviderVisitsPage,
  type UpdateProviderRequest,
} from '@/api/providers';
import { useToast } from '@/components/ui';
import { usePremiumGate } from '@/hooks/usePremiumGate';
import { Analytics } from '@/lib/analytics';
import {
  classifyFailureCode,
  isPermissionDeniedError,
  isProviderArchivedError,
  isProviderConflictError,
  isProviderLimitReachedError,
  isSubscriptionRequiredError,
} from '@/lib/apiErrors';
import { invalidateCircleAccessFlags } from '@/lib/circleAccessFlags';
import { queryKeys } from '@/lib/queryKeys';

// Providers (doctors) + Visits & notes — docs/plans/notes-by-doctor.md and
// PROVIDERS_API_CONTRACT.md §5. Server state only; no store.
//
// PHI: doctor names / visit notes are health data. Nothing here logs them or
// hands them to analytics (the error event carries a closed-set `code` only).

// Module-level constant — never `?? []` inline in selectors/returns.
const EMPTY_PROVIDERS: Provider[] = [];

/**
 * The circle's doctors. Active only by default (the picker, the Medical Info
 * counts); `includeArchived` appends removed ones so an appointment that points
 * at a removed doctor can still be named "Dr. X (removed)".
 */
export function useProviders(
  circleId: string | undefined,
  opts: { includeArchived?: boolean; enabled?: boolean } = {}
): UseQueryResult<Provider[]> & { providers: Provider[] } {
  const includeArchived = opts.includeArchived === true;
  const query = useQuery({
    queryKey: queryKeys.providersList(circleId ?? '', includeArchived),
    queryFn: () => getProviders(circleId as string, { includeArchived }),
    enabled: !!circleId && opts.enabled !== false,
  });
  return { ...query, providers: query.data ?? EMPTY_PROVIDERS };
}

/** Rows asked per page. The server may return more when a date holds several visits. */
export const VISITS_PAGE_SIZE = 20;

/**
 * One doctor's Visits & notes: the first page carries `next_visit` / `upcoming`
 * / `provider`, then `before=page.next_before` while `page.has_more` ("Show
 * earlier visits"). No span cap: the server pages on whole dates until the
 * history ends.
 */
export function useProviderVisits(
  circleId: string | undefined,
  providerId: string | undefined
): UseInfiniteQueryResult<InfiniteData<ProviderVisitsPage, string | undefined>> {
  return useInfiniteQuery({
    queryKey: queryKeys.providerVisits(circleId ?? '', providerId ?? ''),
    queryFn: ({ pageParam }) =>
      getProviderVisits(circleId as string, providerId as string, {
        before: pageParam,
        limit: VISITS_PAGE_SIZE,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) =>
      last.page.has_more && last.page.next_before ? last.page.next_before : undefined,
    enabled: !!circleId && !!providerId,
  });
}

/**
 * After any provider write (create / edit / archive): the doctor lists, every
 * doctor's visits, the emergency-info projection (its doctors changed), the
 * calendar (linked appointments show the doctor) and the activity feed (the
 * backend appends an `emergency_info_updated` row).
 */
export function invalidateProviderQueries(queryClient: QueryClient, circleId: string): void {
  void queryClient.invalidateQueries({ queryKey: queryKeys.providers(circleId) });
  void queryClient.invalidateQueries({ queryKey: queryKeys.providerVisits(circleId) });
  void queryClient.invalidateQueries({ queryKey: queryKeys.emergencyInfo(circleId) });
  void queryClient.invalidateQueries({ queryKey: queryKeys.calendarEvents(circleId) });
  void queryClient.invalidateQueries({ queryKey: queryKeys.activityFeed(circleId) });
}

/**
 * Shared onError for provider writes. Every provider code gets its own
 * sentence (never "try again" for something a retry cannot fix):
 *   - PROVIDER_LIMIT_REACHED: nothing to reload, the user must remove one;
 *   - PROVIDER_CONFLICT: someone else changed the doctors at the same moment ->
 *     reload, then ask the user to try again;
 *   - PROVIDER_ARCHIVED: the doctor was removed meanwhile -> reload.
 * Permission / subscription rejections behave as every other web write.
 */
function useProviderMutationOnError(circleId: string): (error: unknown) => void {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const { promptUpgrade } = usePremiumGate('feature', { circleId });
  const { t } = useTranslation('emergency');

  return (error: unknown) => {
    Analytics.errorOccurred('providers', 'providers_mutation_error', {
      circle_id: circleId,
      code: classifyFailureCode(error),
    });
    if (isProviderLimitReachedError(error)) {
      showToast(t('providers.errors.limitReached'), 'error');
    } else if (isProviderConflictError(error)) {
      showToast(t('providers.errors.conflict'), 'error');
      invalidateProviderQueries(queryClient, circleId);
    } else if (isProviderArchivedError(error)) {
      showToast(t('providers.errors.archived'), 'error');
      invalidateProviderQueries(queryClient, circleId);
    } else if (isSubscriptionRequiredError(error)) {
      promptUpgrade();
      invalidateCircleAccessFlags(queryClient, circleId);
    } else if (isPermissionDeniedError(error)) {
      showToast(t('errors.permissionDenied'), 'error');
      invalidateCircleAccessFlags(queryClient, circleId);
    } else {
      showToast(t('errors.saveFailed'), 'error');
      invalidateProviderQueries(queryClient, circleId);
    }
  };
}

type ProviderWriteResult = { provider: Provider; providers: Provider[] };

// `emergency_info_updated` keeps firing from the doctor add / edit / remove flows,
// exactly as when they were array writes: FIELD NAMES only, never values (PHI).
// An additional doctor is `additional_doctors`; the primary doctor is the flat
// `primary_doctor_*` fields.
const PRIMARY_EDIT_FIELDS = [
  'primary_doctor_name',
  'primary_doctor_specialty',
  'primary_doctor_phone',
  'primary_doctor_country_code',
  'primary_doctor_phone_extension',
  'primary_doctor_address',
];
const PRIMARY_REMOVE_FIELDS = [
  'primary_doctor_name',
  'primary_doctor_specialty',
  'primary_doctor_phone',
  'primary_doctor_address',
];

/** POST /providers. Resolves to the created doctor and the active list. */
export function useCreateProvider(
  circleId: string
): UseMutationResult<ProviderWriteResult, unknown, CreateProviderRequest> {
  const queryClient = useQueryClient();
  const onError = useProviderMutationOnError(circleId);
  return useMutation({
    mutationFn: (body: CreateProviderRequest) => createProvider(circleId, body),
    onSuccess: (_result, body) => {
      Analytics.emergencyInfoUpdated(
        circleId,
        body.is_primary ? PRIMARY_EDIT_FIELDS : ['additional_doctors']
      );
      invalidateProviderQueries(queryClient, circleId);
    },
    onError,
  });
}

export interface UpdateProviderVariables {
  providerId: string;
  data: UpdateProviderRequest;
}

/** PATCH /providers/:id (partial). */
export function useUpdateProvider(
  circleId: string
): UseMutationResult<ProviderWriteResult, unknown, UpdateProviderVariables> {
  const queryClient = useQueryClient();
  const onError = useProviderMutationOnError(circleId);
  return useMutation({
    mutationFn: ({ providerId, data }: UpdateProviderVariables) =>
      updateProvider(circleId, providerId, data),
    onSuccess: (result) => {
      Analytics.emergencyInfoUpdated(
        circleId,
        result.provider.is_primary ? PRIMARY_EDIT_FIELDS : ['additional_doctors']
      );
      invalidateProviderQueries(queryClient, circleId);
    },
    onError,
  });
}

export interface ArchiveProviderVariables {
  providerId: string;
  /** The doctor being removed is the primary one (names the flat fields in analytics). */
  wasPrimary?: boolean;
}

/** POST /providers/:id/archive — "remove" a doctor (links survive). */
export function useArchiveProvider(
  circleId: string
): UseMutationResult<ProviderWriteResult, unknown, ArchiveProviderVariables> {
  const queryClient = useQueryClient();
  const onError = useProviderMutationOnError(circleId);
  return useMutation({
    mutationFn: ({ providerId }: ArchiveProviderVariables) => archiveProvider(circleId, providerId),
    onSuccess: (_result, variables) => {
      Analytics.emergencyInfoUpdated(
        circleId,
        variables.wasPrimary ? PRIMARY_REMOVE_FIELDS : ['additional_doctors']
      );
      invalidateProviderQueries(queryClient, circleId);
    },
    onError,
  });
}

/** "Dr. Patel (removed)" / "Dr. Patel": one place for the archived suffix. */
export function providerDisplayName(
  provider: Pick<Provider, 'name' | 'archived_at'>,
  removedLabel: (name: string) => string
): string {
  return provider.archived_at ? removedLabel(provider.name) : provider.name;
}

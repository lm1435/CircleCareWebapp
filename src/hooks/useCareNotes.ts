import {
  keepPreviousData,
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import {
  createCareNote,
  deleteCareNote,
  getCareNotes,
  updateCareNote,
  type CareNote,
  type CareNoteInput,
  type GetCareNotesParams,
  type GetCareNotesResponse,
} from '@/api/careNotes';
import { queryKeys } from '@/lib/queryKeys';
import { invalidateCircleAccessFlags } from '@/lib/circleAccessFlags';
import { failureContext, isPermissionDeniedError, type FailureAction } from '@/lib/apiErrors';
import { Analytics } from '@/lib/analytics';
import { useAuthStore } from '@/store/authStore';
import { olderPageRange } from '@/lib/noteDate';

// Daily Care Notes hooks (docs/plans/daily-care-notes.md, Web Task 15).
// Read query is date-window keyed (calendar idiom); create is OPTIMISTIC —
// the note appears in "Today" immediately and rolls back on failure (the page
// preserves the composer input and shows the error toast). Update/delete
// invalidate on success. Permission rejections refetch the circle flags
// (useEventNotes idiom — cached can_edit/view_only is stale).

export function useCareNotes(
  circleId: string,
  params?: GetCareNotesParams
): UseQueryResult<GetCareNotesResponse> {
  return useQuery({
    queryKey: queryKeys.careNotesRange(circleId, params ?? {}),
    queryFn: () => getCareNotes(circleId, params),
    enabled: !!circleId,
    staleTime: 1000 * 60, // 1 min (tasks idiom)
    // Widening the window ("Show earlier notes") keeps the current list on
    // screen instead of flashing skeletons while the larger range loads.
    placeholderData: keepPreviousData,
  });
}

const EMPTY_NOTES: CareNote[] = [];

/**
 * Older history: one query per 92-day page BEFORE the base window (today-91 ..
 * today), keyed under ['careNotes', circleId, …] so every mutation's
 * invalidation and the optimistic insert reach them. No cap.
 */
export function useOlderCareNotes(circleId: string, today: string | undefined, pageCount: number) {
  const ranges = today
    ? Array.from({ length: pageCount }, (_, i) => olderPageRange(today, i + 1))
    : [];
  return useQueries({
    queries: ranges.map((r) => ({
      queryKey: queryKeys.careNotesRange(circleId, r),
      queryFn: () => getCareNotes(circleId, r),
      enabled: !!circleId,
      staleTime: 1000 * 60,
    })),
    combine: (results) => ({
      notes: results.flatMap((r) => r.data?.notes ?? EMPTY_NOTES),
      isFetching: results.some((r) => r.isFetching && !r.data),
      isError: results.some((r) => r.isError),
      // The last page answered and held nothing: the end of the history.
      reachedEnd:
        results.length > 0 &&
        results[results.length - 1].isSuccess &&
        results[results.length - 1].data!.notes.length === 0,
    }),
  });
}

/** Does a cached window key (['careNotes', circle, {from?, to?}]) cover `date`? */
function windowCovers(key: readonly unknown[], date: string): boolean {
  const range = (key[2] ?? {}) as { from?: string; to?: string };
  if (range.from && date < range.from) return false;
  if (range.to && date > range.to) return false;
  return true;
}

interface CreateCareNoteVariables {
  circleId: string;
  input: CareNoteInput;
}

interface UpdateCareNoteVariables {
  circleId: string;
  noteId: string;
  input: CareNoteInput;
}

interface DeleteCareNoteVariables {
  circleId: string;
  noteId: string;
}

interface CreateCareNoteContext {
  /** Snapshot of every careNotes window for rollback on failure. */
  previous: Array<[readonly unknown[], GetCareNotesResponse | undefined]>;
}

function invalidateCareNotes(
  queryClient: ReturnType<typeof useQueryClient>,
  circleId: string
): void {
  void queryClient.invalidateQueries({ queryKey: queryKeys.careNotes(circleId) });
  // New notes write an activity_feed row server-side.
  void queryClient.invalidateQueries({ queryKey: queryKeys.activityFeed(circleId) });
}

/**
 * Shared onError: count the failure for the admin digest (`error_occurred`,
 * mobile parity — ids/enums only, `code` from the closed-set
 * `classifyFailureCode`, never the note body or a message), then on a 402/403
 * refetch the stale circle access flags.
 */
function refreshFlagsOnPermissionError(
  queryClient: ReturnType<typeof useQueryClient>,
  circleId: string,
  error: unknown,
  action: FailureAction
): void {
  Analytics.errorOccurred('care_notes', `care_notes_${action}_failed`, {
    circle_id: circleId,
    ...failureContext('care_notes', action, error),
  });
  if (isPermissionDeniedError(error)) {
    invalidateCircleAccessFlags(queryClient, circleId);
  }
}

/**
 * Optimistic create. onMutate prepends a provisional note to every cached
 * window that covers its day (stamped with `input.note_date`, else the cached
 * `today` — the server remains authoritative, incl. the midnight boundary); onError rolls the
 * caches back; onSettled re-syncs from the server either way.
 */
export function useCreateCareNote(): UseMutationResult<
  CareNote,
  unknown,
  CreateCareNoteVariables,
  CreateCareNoteContext
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ circleId, input }: CreateCareNoteVariables) =>
      createCareNote(circleId, input),
    onMutate: async ({ circleId, input }) => {
      const prefix = queryKeys.careNotes(circleId);
      await queryClient.cancelQueries({ queryKey: prefix });

      const previous = queryClient.getQueriesData<GetCareNotesResponse>({
        queryKey: prefix,
      });

      const user = useAuthStore.getState().user;
      const nowIso = new Date().toISOString();

      // Filed under its own day in every cached window that covers it; a stable
      // sort with the new row first keeps it ahead of the rest of its day.
      for (const q of queryClient.getQueryCache().findAll({ queryKey: prefix })) {
        if (!windowCovers(q.queryKey, input.note_date ?? (q.state.data as GetCareNotesResponse | undefined)?.today ?? '')) continue;
        queryClient.setQueryData<GetCareNotesResponse>(q.queryKey, (old) => {
        if (!old) return old;
        const noteDate = input.note_date ?? old.today;
        const optimistic: CareNote = {
          id: `optimistic-${nowIso}`,
          circle_id: circleId,
          author_id: user?.id ?? '',
          note_date: noteDate,
          body: input.body ?? null,
          mood: input.mood ?? null,
          categories: input.categories ?? [],
          created_at: nowIso,
          updated_at: nowIso,
          author: user
            ? {
                id: user.id,
                first_name: user.first_name ?? null,
                last_name: user.last_name ?? null,
              }
            : null,
        };
        return {
          ...old,
          notes: [optimistic, ...old.notes].sort((a, b) =>
            a.note_date < b.note_date ? 1 : a.note_date > b.note_date ? -1 : 0
          ),
        };
        });
      }

      return { previous } satisfies CreateCareNoteContext;
    },
    onError: (error, variables, context) => {
      context?.previous.forEach(([key, data]) => {
        queryClient.setQueryData(key, data);
      });
      refreshFlagsOnPermissionError(queryClient, variables.circleId, error, 'create');
    },
    onSettled: (_note, _error, variables) => {
      invalidateCareNotes(queryClient, variables.circleId);
    },
  });
}

export function useUpdateCareNote(): UseMutationResult<
  CareNote,
  unknown,
  UpdateCareNoteVariables
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ circleId, noteId, input }: UpdateCareNoteVariables) =>
      updateCareNote(circleId, noteId, input),
    onSuccess: (_note, variables) => {
      invalidateCareNotes(queryClient, variables.circleId);
    },
    onError: (error, variables) =>
      refreshFlagsOnPermissionError(queryClient, variables.circleId, error, 'update'),
  });
}

export function useDeleteCareNote(): UseMutationResult<
  void,
  unknown,
  DeleteCareNoteVariables
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ circleId, noteId }: DeleteCareNoteVariables) =>
      deleteCareNote(circleId, noteId),
    onSuccess: (_void, variables) => {
      invalidateCareNotes(queryClient, variables.circleId);
    },
    onError: (error, variables) =>
      refreshFlagsOnPermissionError(queryClient, variables.circleId, error, 'delete'),
  });
}

import {
  keepPreviousData,
  useMutation,
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
import { isPermissionDeniedError } from '@/lib/apiErrors';
import { useAuthStore } from '@/store/authStore';

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

function refreshFlagsOnPermissionError(
  queryClient: ReturnType<typeof useQueryClient>,
  error: unknown
): void {
  if (isPermissionDeniedError(error)) {
    void queryClient.invalidateQueries({ queryKey: queryKeys.circles });
  }
}

/**
 * Optimistic create. onMutate prepends a provisional note to every cached
 * window (stamped with the cached `today` — the server remains authoritative
 * for the real note_date, incl. the midnight boundary); onError rolls the
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

      queryClient.setQueriesData<GetCareNotesResponse>({ queryKey: prefix }, (old) => {
        if (!old) return old;
        const optimistic: CareNote = {
          id: `optimistic-${nowIso}`,
          circle_id: circleId,
          author_id: user?.id ?? '',
          note_date: old.today,
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
        return { ...old, notes: [optimistic, ...old.notes] };
      });

      return { previous } satisfies CreateCareNoteContext;
    },
    onError: (error, _variables, context) => {
      context?.previous.forEach(([key, data]) => {
        queryClient.setQueryData(key, data);
      });
      refreshFlagsOnPermissionError(queryClient, error);
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
    onError: (error) => refreshFlagsOnPermissionError(queryClient, error),
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
    onError: (error) => refreshFlagsOnPermissionError(queryClient, error),
  });
}

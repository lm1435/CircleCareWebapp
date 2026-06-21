import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import {
  getEventNotes,
  createNote,
  updateNote,
  deleteNote,
  splitEventId,
  type EventNote,
} from '@/api/eventNotes';
import { queryKeys } from '@/lib/queryKeys';
import { isPermissionDeniedError } from '@/lib/apiErrors';

// PORT of mobile/src/hooks/useEventNotes.ts. Notes are INSTANCE-scoped: every
// hook splits the (possibly composite `parentUUID_YYYY-MM-DD`) eventId so the
// read query and the mutation-invalidation target the SAME real-parent-UUID +
// scheduled_date key (queryKeys.eventNotes). Mutations mirror the
// useMedConfirmation pattern: invalidate on success, and on a 402/403 permission
// rejection refetch the circle flags (the cached can_edit/view_only is stale)
// via the Stage 0 apiErrors helper. The mutation `error` is surfaced to the
// caller, which owns user-facing copy (i18n is Task 1.9, the panel is Task 1.8).

/**
 * Notes for an event instance. `eventId` may be a real UUID or the composite
 * `parentUUID_YYYY-MM-DD`; it is split so the query key + endpoint use the real
 * parent UUID and the instance date. "Scheduled date" defaults to whatever the
 * composite id carries unless passed explicitly.
 */
export function useEventNotes(
  circleId: string | undefined,
  eventId: string | undefined,
  scheduledDate?: string
): UseQueryResult<EventNote[]> {
  const split = eventId ? splitEventId(eventId, scheduledDate) : undefined;

  return useQuery({
    queryKey: queryKeys.eventNotes(circleId ?? '', split?.eventId ?? '', split?.scheduledDate),
    queryFn: () => getEventNotes(circleId!, split!.eventId, split!.scheduledDate),
    enabled: !!circleId && !!eventId,
  });
}

interface CreateNoteVariables {
  circleId: string;
  eventId: string;
  body: string;
  scheduledDate?: string;
}

interface UpdateNoteVariables {
  circleId: string;
  eventId: string;
  noteId: string;
  body: string;
}

interface DeleteNoteVariables {
  circleId: string;
  eventId: string;
  noteId: string;
}

/**
 * Invalidate the note list for an instance plus the calendar + activity feeds
 * (mirrors mobile's onSuccess). The eventNotes key is computed from the SPLIT
 * id so it matches whatever `useEventNotes` registered.
 */
function invalidateNotes(
  queryClient: ReturnType<typeof useQueryClient>,
  circleId: string,
  eventId: string,
  scheduledDate?: string
): void {
  const split = splitEventId(eventId, scheduledDate);
  void queryClient.invalidateQueries({
    queryKey: queryKeys.eventNotes(circleId, split.eventId, split.scheduledDate),
  });
  void queryClient.invalidateQueries({ queryKey: queryKeys.calendarEvents(circleId) });
  void queryClient.invalidateQueries({ queryKey: queryKeys.activityFeed(circleId) });
}

/**
 * On a 402/403 permission rejection the cached circle access flags
 * (`can_edit`/`view_only`/`read_only`) are stale — refetch them so gated UI
 * recovers. Mirrors useConfirmMedication's onError. Non-permission errors are
 * left for the caller to surface.
 */
function refreshFlagsOnPermissionError(
  queryClient: ReturnType<typeof useQueryClient>,
  error: unknown
): void {
  if (isPermissionDeniedError(error)) {
    void queryClient.invalidateQueries({ queryKey: queryKeys.circles });
  }
}

export function useCreateNote(): UseMutationResult<EventNote, unknown, CreateNoteVariables> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ circleId, eventId, body, scheduledDate }: CreateNoteVariables) =>
      createNote(circleId, eventId, { body, scheduled_date: scheduledDate }),
    onSuccess: (_note, variables) => {
      invalidateNotes(queryClient, variables.circleId, variables.eventId, variables.scheduledDate);
    },
    onError: (error) => refreshFlagsOnPermissionError(queryClient, error),
  });
}

export function useUpdateNote(): UseMutationResult<EventNote, unknown, UpdateNoteVariables> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ circleId, eventId, noteId, body }: UpdateNoteVariables) =>
      updateNote(circleId, eventId, noteId, { body }),
    onSuccess: (_note, variables) => {
      invalidateNotes(queryClient, variables.circleId, variables.eventId);
    },
    onError: (error) => refreshFlagsOnPermissionError(queryClient, error),
  });
}

export function useDeleteNote(): UseMutationResult<void, unknown, DeleteNoteVariables> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ circleId, eventId, noteId }: DeleteNoteVariables) =>
      deleteNote(circleId, eventId, noteId),
    onSuccess: (_void, variables) => {
      invalidateNotes(queryClient, variables.circleId, variables.eventId);
    },
    onError: (error) => refreshFlagsOnPermissionError(queryClient, error),
  });
}

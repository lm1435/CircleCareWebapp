import { useState, type FormEvent, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, ConfirmDialog, Spinner, TextArea, useToast } from '@/components/ui';
import { formatRelativeTime } from '@/components/activity/activityFormat';
import { useCircle } from '@/hooks/useCircle';
import { useAuthStore } from '@/store/authStore';
import { useCreateNote, useDeleteNote, useEventNotes, useUpdateNote } from '@/hooks/useEventNotes';
import type { EventNote } from '@/api/eventNotes';

// Task 1.8 — PORT of mobile/src/screens/calendar/EventNotesScreen.tsx, adapted
// to the web design system + Stage 0 primitives. Notes are INSTANCE-scoped: the
// raw `eventId` may be a composite `parentUUID_YYYY-MM-DD`; the api/hook layer
// already splits it (see api/eventNotes.ts), so we pass the raw id + optional
// scheduledDate straight through.
//
// Permission rules mirrored from mobile EventNotesScreen:
//   - CREATE: any circle member with edit access (canEdit) — composer hidden
//     entirely when !canEdit.
//   - EDIT:   author of the note ONLY (onEdit passed only when isOwn).
//   - DELETE: author of the note OR the circle owner (onDelete passed when
//     isOwn || isCircleOwner).
// The backend enforces all three regardless (requireCircleEditAccess +
// author/owner checks); the UI gating is cosmetic-but-faithful.

// Body length cap — mirrors the backend `body (1-2000)` Zod rule.
const MAX_NOTE_LENGTH = 2000;

export interface EventNotesPanelProps {
  /** Circle the event belongs to. */
  circleId: string;
  /**
   * The event's instance id. May be a real UUID or the composite
   * `parentUUID_YYYY-MM-DD` for a virtual recurring instance — passed through
   * to the api/hook layer which splits it.
   */
  eventId: string;
  /** Instance date for a virtual recurring instance (YYYY-MM-DD), if any. */
  scheduledDate?: string;
}

interface NoteRowProps {
  note: EventNote;
  canEditOwn: boolean;
  canDelete: boolean;
  editing: boolean;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSaveEdit: (body: string) => void;
  onDelete: () => void;
  savePending: boolean;
}

function NoteRow({
  note,
  canEditOwn,
  canDelete,
  editing,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onDelete,
  savePending,
}: NoteRowProps): ReactElement {
  const { t, i18n } = useTranslation(['calendar', 'activity', 'common']);
  const [draft, setDraft] = useState(note.body);

  const authorName = `${note.author.first_name} ${note.author.last_name ?? ''}`.trim();
  // created_at is a UTC ISO timestamp → relative time via the activity namespace.
  const timestamp = formatRelativeTime(
    note.created_at,
    (key, opts) => t(`activity:${key}`, opts),
    i18n.language
  );

  if (editing) {
    return (
      <li className="rounded-xl border border-line bg-cream p-4">
        <TextArea
          id={`note-edit-${note.id}`}
          label={t('calendar:notes.editLabel')}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          maxLength={MAX_NOTE_LENGTH}
          rows={3}
          autoFocus
        />
        <div className="mt-3 flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onCancelEdit}>
            {t('calendar:notes.cancel')}
          </Button>
          <Button
            size="md"
            onClick={() => onSaveEdit(draft.trim())}
            disabled={!draft.trim() || savePending}
          >
            {t('calendar:notes.save')}
          </Button>
        </div>
      </li>
    );
  }

  return (
    <li className="rounded-xl border border-line bg-cream p-4">
      <div className="flex items-baseline justify-between gap-3">
        <span className="min-w-0 truncate text-sm font-medium text-ink">{authorName}</span>
        <span className="mono shrink-0">{timestamp}</span>
      </div>
      <p className="m-0 mt-1.5 whitespace-pre-wrap break-words text-base text-ink-2">{note.body}</p>
      {(canEditOwn || canDelete) && (
        <div className="mt-2 flex justify-end gap-2">
          {canEditOwn && (
            <Button variant="ghost" size="sm" onClick={onStartEdit}>
              {t('calendar:notes.edit')}
            </Button>
          )}
          {canDelete && (
            <Button variant="ghost" size="sm" onClick={onDelete}>
              {t('calendar:notes.delete')}
            </Button>
          )}
        </div>
      )}
    </li>
  );
}

/**
 * Notes panel for a calendar event instance: list + composer (create) +
 * inline edit (own notes) + delete (own note or circle owner, via ConfirmDialog).
 * Mounted inside `EventDetailModal`.
 */
export function EventNotesPanel({
  circleId,
  eventId,
  scheduledDate,
}: EventNotesPanelProps): ReactElement {
  const { t } = useTranslation(['calendar', 'activity', 'common']);
  const { showToast } = useToast();

  const currentUserId = useAuthStore((s) => s.user?.id);
  const { circle, canEdit } = useCircle(circleId);
  const isCircleOwner = !!circle && !!currentUserId && circle.owner_id === currentUserId;

  const notesQuery = useEventNotes(circleId, eventId, scheduledDate);
  const createNote = useCreateNote();
  const updateNote = useUpdateNote();
  const deleteNote = useDeleteNote();

  const [composer, setComposer] = useState('');
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [deletingNoteId, setDeletingNoteId] = useState<string | null>(null);

  function handleCreate(e: FormEvent): void {
    e.preventDefault();
    const body = composer.trim();
    if (!body || createNote.isPending) return;
    createNote.mutate(
      { circleId, eventId, body, scheduledDate },
      {
        onSuccess: () => setComposer(''),
        onError: () => showToast(t('calendar:notes.errorSaving'), 'error'),
      }
    );
  }

  function handleSaveEdit(noteId: string, body: string): void {
    if (!body || updateNote.isPending) return;
    updateNote.mutate(
      { circleId, eventId, noteId, body },
      {
        onSuccess: () => setEditingNoteId(null),
        onError: () => showToast(t('calendar:notes.errorSaving'), 'error'),
      }
    );
  }

  function handleConfirmDelete(): void {
    if (!deletingNoteId || deleteNote.isPending) return;
    deleteNote.mutate(
      { circleId, eventId, noteId: deletingNoteId },
      {
        onSuccess: () => setDeletingNoteId(null),
        onError: () => {
          setDeletingNoteId(null);
          showToast(t('calendar:notes.errorSaving'), 'error');
        },
      }
    );
  }

  const notes = notesQuery.data ?? [];

  let list: ReactElement;
  if (notesQuery.isPending) {
    list = (
      <div className="flex justify-center py-4" aria-busy="true">
        <Spinner />
      </div>
    );
  } else if (notesQuery.isError) {
    list = (
      <div className="text-sm text-ink-3">
        <p className="m-0 mb-2">{t('calendar:notes.loadError')}</p>
        <Button variant="ghost" size="sm" onClick={() => void notesQuery.refetch()}>
          {t('common:retry')}
        </Button>
      </div>
    );
  } else if (notes.length === 0) {
    list = <p className="m-0 text-sm text-ink-3">{t('calendar:notes.empty')}</p>;
  } else {
    list = (
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {notes.map((note) => {
          const isOwn = note.author_id === currentUserId;
          // EDIT: author only. DELETE: author or circle owner. Both also require
          // edit access to the circle (mobile shows the affordances only when the
          // user can act; backend enforces requireCircleEditAccess regardless).
          const canEditOwn = canEdit && isOwn && editingNoteId === null;
          const canDelete = canEdit && (isOwn || isCircleOwner);
          return (
            <NoteRow
              key={note.id}
              note={note}
              canEditOwn={canEditOwn}
              canDelete={canDelete}
              editing={editingNoteId === note.id}
              onStartEdit={() => setEditingNoteId(note.id)}
              onCancelEdit={() => setEditingNoteId(null)}
              onSaveEdit={(body) => handleSaveEdit(note.id, body)}
              onDelete={() => setDeletingNoteId(note.id)}
              savePending={updateNote.isPending}
            />
          );
        })}
      </ul>
    );
  }

  const deletingNote = notes.find((n) => n.id === deletingNoteId) ?? null;

  return (
    <section aria-labelledby="event-notes-heading" className="flex flex-col gap-3">
      <h3 id="event-notes-heading" className="section-title m-0">
        {t('calendar:notes.title')}
      </h3>

      {list}

      {canEdit && (
        <form onSubmit={handleCreate} className="flex flex-col gap-2">
          <TextArea
            id="event-note-composer"
            label={t('calendar:notes.composerLabel')}
            placeholder={t('calendar:notes.composerPlaceholder')}
            value={composer}
            onChange={(e) => setComposer(e.target.value)}
            maxLength={MAX_NOTE_LENGTH}
            rows={3}
          />
          <div className="flex justify-end">
            <Button type="submit" size="md" disabled={!composer.trim() || createNote.isPending}>
              {t('calendar:notes.add')}
            </Button>
          </div>
        </form>
      )}

      {deletingNote && (
        <ConfirmDialog
          title={t('calendar:notes.deleteTitle')}
          message={t('calendar:notes.deleteConfirm')}
          confirmLabel={t('calendar:notes.delete')}
          cancelLabel={t('calendar:notes.cancel')}
          destructive
          confirmDisabled={deleteNote.isPending}
          onConfirm={handleConfirmDelete}
          onCancel={() => setDeletingNoteId(null)}
        />
      )}
    </section>
  );
}

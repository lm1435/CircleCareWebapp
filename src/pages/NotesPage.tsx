import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  Sheet,
  Skeleton,
  careCardListGap,
  careCardShell,
  useToast,
} from '@/components/ui';
import { PageMasthead } from '@/components/layout/PageMasthead';
import { CareTabs } from '@/components/layout/CareTabs';
import { ViewOnlyBanner } from '@/components/ViewOnlyBanner';
import { NoteComposer, EMPTY_NOTE_DRAFT, type NoteDraft } from '@/components/notes/NoteComposer';
import { NoteRow } from '@/components/notes/NoteRow';
import {
  useCareNotes,
  useCreateCareNote,
  useDeleteCareNote,
  useUpdateCareNote,
} from '@/hooks/useCareNotes';
import { useCircle } from '@/hooks/useCircle';
import { useAuthStore } from '@/store/authStore';
import { Analytics } from '@/lib/analytics';
import type { CareNote, CareNoteInput } from '@/api/careNotes';

// Daily Care Notes page (Wave 3, Task 16 — mobile-parity pass) — the web twin
// of mobile's NotesTab. A shared per-circle day journal: composer at the top
// (today only — note_date is stamped SERVER-side in the recipient TZ, never
// computed here), then entries grouped by day, reverse-chron, with
// recipient-TZ day labels. Own entries get an edit/delete MoreMenu; the circle
// owner can delete any entry. View-only members see the thread but no
// composer (ViewOnlyBanner, tasks idiom). Posting is OPTIMISTIC: the hook
// prepends the note, the composer clears immediately, and on failure the hook
// rolls back while we restore the draft (input preserved) + show a toast.

const SKELETON_ROWS = [0, 1, 2];

/** Server default window (last 14 days) and hard cap (92 days) per the API. */
const DEFAULT_WINDOW_DAYS = 14;
const PAGE_WINDOW_DAYS = 14;
const MAX_WINDOW_DAYS = 92;

/**
 * Shift a YYYY-MM-DD date string by whole days. Anchored at UTC noon so the
 * calendar day never slips across midnight in any timezone (project rule —
 * never Date.setDate on local-time parses).
 */
function shiftDateString(dateString: string, days: number): string {
  const date = new Date(`${dateString}T12:00:00Z`);
  date.setTime(date.getTime() + days * 24 * 60 * 60 * 1000);
  return date.toISOString().slice(0, 10);
}

interface DayGroup {
  date: string;
  notes: CareNote[];
}

/** Serialize a draft for the API: omit empty fields on create. */
function draftToInput(draft: NoteDraft): CareNoteInput {
  const body = draft.body.trim();
  return {
    ...(body ? { body } : {}),
    ...(draft.mood ? { mood: draft.mood } : {}),
    ...(draft.categories.length > 0 ? { categories: draft.categories } : {}),
  };
}

export default function NotesPage(): ReactElement {
  const { circleId = '' } = useParams<{ circleId: string }>();
  const { t, i18n } = useTranslation(['notes', 'common']);
  const { showToast } = useToast();

  const currentUserId = useAuthStore((s) => s.user?.id);
  const { circle, canEdit } = useCircle(circleId);
  const isCircleOwner = !!circle && !!currentUserId && circle.owner_id === currentUserId;

  // Date-window paging: undefined = server default (last 14 days); "Show
  // earlier notes" walks `from` back in 14-day pages up to the 92-day cap.
  const [fromDate, setFromDate] = useState<string | undefined>(undefined);
  const notesQuery = useCareNotes(circleId, fromDate ? { from: fromDate } : undefined);

  const createMutation = useCreateCareNote();
  const updateMutation = useUpdateCareNote();
  const deleteMutation = useDeleteCareNote();

  const [draft, setDraft] = useState<NoteDraft>(EMPTY_NOTE_DRAFT);
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [deletingNoteId, setDeletingNoteId] = useState<string | null>(null);

  // Instrumented from day one (the vitals lesson) — ids only, never content.
  useEffect(() => {
    if (circleId) Analytics.careNotesViewed(circleId);
  }, [circleId]);

  const notes = useMemo(() => notesQuery.data?.notes ?? [], [notesQuery.data]);
  // Server-resolved "today" + timezone (recipient TZ fallback chain applied).
  const today = notesQuery.data?.today;
  const timezone = notesQuery.data?.timezone ?? 'America/New_York';

  // Group by note_date, dates descending. Server order is already
  // note_date DESC, created_at DESC; grouping preserves in-day order and the
  // date sort keeps an optimistic prepend from disturbing older groups.
  const groups = useMemo<DayGroup[]>(() => {
    const byDate = new Map<string, CareNote[]>();
    for (const note of notes) {
      const group = byDate.get(note.note_date);
      if (group) {
        group.push(note);
      } else {
        byDate.set(note.note_date, [note]);
      }
    }
    return Array.from(byDate.entries())
      .sort(([a], [b]) => (a < b ? 1 : -1))
      .map(([date, dayNotes]) => ({ date, notes: dayNotes }));
  }, [notes]);

  const yesterday = today ? shiftDateString(today, -1) : undefined;

  function dayLabel(date: string): string {
    if (today && date === today) return t('notes:day.today');
    if (yesterday && date === yesterday) return t('notes:day.yesterday');
    // Render the naive YYYY-MM-DD at UTC noon so the labeled day never shifts
    // across timezones (tasks idiom).
    return new Intl.DateTimeFormat(i18n.language, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(new Date(`${date}T12:00:00Z`));
  }

  // ── Composer (create) ──────────────────────────────────────────────────────
  function handlePost(): void {
    const submitted = draft;
    const input = draftToInput(submitted);
    if (input.body === undefined && input.mood === undefined) return;
    if (createMutation.isPending) return;

    // Optimistic: the hook prepends the note; clear the composer now.
    setDraft(EMPTY_NOTE_DRAFT);
    createMutation.mutate(
      { circleId, input },
      {
        onSuccess: () => {
          // WB8: mood dropped from the payload — "ids only, never content" for
          // this event family (careNotesViewed docstring), and mood is
          // user-authored health content, not an id/count/enum-of-fixed-shape.
          Analytics.careNoteAdded(circleId, {
            categoryCount: submitted.categories.length,
          });
        },
        onError: () => {
          showToast(t('notes:composer.errorPosting'), 'error');
          // Preserve the input: restore the submitted draft unless the user
          // has already started composing a new note.
          setDraft((current) =>
            current.body === '' && current.mood === null && current.categories.length === 0
              ? submitted
              : current
          );
        },
      }
    );
  }

  // ── Inline edit (own notes) ────────────────────────────────────────────────
  function handleSaveEdit(noteId: string, edited: NoteDraft): void {
    if (updateMutation.isPending) return;
    const body = edited.body.trim();
    // The edit composer's gate mirrors the server refine (body-or-mood).
    if (!body && !edited.mood) return;
    updateMutation.mutate(
      {
        circleId,
        noteId,
        // PATCH sends explicit values (null clears) — the result must still
        // satisfy body-or-mood, enforced above and by the server refine.
        input: { body: body || null, mood: edited.mood, categories: edited.categories },
      },
      {
        onSuccess: () => {
          // Mirrors careNoteAdded: category COUNT only, never mood/body/names.
          Analytics.careNoteUpdated(circleId, { categoryCount: edited.categories.length });
          setEditingNoteId(null);
        },
        onError: () => showToast(t('notes:composer.errorSaving'), 'error'),
      }
    );
  }

  // ── Delete (own note, or any note for the circle owner) ───────────────────
  function handleConfirmDelete(): void {
    if (!deletingNoteId || deleteMutation.isPending) return;
    deleteMutation.mutate(
      { circleId, noteId: deletingNoteId },
      {
        onSuccess: () => {
          Analytics.careNoteDeleted(circleId);
          setDeletingNoteId(null);
        },
        onError: () => {
          setDeletingNoteId(null);
          showToast(t('notes:composer.errorSaving'), 'error');
        },
      }
    );
  }

  // ── Older pages ────────────────────────────────────────────────────────────
  const oldestAllowed = today ? shiftDateString(today, -(MAX_WINDOW_DAYS - 1)) : undefined;
  const currentFrom =
    fromDate ?? (today ? shiftDateString(today, -(DEFAULT_WINDOW_DAYS - 1)) : undefined);
  const canLoadOlder =
    !!today && !!oldestAllowed && !!currentFrom && currentFrom > oldestAllowed;

  function handleLoadOlder(): void {
    if (!currentFrom || !oldestAllowed) return;
    const next = shiftDateString(currentFrom, -PAGE_WINDOW_DAYS);
    setFromDate(next < oldestAllowed ? oldestAllowed : next);
  }

  // ── Body ───────────────────────────────────────────────────────────────────
  let body: ReactElement;
  if (notesQuery.isLoading) {
    body = (
      <ul className={`${careCardListGap} m-0 list-none p-0 px-5`} aria-busy="true">
        <li className="sr-only">{t('notes:loading')}</li>
        {SKELETON_ROWS.map((row) => (
          <li key={row} className={careCardShell}>
            <div className="flex items-center gap-2.5">
              <Skeleton className="h-9 w-9 rounded-full" />
              <Skeleton className="h-4 w-32" />
            </div>
            <Skeleton className="mt-3 h-4 w-2/3 max-w-64" />
          </li>
        ))}
      </ul>
    );
  } else if (notesQuery.isError) {
    body = (
      <Card className="mx-5 text-center">
        <p className="m-0 font-medium text-ink">{t('notes:errorTitle')}</p>
        <p className="m-0 mt-1 text-sm text-ink-3">{t('notes:errorHint')}</p>
        <Button variant="ghost" className="mt-4" onClick={() => void notesQuery.refetch()}>
          {t('common:retry')}
        </Button>
      </Card>
    );
  } else if (notes.length === 0) {
    // Calm empty state — no starter chips (empty-states-stay-calm lesson);
    // the composer above is the call to action.
    body = (
      <div className="px-5">
        <EmptyState
          tone="dusk"
          icon="document-text-outline"
          title={t('notes:empty.title')}
          description={t('notes:empty.hint')}
        />
      </div>
    );
  } else {
    body = (
      <div className="flex flex-col gap-6 px-5">
        {groups.map((group) => (
          <section key={group.date} aria-label={dayLabel(group.date)}>
            <h2 className="m-0 text-base font-semibold text-ink">{dayLabel(group.date)}</h2>
            <ul className={`${careCardListGap} m-0 mt-3 list-none p-0`}>
              {group.notes.map((note) => {
                const isOwn = note.author_id === currentUserId;
                return (
                  <NoteRow
                    key={note.id}
                    note={note}
                    timezone={timezone}
                    canEditOwn={canEdit && isOwn && editingNoteId === null}
                    canDelete={canEdit && (isOwn || isCircleOwner)}
                    editing={editingNoteId === note.id}
                    onStartEdit={() => setEditingNoteId(note.id)}
                    onCancelEdit={() => setEditingNoteId(null)}
                    onSaveEdit={(edited) => handleSaveEdit(note.id, edited)}
                    onDelete={() => setDeletingNoteId(note.id)}
                    savePending={updateMutation.isPending}
                  />
                );
              })}
            </ul>
          </section>
        ))}
        {canLoadOlder && (
          <div className="flex justify-center">
            <Button variant="ghost" onClick={handleLoadOlder} disabled={notesQuery.isFetching}>
              {t('notes:loadOlder')}
            </Button>
          </div>
        )}
      </div>
    );
  }

  const deletingNote = notes.find((n) => n.id === deletingNoteId) ?? null;

  return (
    <section className="mx-auto w-full max-w-5xl pb-8">
      <PageMasthead section={t('common:nav.notes')} tone="dusk" title={t('notes:title')} subtitle={t('notes:subtitle')}>
        <CareTabs />
      </PageMasthead>

      {!!circle && !canEdit && <ViewOnlyBanner className="mx-5 mt-4" />}

      {/* One editing surface at a time: the create composer hides while an
          inline edit is active (mirrors mobile). */}
      {canEdit && editingNoteId === null && (
        <div className="px-5 pb-4 pt-4">
          <Sheet padding="sm">
            <NoteComposer
              idPrefix="care-note"
              draft={draft}
              onChange={setDraft}
              onSubmit={handlePost}
              submitLabel={t('notes:composer.post')}
              submitting={createMutation.isPending}
            />
          </Sheet>
        </div>
      )}

      <div className="mt-2">{body}</div>

      {deletingNote && (
        <ConfirmDialog
          title={t('notes:deleteTitle')}
          message={t('notes:deleteConfirm')}
          confirmLabel={t('notes:row.delete')}
          cancelLabel={t('notes:composer.cancel')}
          destructive
          confirmDisabled={deleteMutation.isPending}
          onConfirm={handleConfirmDelete}
          onCancel={() => setDeletingNoteId(null)}
        />
      )}
    </section>
  );
}

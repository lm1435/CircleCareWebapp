import { HowDoesThisWork } from '@/components/help/HowDoesThisWork';
import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { prefersReducedMotion } from '@/components/ui/motion';
import { useLocation, useParams, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  Icon,
  Sheet,
  Skeleton,
  careCardListGap,
  careCardShell,
  useToast,
} from '@/components/ui';
import { RemovedState } from '@/components/RemovedState';
import { useEmailLinkLanding } from '@/lib/emailLinkLanding';
import { PageMasthead } from '@/components/layout/PageMasthead';
import { CareTabs } from '@/components/layout/CareTabs';
import { ViewOnlyBanner } from '@/components/ViewOnlyBanner';
import { useSessionDraft } from '@/hooks/useSessionDraft';
import { NoteComposer, EMPTY_NOTE_DRAFT, type NoteDraft } from '@/components/notes/NoteComposer';
import { NoteRow, formatNoteTime } from '@/components/notes/NoteRow';
import { formatDateForDisplay } from '@/components/calendar/dateMath';
import { useHourCycle } from '@/hooks/useHourCycle';
import { HOLD, notesSummary } from '@/lib/pageSummaries';
import { MoodWeekStrip } from '@/components/notes/MoodWeekStrip';
import {
  useCareNotes,
  useCreateCareNote,
  useDeleteCareNote,
  useOlderCareNotes,
  useUpdateCareNote,
} from '@/hooks/useCareNotes';
import {
  NOTE_PAGE_DAYS,
  daysBetween,
  olderPagesNeeded,
  shiftDateBack,
  loadedNotesFloor,
  olderNotesExist,
  olderSeekPages,
} from '@/lib/noteDate';
import { useCircle } from '@/hooks/useCircle';
import { useSubmitGuard } from '@/hooks/useGuardedSubmit';
import { useAuthStore } from '@/store/authStore';
import { Analytics } from '@/lib/analytics';
import type { CareNote, CareNoteInput } from '@/api/careNotes';
import { blockOfflineWrite } from '@/lib/offlineWrite';

// Daily Care Notes page (Wave 3, Task 16 — mobile-parity pass) — the web twin
// of mobile's NotesTab. A shared per-circle day journal: composer at the top
// (today by default; a past day via the Date row — "today" is always the
// server-resolved recipient-TZ value, never the browser's), then entries grouped by day, reverse-chron, with
// recipient-TZ day labels. Own entries get an edit/delete MoreMenu; the circle
// owner can delete any entry. View-only members see the thread but no
// composer (ViewOnlyBanner, tasks idiom). Posting is OPTIMISTIC: the hook
// prepends the note, the composer clears immediately, and on failure the hook
// rolls back while we restore the draft (input preserved) + show a toast.

const SKELETON_ROWS = [0, 1, 2];

/**
 * Server default window (last 14 days). "Show older notes" widens it straight
 * to one full 92-day server page (and on to the next older page when that
 * brought nothing new), then loads whole 92-day pages before it, repeatably,
 * with no cap (lib/noteDate.ts, useOlderCareNotes).
 */
const DEFAULT_WINDOW_DAYS = 14;
const MAX_WINDOW_DAYS = NOTE_PAGE_DAYS;

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

/** Strict YYYY-MM-DD — anything else from `?date=` is ignored outright. */
const DATE_PARAM_RE = /^\d{4}-\d{2}-\d{2}$/;

/** The DOM id a day-group `<section>` renders under — shared by the mood
 *  strip's `onSelectDay` and the `?date=` deep-link effect below, so both
 *  scroll to exactly the same element. */
function dayGroupElementId(date: string): string {
  return `notes-day-${date}`;
}

/** Returns whether the day-group element existed (and was scrolled to). */
function scrollToDayGroup(date: string): boolean {
  const el = document.getElementById(dayGroupElementId(date));
  // Reduced motion honoured (WCAG 2.3.3; the CSS block cannot reach a JS scroll).
  el?.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
  return !!el;
}

interface DayGroup {
  date: string;
  notes: CareNote[];
}

/** Serialize a draft for the API: omit empty fields on create. `note_date` only
 *  for a past day, so the common payload is unchanged. */
function draftToInput(draft: NoteDraft, today: string | undefined): CareNoteInput {
  const body = draft.body.trim();
  return {
    ...(draft.noteDate && today && draft.noteDate !== today ? { note_date: draft.noteDate } : {}),
    ...(body ? { body } : {}),
    ...(draft.mood ? { mood: draft.mood } : {}),
    ...(draft.categories.length > 0 ? { categories: draft.categories } : {}),
  };
}

export default function NotesPage(): ReactElement {
  const { circleId = '' } = useParams<{ circleId: string }>();
  const { t, i18n } = useTranslation(['notes', 'common']);
  const { showToast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();

  const currentUserId = useAuthStore((s) => s.user?.id);
  const { circle, canEdit } = useCircle(circleId);
  const isCircleOwner = !!circle && !!currentUserId && circle.owner_id === currentUserId;

  // Date-window paging: undefined = server default (last 14 days); "Show
  // older notes" widens `from` straight to the 92-day cap (handleLoadOlder).
  const [fromDate, setFromDate] = useState<string | undefined>(undefined);
  const notesQuery = useCareNotes(circleId, fromDate ? { from: fromDate } : undefined);

  // `?date=YYYY-MM-DD` deep link (web-only Slice 2 part + Slice 3's strip):
  // captured ONCE, before the effect below scrubs it from the URL — reading
  // `searchParams.get('date')` directly anywhere past the first render would
  // see nothing to act on. An invalid/malformed value is dropped right here
  // ("Invalid ... dates: ignore" — the page just renders normally).
  const [pendingDate, setPendingDate] = useState<string | null>(() => {
    const raw = searchParams.get('date');
    return raw && DATE_PARAM_RE.test(raw) ? raw : null;
  });
  const scrolledForDateRef = useRef(false);
  // A dated link that came from an email (`?src=`) and lands on a day with no
  // notes (deleted, or never there) shows the shared removed state. In-app
  // `?date=` jumps (no `src`) keep scrolling silently as before.
  const [removedDate, setRemovedDate] = useState<string | null>(null);
  const fromEmail = Boolean(searchParams.get('src'));
  // Only the FIRST dated jump is the email's; `src` stays in the URL, so a later
  // in-app day pick must not be mistaken for it.
  const emailLinkResolvedRef = useRef(false);
  const reportLanding = useEmailLinkLanding();
  useEffect(() => {
    // A `?date=` that is not a real YYYY-MM-DD names nothing we can resolve.
    if (searchParams.has('date') && !pendingDate) reportLanding(false);
    // Mount-only: the captured link never changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Older history beyond the base 92-day window: whole pages, no cap.
  const [olderPages, setOlderPages] = useState(0);
  // Set by a "Show older notes" press that widened the base window (see handleLoadOlder).
  const [olderPendingFrom, setOlderPendingFrom] = useState<string | null>(null);
  // oldest_note_date known (additive backend field, 2026-11-09): the floor loaded BEFORE the press,
  // held while the press steps back to the next older note; and whether the person has asked for
  // older notes (only then "No older notes" is said).
  const [olderSeekFloor, setOlderSeekFloor] = useState<string | null>(null);
  const [olderAsked, setOlderAsked] = useState(false);

  const createMutation = useCreateCareNote();
  const updateMutation = useUpdateCareNote();
  const deleteMutation = useDeleteCareNote();
  // One guard per action (see `handlePost`): three different controls that must
  // not block each other.
  const postGuard = useSubmitGuard();
  const editGuard = useSubmitGuard();
  const deleteGuard = useSubmitGuard();

  const [draft, setDraft] = useState<NoteDraft>(EMPTY_NOTE_DRAFT);
  const [postError, setPostError] = useState<string | null>(null);
  // The create composer is COLLAPSED into an "Add a note" button (owner 2026-11-07, mobile parity).
  // It also shows whenever there is something in it (a restored session draft, or the text kept after
  // a failed post) so nothing typed is ever hidden.
  // The New menu's "Note" entry navigates here with `composeNote` state: arrive with it open.
  const location = useLocation();
  const [composerOpen, setComposerOpen] = useState(
    () => (location.state as { composeNote?: boolean } | null)?.composeNote === true
  );
  const addNoteRef = useRef<HTMLButtonElement>(null);
  const composerWrapRef = useRef<HTMLDivElement>(null);
  // Bring the composer into view on every open (header action or the button under the notes);
  // a second header press while it is open scrolls back to it.
  const [composerScrollTick, setComposerScrollTick] = useState(0);
  const openComposer = (): void => {
    setComposerOpen(true);
    setComposerScrollTick((n) => n + 1);
  };
  useEffect(() => {
    if (composerScrollTick === 0) return;
    // Reduced motion honoured (WCAG 2.3.3).
    composerWrapRef.current?.scrollIntoView?.({
      behavior: prefersReducedMotion() ? 'auto' : 'smooth',
      block: 'center',
    });
  }, [composerScrollTick]);
  const wasComposerShownRef = useRef(false);
  // PK9: the post clears the composer optimistically, so a session that dies
  // MID-post would otherwise find it empty. Holds the submitted draft until the
  // post settles; the forced-sign-out snapshot falls back to it.
  const inFlightDraftRef = useRef<NoteDraft | null>(null);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  useSessionDraft<NoteDraft>(
    circleId ? `notes:create:${circleId}` : null,
    () => {
      const d = draftRef.current;
      const live = d.body.trim() !== '' || d.mood !== null || d.categories.length > 0;
      return live ? d : inFlightDraftRef.current;
    },
    (restored) => setDraft({ ...EMPTY_NOTE_DRAFT, ...restored })
  );
  const draftIsLive = draft.body.trim() !== '' || draft.mood !== null || draft.categories.length > 0;
  const composerShown = composerOpen || draftIsLive || postError !== null;
  // Focus management: when the composer closes (posted, cancelled), the focused control is gone, so
  // hand focus to the button that reopens it instead of dropping it on <body>.
  useEffect(() => {
    if (wasComposerShownRef.current && !composerShown) addNoteRef.current?.focus();
    wasComposerShownRef.current = composerShown;
  }, [composerShown]);
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [deletingNoteId, setDeletingNoteId] = useState<string | null>(null);

  // Instrumented from day one (the vitals lesson) — ids only, never content.
  useEffect(() => {
    if (circleId) Analytics.careNotesViewed(circleId);
  }, [circleId]);

  // Server-resolved "today" + timezone (recipient TZ fallback chain applied).
  const today = notesQuery.data?.today;
  const older = useOlderCareNotes(circleId, today, olderPages);
  const notes = useMemo(
    () =>
      older.notes.length > 0
        ? [...(notesQuery.data?.notes ?? []), ...older.notes]
        : (notesQuery.data?.notes ?? []),
    [notesQuery.data, older.notes]
  );
  const timezone = notesQuery.data?.timezone ?? 'America/New_York';
  const hourCycle = useHourCycle();

  // Widen the window to include `pendingDate` (older pages past 92 days), then
  // scroll to it once loaded — a single effect re-evaluated on every render
  // so the widen and the eventual scroll never race each other (widening
  // schedules a state update; this effect simply runs again with the fresher
  // `fromDate`/query state on the next pass instead of assuming one happened
  // before the other within the same commit).
  useEffect(() => {
    if (!pendingDate || scrolledForDateRef.current || !today) return;

    if (pendingDate > today) {
      // In the future — ignore outright; never touch the window for it.
      scrolledForDateRef.current = true;
      reportLanding(false);
      return;
    }

    // Widen to reach the date: the base window first (up to 92 days), then
    // whole older pages (no cap).
    const loadedFrom = fromDate ?? shiftDateBack(today, DEFAULT_WINDOW_DAYS - 1);
    const daysBack = daysBetween(pendingDate, today);
    if (pendingDate < loadedFrom) {
      const baseFloor = shiftDateBack(today, MAX_WINDOW_DAYS - 1);
      setFromDate(pendingDate < baseFloor ? baseFloor : pendingDate);
      const pagesNeeded = olderPagesNeeded(daysBack);
      if (pagesNeeded > olderPages) setOlderPages(pagesNeeded);
      return; // re-run once the widened window's data lands
    }
    if (olderPagesNeeded(daysBack) > olderPages) {
      setOlderPages(olderPagesNeeded(daysBack));
      return;
    }

    // `useCareNotes`'s `placeholderData: keepPreviousData` can report
    // `isLoading`/`isFetching` as false for ONE render on the OLD (narrower)
    // window's data, one tick before the widened fetch's in-flight state
    // registers. Gating on that alone let this effect scroll (and fail
    // silently — `getElementById` on stale groups) against data that didn't
    // cover `pendingDate` yet, then consume the ref/param so it never
    // retried. Gate on `isPlaceholderData` too: only settled, non-placeholder
    // data for the CURRENT `fromDate` is trustworthy about whether the
    // target day group exists.
    if (
      notesQuery.isLoading ||
      notesQuery.isFetching ||
      notesQuery.isPlaceholderData ||
      older.isFetching
    ) {
      return; // keep waiting — do not touch the ref or the URL
    }

    // Range covers the date and data has settled. Try the scroll; only mark
    // the deep link handled (ref + clear the param) once it actually lands,
    // OR once we can be sure — settled, non-placeholder data, range covers
    // the date — that the group will never exist (e.g. no notes that day),
    // in which case give up silently rather than retrying forever.
    scrolledForDateRef.current = true;
    const dayFound = scrollToDayGroup(pendingDate);
    if (!dayFound && fromEmail && !emailLinkResolvedRef.current) setRemovedDate(pendingDate);
    emailLinkResolvedRef.current = true;
    reportLanding(dayFound);
    // Clear the param (replace) so a later re-render / back-nav never re-fires
    // this scroll for the same date.
    if (searchParams.has('date')) {
      const next = new URLSearchParams(searchParams);
      next.delete('date');
      setSearchParams(next, { replace: true });
    }
  }, [
    pendingDate,
    today,
    fromDate,
    olderPages,
    older.isFetching,
    notesQuery.isLoading,
    notesQuery.isFetching,
    notesQuery.isPlaceholderData,
    searchParams,
    setSearchParams,
    fromEmail,
    reportLanding,
  ]);

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
    const input = draftToInput(submitted, today);
    const sentDate = input.note_date ?? null;
    if (input.body === undefined && input.mood === undefined) return;
    // Offline: explain, never queue — and the draft stays in the composer
    // (returns before the optimistic clear below). lib/offlineWrite.ts.
    if (blockOfflineWrite('save')) return;
    // THE SYNCHRONOUS DOUBLE-SUBMIT GUARD. `createMutation.isPending` — the
    // same value NoteComposer receives as `submitting` — is React Query state,
    // committed a render AFTER the submit that started the request. Two submits
    // in the SAME tick therefore both get through it AND both read the same
    // pre-clear `draft` (the optimistic `setDraft(EMPTY_NOTE_DRAFT)` below has
    // not committed either), so the same care note is posted twice.
    // `isPending` first, then the ref (`useSubmitGuard`); released in
    // `onSettled`, since `mutate` returns immediately.
    if (createMutation.isPending || !postGuard.claim()) return;

    // A retry replaces the previous failure: the alert unmounts now and a new
    // one mounts (and is announced again) if this attempt fails too.
    setPostError(null);
    inFlightDraftRef.current = submitted;
    // Optimistic: the hook prepends the note; clear the composer now.
    setDraft(EMPTY_NOTE_DRAFT);
    setComposerOpen(false);
    createMutation.mutate(
      { circleId, input },
      {
        onSuccess: () => {
          inFlightDraftRef.current = null;
          // WB8: mood dropped from the payload — "ids only, never content" for
          // this event family (careNotesViewed docstring), and mood is
          // user-authored health content, not an id/count/enum-of-fixed-shape.
          Analytics.careNoteAdded(circleId, {
            categoryCount: submitted.categories.length,
            backdated: sentDate !== null,
            daysBack: sentDate && today ? daysBetween(sentDate, today) : 0,
          });
          // Filed under another day: widen to it and bring it into view.
          if (sentDate) {
            scrolledForDateRef.current = false;
            setPendingDate(sentDate);
          }
        },
        onError: () => {
          inFlightDraftRef.current = null;
          // INLINE in the composer, not a toast — see NoteComposer's `error`.
          setPostError(t('notes:composer.errorPosting'));
          // Preserve the input: restore the submitted draft unless the user
          // has already started composing a new note.
          setDraft((current) =>
            current.body === '' && current.mood === null && current.categories.length === 0
              ? submitted
              : current
          );
        },
        onSettled: postGuard.release,
      }
    );
  }

  // ── Inline edit (own notes) ────────────────────────────────────────────────
  function handleSaveEdit(noteId: string, edited: NoteDraft): void {
    // Offline: explain, never queue; the edit stays open as typed.
    if (blockOfflineWrite('save')) return;
    const body = edited.body.trim();
    // The edit composer's gate mirrors the server refine (body-or-mood).
    if (!body && !edited.mood) return;
    const originalDate = notes.find((n) => n.id === noteId)?.note_date;
    const newDate = edited.noteDate && edited.noteDate !== originalDate ? edited.noteDate : null;
    // Same guard, same reason as `handlePost` — checked AFTER the validity
    // gate so a claim is never taken on a call that was going to bail out.
    if (updateMutation.isPending || !editGuard.claim()) return;
    updateMutation.mutate(
      {
        circleId,
        noteId,
        // PATCH sends explicit values (null clears) — the result must still
        // satisfy body-or-mood, enforced above and by the server refine.
        input: {
          body: body || null,
          mood: edited.mood,
          categories: edited.categories,
          // Only when the date actually changed.
          ...(newDate ? { note_date: newDate } : {}),
        },
      },
      {
        onSuccess: () => {
          // Mirrors careNoteAdded: category COUNT only, never mood/body/names.
          const finalDate = newDate ?? originalDate;
          Analytics.careNoteUpdated(circleId, {
            categoryCount: edited.categories.length,
            backdated: !!today && !!finalDate && finalDate < today,
            daysBack: today && finalDate && finalDate < today ? daysBetween(finalDate, today) : 0,
          });
          if (newDate) {
            scrolledForDateRef.current = false;
            setPendingDate(newDate);
          }
          setEditingNoteId(null);
        },
        onError: () => showToast(t('notes:composer.errorSaving'), 'error'),
        onSettled: editGuard.release,
      }
    );
  }

  // ── Delete (own note, or any note for the circle owner) ───────────────────
  function handleConfirmDelete(): void {
    if (!deletingNoteId || deleteMutation.isPending || !deleteGuard.claim()) return;
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
        onSettled: deleteGuard.release,
      }
    );
  }

  // ── Older pages ────────────────────────────────────────────────────────────
  const currentFrom =
    fromDate ?? (today ? shiftDateString(today, -(DEFAULT_WINDOW_DAYS - 1)) : undefined);
  const baseFloor = today ? shiftDateString(today, -(MAX_WINDOW_DAYS - 1)) : undefined;
  const baseWindowFull = !!currentFrom && !!baseFloor && currentFrom <= baseFloor;

  function loadNextOlderPage(): void {
    const nextPage = olderPages + 1;
    setOlderPages(nextPage);
    Analytics.careNotesOlderLoaded({ page: nextPage });
  }

  // ONE PRESS ALWAYS SHOWS A RESULT (owner, TestFlight 1.4.1 (5); mobile parity): a press used to
  // widen the base window by one 14-day step, so a circle whose only note was 5 days old pressed
  // ~6 times with no visible change before "No older notes". Now a press below the full page
  // widens STRAIGHT to the full 92 days; if that brings no note older than what was loaded, the
  // next 92-day page is fetched automatically, which either shows notes or ends in "No older
  // notes" (an empty page = reachedEnd). `olderPendingFrom` is the floor loaded BEFORE the press,
  // held while the widened window is still answering (the control shows busy meanwhile).
  function handleLoadOlder(): void {
    if (!currentFrom || !baseFloor || olderPendingFrom !== null) return;
    if (!baseWindowFull) {
      setOlderPendingFrom(currentFrom);
      setFromDate(baseFloor);
      return;
    }
    if (older.isFetching) return;
    loadNextOlderPage();
  }

  const baseNotes = notesQuery.data?.notes;
  useEffect(() => {
    if (olderPendingFrom === null) return;
    // Wait for settled data of the WIDENED window (a placeholder is the previous window's).
    if (!baseWindowFull || notesQuery.isLoading || notesQuery.isPlaceholderData) return;
    setOlderPendingFrom(null);
    const widenedShowedMore = (baseNotes ?? []).some((n) => n.note_date < olderPendingFrom);
    if (!widenedShowedMore) loadNextOlderPage();
    // loadNextOlderPage reads the current olderPages; re-running on it is harmless (pending is cleared).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [olderPendingFrom, baseWindowFull, notesQuery.isLoading, notesQuery.isPlaceholderData, baseNotes]);

  // WITH oldest_note_date the control hides once nothing older exists, and a press keeps stepping
  // (the base window to its full 92 days, then batches of older pages) until the NEXT older note is
  // on the page, so a gap longer than one page never strands a note. Field ABSENT (a backend that
  // predates it) = the paging above, exactly (mobile parity: NotesTab).
  const oldestNoteDate = notesQuery.data?.oldest_note_date;
  const loadedFloor = today && currentFrom ? loadedNotesFloor(today, currentFrom, olderPages) : undefined;
  const hasOlderNotes = loadedFloor ? olderNotesExist(oldestNoteDate, loadedFloor) : undefined;
  function seekOlderStep(): void {
    if (!today || !baseFloor || typeof oldestNoteDate !== 'string') return;
    if (!baseWindowFull) {
      setFromDate(baseFloor);
      return;
    }
    const nextPage = olderPages + olderSeekPages(today, olderPages, oldestNoteDate);
    setOlderPages(nextPage);
    Analytics.careNotesOlderLoaded({ page: nextPage });
  }
  const olderSettled = !notesQuery.isLoading && !notesQuery.isPlaceholderData && !older.isFetching;
  useEffect(() => {
    if (olderSeekFloor === null || !olderSettled) return;
    const reached = notes.some((n) => n.note_date < olderSeekFloor);
    if (reached || hasOlderNotes !== true) {
      setOlderSeekFloor(null);
      return;
    }
    seekOlderStep();
    // seekOlderStep reads the current window; re-running on its inputs is what steps again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [olderSeekFloor, olderSettled, notes, hasOlderNotes, olderPages, baseWindowFull]);
  function handleShowOlder(): void {
    if (hasOlderNotes === undefined) {
      handleLoadOlder();
      return;
    }
    if (!loadedFloor || olderSeekFloor !== null || olderPendingFrom !== null || !hasOlderNotes) return;
    setOlderAsked(true);
    setOlderSeekFloor(loadedFloor);
    seekOlderStep();
  }

  const olderBusy = olderPendingFrom !== null || olderSeekFloor !== null || older.isFetching;
  // Field known: offered only while older notes exist (or a press is still stepping); "No older
  // notes" only once the person asked, otherwise nothing. Field absent: as before.
  const olderFooter: 'button' | 'end' | 'none' =
    hasOlderNotes === undefined
      ? older.reachedEnd
        ? 'end'
        : 'button'
      : hasOlderNotes || olderSeekFloor !== null
        ? 'button'
        : olderAsked
          ? 'end'
          : 'none';

  const olderControl: ReactElement | null = !today || olderFooter === 'none' ? null : olderFooter === 'end' ? (
    <p className="m-0 text-center text-sm text-ink-3" data-testid="notes-no-older">
      {t('notes:noOlder')}
    </p>
  ) : (
    <div className="flex justify-center">
      <Button
        variant="ghost"
        onClick={handleShowOlder}
        loading={olderBusy}
        disabled={notesQuery.isFetching || olderBusy}
        data-testid="notes-show-older"
      >
        {t('notes:showOlder')}
      </Button>
    </div>
  );

  // ── "Add a note" + the composer it opens ──────────────────────────────────
  // AFTER the loaded notes, just above "Show older notes" / "No older notes" (owner 2026-11-08,
  // mobile parity: the top of the page is the user's notes). OUTLINE with notes on the page, the
  // FILLED primary only as the empty page's one action. One editing surface at a time: hidden
  // while an inline edit is active (mirrors mobile), and for anyone who may not write.
  const composerBlock: ReactElement | null =
    canEdit && editingNoteId === null && today ? (
      <div ref={composerWrapRef} className="scroll-mt-4" data-testid="notes-composer-slot">
        {composerShown ? (
          <Sheet padding="sm">
            <NoteComposer
              idPrefix="care-note"
              draft={draft}
              onChange={setDraft}
              onSubmit={handlePost}
              submitLabel={t('notes:composer.post')}
              submitting={createMutation.isPending}
              error={postError}
              today={today}
              autoFocus={composerOpen}
              onCancel={() => {
                setDraft(EMPTY_NOTE_DRAFT);
                setPostError(null);
                setComposerOpen(false);
              }}
            />
          </Sheet>
        ) : (
          <Button
            ref={addNoteRef}
            variant={notes.length > 0 ? 'outline' : 'primary'}
            fullWidth
            leftIcon={<Icon name="add-outline" size="row" />}
            aria-expanded={false}
            data-testid="note-composer-expand"
            onClick={openComposer}
          >
            {t('notes:composer.label')}
          </Button>
        )}
      </div>
    ) : null;

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
      <div className="flex flex-col gap-6 px-5">
        <EmptyState
          tone="dusk"
          icon="document-text-outline"
          title={t('notes:empty.title')}
          description={t('notes:empty.hint')}
          actions={<HowDoesThisWork slug="daily-care-notes" />}
        />
        {composerBlock}
        {olderControl}
      </div>
    );
  } else {
    body = (
      <div className="flex flex-col gap-6 px-5">
        {groups.map((group) => (
          <section
            key={group.date}
            id={dayGroupElementId(group.date)}
            aria-label={dayLabel(group.date)}
          >
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
                    today={today}
                  />
                );
              })}
            </ul>
          </section>
        ))}
        {composerBlock}
        {olderControl}
      </div>
    );
  }

  const deletingNote = notes.find((n) => n.id === deletingNoteId) ?? null;

  return (
    <section className="mx-auto w-full max-w-5xl pb-8">
      <PageMasthead
        section={t('common:nav.notes')}
        tone="dusk"
        title={t('notes:title')}
        // "Add a note" (owner 2026-11-08: every Care page's header adds its item): opens the
        // composer at the end of the notes and scrolls it into view.
        rightAction={
          canEdit && editingNoteId === null && today
            ? { name: 'add-outline', label: t('notes:composer.label'), onClick: openComposer }
            : undefined
        }
        subtitle={
          notesQuery.isLoading || notesQuery.isError
            ? HOLD
            : notesSummary(t, notes, {
                today,
                formatTime: (iso) => formatNoteTime(iso, timezone, hourCycle),
                formatDate: (d) => formatDateForDisplay(d, { month: 'short', day: 'numeric' }),
              })
        }
      >
        <CareTabs />
      </PageMasthead>

      {removedDate ? (
        <RemovedState
          reason="removed"
          date={removedDate}
          fromEmail={fromEmail}
          onDismiss={() => setRemovedDate(null)}
        />
      ) : null}

      {!!circle && !canEdit && <ViewOnlyBanner className="mx-5 mt-4" />}

      {/* Reuses the already-loaded `notes`/`today` — no second request (UI
          States: "renders once the list data is there — same query"). Shown
          even on an empty week (never hidden — it teaches the feature). */}
      {today && <MoodWeekStrip notes={notes} today={today} onSelectDay={scrollToDayGroup} />}

      <div className="mt-2">{body}</div>

      {deletingNote && (
        <ConfirmDialog
          offlineKind="change"
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

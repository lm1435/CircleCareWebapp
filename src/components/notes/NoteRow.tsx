import { useEffect, useRef, useState, type ReactElement, type Ref } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Badge,
  Card,
  Icon,
  MoreMenu,
  type MoreMenuItem,
  type MoreMenuTriggerProps,
} from '@/components/ui';
import { NoteComposer, type NoteDraft } from './NoteComposer';
import type { CareNote } from '@/api/careNotes';
import { useHourCycle } from '@/hooks/useHourCycle';
import { formatTimeOfDay } from '@/utils/timezone';
import type { HourCycle } from '@/utils/hourCycle';

/** Assigns `node` to every ref in `refs` — object refs and callback refs alike. */
function setRefs<T>(...refs: Array<Ref<T> | undefined>): (node: T | null) => void {
  return (node) => {
    for (const ref of refs) {
      if (!ref) continue;
      if (typeof ref === 'function') ref(node);
      else (ref as { current: T | null }).current = node;
    }
  };
}

// Daily Care Notes entry row (Wave 3, Task 16 — web twin of mobile's
// CareNoteRow). Author avatar initial + name, time in the CARE RECIPIENT's
// timezone, body, and mood/category display pills (`Badge variant="dusk"` —
// the shared semantic tint; the old inline dusk-tinted `style` prop this
// replaced is gone, deleted with globals.css's DEPRECATED block in Task 24).
// Own-note edit + delete live behind a `MoreMenu` (author-only), matching the
// actions convention every other care row on web now uses. Inline edit reuses
// NoteComposer with a local draft.
//
// FOCUS ORDER (WCAG 2.4.3), both directions of the editing<->static swap:
//   EDIT   → NoteComposer's `autoFocus` moves focus into the body textarea.
//   SAVE / CANCEL → this row refocuses its OWN MoreMenu trigger (`triggerRef`
//     below), via `renderTrigger` rather than the generic `label` trigger.
// Neither relies on MoreMenu's own `close(true)` refocus: `item.onSelect()`
// (→ `onStartEdit`) and `menu.close(true)` both fire in the same tick, before
// React commits the re-render that swaps this row into its editing branch —
// so the OLD trigger button is still mounted when `close(true)` focuses it,
// and is then unmounted a moment later when editing flips true, dropping
// focus to `<body>`. Handling both transitions explicitly here sidesteps
// that timing entirely instead of fighting it.

interface NoteRowProps {
  note: CareNote;
  /** Care recipient IANA timezone — entry times render in it, never device-local. */
  timezone: string;
  canEditOwn: boolean;
  canDelete: boolean;
  editing: boolean;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSaveEdit: (draft: NoteDraft) => void;
  onDelete: () => void;
  savePending: boolean;
}

/**
 * Time-of-day of a UTC instant AS SEEN IN the recipient timezone, in the
 * VIEWER's resolved 12h/24h clock (WA2).
 *
 * Was previously `Intl.DateTimeFormat(undefined, { hour: 'numeric', ... })` —
 * `undefined` locale defers to the RUNTIME's default locale/hour-cycle, not
 * our device-aware `resolveHourCycle()` preference (project_hour_cycle_architecture
 * memory), so a 24h-clock user with an en-US browser locale silently got
 * AM/PM here while every other surface on the page followed their cycle.
 *
 * Extracts numeric hour/minute via `hour12: false` + `formatToParts` (machine
 * extraction, mirrors `vitalDateTime.ts` `utcISOToRecipientWallTime`), then
 * renders through the shared `formatTimeOfDay` — the same two-step every other
 * display site uses.
 */
function formatNoteTime(isoString: string, timezone: string, cycle: HourCycle): string {
  try {
    const date = new Date(isoString);
    const parts = new Intl.DateTimeFormat('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: timezone,
    }).formatToParts(date);
    let hourStr = parts.find((p) => p.type === 'hour')?.value ?? '00';
    const minuteStr = parts.find((p) => p.type === 'minute')?.value ?? '00';
    // Midnight can format as "24" under hour12: false in some engines.
    if (hourStr === '24') hourStr = '00';
    const hours = parseInt(hourStr, 10);
    const minutes = parseInt(minuteStr, 10);
    if (isNaN(hours) || isNaN(minutes)) return '';
    return formatTimeOfDay(hours, minutes, cycle);
  } catch {
    return '';
  }
}

export function NoteRow({
  note,
  timezone,
  canEditOwn,
  canDelete,
  editing,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onDelete,
  savePending,
}: NoteRowProps): ReactElement {
  const { t } = useTranslation('notes');
  const hourCycle = useHourCycle();
  const [draft, setDraft] = useState<NoteDraft>(() => ({
    body: note.body ?? '',
    mood: note.mood,
    categories: note.categories,
  }));

  // The row's own MoreMenu trigger — kept across the editing<->static
  // branch swap so it can be refocused when editing ENDS (see below). Note
  // that during `editing`, the branch that renders this button doesn't
  // mount at all, so the ref is momentarily null; it's set again the instant
  // the static branch remounts, before effects run.
  const triggerRef = useRef<HTMLButtonElement>(null);
  // Tracks the PREVIOUS `editing` value so the refocus effect below fires
  // only on the true→false transition (Save/Cancel), never on first mount.
  const wasEditingRef = useRef(editing);

  // Re-seed the draft each time edit mode OPENS — the row stays mounted across
  // a save + refetch, so the mount-time draft would otherwise go stale on a
  // second edit of the same note.
  useEffect(() => {
    if (editing) {
      setDraft({ body: note.body ?? '', mood: note.mood, categories: note.categories });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  // WCAG 2.4.3 (focus order) fix: choosing "Edit" unmounts the MoreMenu
  // trigger that had focus, and the trigger's OWN "did you focus the field
  // you're about to type in" is handled by NoteComposer's `autoFocus` (see
  // there) — this effect handles the OTHER direction. When editing ends
  // (Save succeeds, or Cancel), the static branch remounts a BRAND NEW
  // trigger button (a fresh DOM node), and nothing else would ever move
  // focus back to it, leaving `<body>` focused. `wasEditingRef` gates this to
  // fire only on that true→false transition — the trigger doesn't exist yet
  // on first mount when `editing` starts false, so an unconditional effect
  // would try to focus a still-null ref every time.
  useEffect(() => {
    if (wasEditingRef.current && !editing) {
      triggerRef.current?.focus();
    }
    wasEditingRef.current = editing;
  }, [editing]);

  const authorName = note.author
    ? `${note.author.first_name ?? ''} ${note.author.last_name ?? ''}`.trim() ||
      t('row.formerMember')
    : t('row.formerMember');
  // Single initial (mobile parity — CareNoteRow's avatarInitial).
  const authorInitial = (note.author?.first_name ?? '?').charAt(0).toUpperCase();
  const timeLabel = formatNoteTime(note.created_at, timezone, hourCycle);
  const wasEdited = note.updated_at !== note.created_at;
  const hasPills = note.mood !== null || note.categories.length > 0;

  if (editing) {
    return (
      <Card as="li" padding="sm" className="border-[1.5px] border-line-2">
        <NoteComposer
          idPrefix={`note-edit-${note.id}`}
          draft={draft}
          onChange={setDraft}
          onSubmit={() => onSaveEdit(draft)}
          submitLabel={t('composer.save')}
          submitting={savePending}
          onCancel={onCancelEdit}
          cancelLabel={t('composer.cancel')}
          // See the module's focus-order comment above: the trigger that
          // opened this (the row's MoreMenu "Edit" item) is gone the instant
          // this mounts, so this is what carries focus forward instead of
          // letting it fall to <body>.
          autoFocus
        />
      </Card>
    );
  }

  const menuItems: MoreMenuItem[] = [
    ...(canEditOwn
      ? [{ id: 'edit', label: t('row.edit'), icon: 'create-outline' as const, onSelect: onStartEdit }]
      : []),
    ...(canDelete
      ? [
          {
            id: 'delete',
            label: t('row.delete'),
            icon: 'trash-outline' as const,
            onSelect: onDelete,
            danger: true,
          },
        ]
      : []),
  ];

  return (
    <Card as="li" padding="sm" className="border-[1.5px] border-line-2 flex items-start gap-3">
      <span
        aria-hidden="true"
        className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-dusk-soft text-sm font-semibold text-dusk"
      >
        {authorInitial}
      </span>

      <div className="min-w-0 flex-1">
        <div className="mb-2 flex flex-wrap items-center gap-1">
          <span className="text-sm text-ink">{authorName}</span>
          <span aria-hidden="true" className="h-[3px] w-[3px] rounded-full bg-ink-3" />
          <span className="text-xs text-ink-3">{timeLabel}</span>
          {wasEdited && <span className="text-xs italic text-ink-3">{t('row.edited')}</span>}
        </div>

        {note.body && (
          <p className="m-0 whitespace-pre-wrap break-words text-md leading-[22px] text-ink-2">
            {note.body}
          </p>
        )}

        {hasPills && (
          <div className="mt-2 flex flex-wrap gap-2">
            {note.mood !== null && (
              <Badge variant="dusk" size="sm">
                {t(`moods.${note.mood}`)}
              </Badge>
            )}
            {note.categories.map((category) => (
              <Badge key={category} variant="dusk" size="sm">
                {t(`categories.${category}`)}
              </Badge>
            ))}
          </div>
        )}
      </div>

      {menuItems.length > 0 && (
        <MoreMenu
          items={menuItems}
          // A custom trigger — visually IDENTICAL to MoreMenu's own default
          // (same classes, same glyph) — so `triggerRef` can hold onto the
          // physical button node across the editing<->static remounts (see
          // the module comment above). `label` is ignored once a custom
          // trigger is supplied (MoreMenu's own contract), so the accessible
          // name goes on the button directly instead.
          renderTrigger={(triggerProps: MoreMenuTriggerProps) => (
            <button
              {...triggerProps}
              ref={setRefs(triggerProps.ref, triggerRef)}
              type="button"
              aria-label={t('row.actionsFor', { author: authorName })}
              className="inline-flex h-11 w-11 items-center justify-center rounded-full text-ink transition-colors hover:bg-bg-2"
            >
              <Icon name="ellipsis-horizontal" size="row" />
            </button>
          )}
        />
      )}
    </Card>
  );
}

export default NoteRow;

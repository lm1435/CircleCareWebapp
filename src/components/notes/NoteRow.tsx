import { useEffect, useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Avatar, Badge, Button } from '@/components/ui';
import { NoteComposer, type NoteDraft } from './NoteComposer';
import type { CareNote } from '@/api/careNotes';
import { useHourCycle } from '@/hooks/useHourCycle';
import { formatTimeOfDay } from '@/utils/timezone';
import type { HourCycle } from '@/utils/hourCycle';

// Daily Care Notes entry row (docs/plans/daily-care-notes.md, Web Task 16).
// Author avatar initial + name, time in the CARE RECIPIENT's timezone, body,
// and mood/category display pills (dusk-soft/ink Badge treatment (section-tinted) — the
// GlancePills idiom from the condition-tags spec; display pills are
// non-interactive). Own-note edit + delete are VISIBLE affordances (standing
// no-long-press rule); the circle owner can delete any entry. Inline edit
// reuses NoteComposer with a local draft.

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

  // Re-seed the draft each time edit mode OPENS — the row stays mounted across
  // a save + refetch, so the mount-time draft would otherwise go stale on a
  // second edit of the same note.
  useEffect(() => {
    if (editing) {
      setDraft({ body: note.body ?? '', mood: note.mood, categories: note.categories });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  const authorName = note.author
    ? `${note.author.first_name ?? ''} ${note.author.last_name ?? ''}`.trim() ||
      t('row.formerMember')
    : t('row.formerMember');
  const timeLabel = formatNoteTime(note.created_at, timezone, hourCycle);
  const wasEdited = note.updated_at !== note.created_at;

  if (editing) {
    return (
      <li className="rounded-xl border border-line bg-cream p-4">
        <NoteComposer
          idPrefix={`note-edit-${note.id}`}
          draft={draft}
          onChange={setDraft}
          onSubmit={() => onSaveEdit(draft)}
          submitLabel={t('composer.save')}
          submitting={savePending}
          onCancel={onCancelEdit}
          cancelLabel={t('composer.cancel')}
        />
      </li>
    );
  }

  return (
    <li className="rounded-xl border border-line bg-cream p-4">
      <div className="flex items-center gap-2.5">
        <Avatar size="xs" name={authorName} />
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">{authorName}</span>
        <span className="mono shrink-0 text-xs text-ink-3">
          {timeLabel}
          {wasEdited ? ` · ${t('row.edited')}` : ''}
        </span>
      </div>

      {note.body && (
        <p className="m-0 mt-2 whitespace-pre-wrap break-words text-base text-ink-2">
          {note.body}
        </p>
      )}

      {(note.mood !== null || note.categories.length > 0) && (
        <p className="m-0 mt-2.5 flex flex-wrap gap-1.5">
          {note.mood !== null && (
            <Badge style={{ background: 'var(--dusk-soft)', color: 'var(--ink)' }}>
              {t(`moods.${note.mood}`)}
            </Badge>
          )}
          {note.categories.map((category) => (
            <Badge
              key={category}
              style={{ background: 'var(--dusk-soft)', color: 'var(--ink)' }}
            >
              {t(`categories.${category}`)}
            </Badge>
          ))}
        </p>
      )}

      {(canEditOwn || canDelete) && (
        <div className="mt-2 flex justify-end gap-2">
          {canEditOwn && (
            <Button variant="ghost" size="sm" onClick={onStartEdit}>
              {t('row.edit')}
            </Button>
          )}
          {canDelete && (
            <Button variant="ghost" size="sm" onClick={onDelete}>
              {t('row.delete')}
            </Button>
          )}
        </div>
      )}
    </li>
  );
}

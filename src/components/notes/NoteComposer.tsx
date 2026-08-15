import type { FormEvent, ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, ChipSelect, TextArea } from '@/components/ui';
import {
  CARE_NOTE_CATEGORIES,
  CARE_NOTE_MOODS,
  MAX_CARE_NOTE_LENGTH,
  type CareNoteCategory,
  type CareNoteMood,
} from '@/api/careNotes';

// Daily Care Notes composer (docs/plans/daily-care-notes.md, Web Task 16).
// Controlled — the caller owns the draft (the page keeps it to preserve input
// on a failed post; NoteRow keeps a local one for inline edits). Field order
// follows the established chips-adjacent-to-their-field rule: textarea, mood
// chips (single-select toggle via ChipSelect), category chips (multi-toggle
// aria-pressed buttons in a labeled group — chip classes mirror ChipSelect),
// then the submit row. Submit is enabled iff body-or-mood (plan rule); the
// server's Zod refine is the authoritative gate.

export interface NoteDraft {
  body: string;
  mood: CareNoteMood | null;
  categories: CareNoteCategory[];
}

export const EMPTY_NOTE_DRAFT: NoteDraft = { body: '', mood: null, categories: [] };

export interface NoteComposerProps {
  /** Unique id prefix so multiple composers (create + inline edit) coexist. */
  idPrefix: string;
  draft: NoteDraft;
  onChange: (next: NoteDraft) => void;
  onSubmit: () => void;
  submitLabel: string;
  /** Disables submit while the mutation is in flight. */
  submitting?: boolean;
  /** When present, renders a ghost Cancel button (inline edit mode). */
  onCancel?: () => void;
  cancelLabel?: string;
}

// Chip classes — identical recipe to ChipSelect (Round 7 slimmed 36px chips;
// the global *:focus-visible ring provides focus styling, never suppressed).
const CHIP_SELECTED = 'min-h-9 rounded-full bg-ink px-4 py-1.5 text-sm font-medium text-cream';
const CHIP_UNSELECTED =
  'min-h-9 rounded-full border border-line bg-transparent px-4 py-1.5 text-sm text-ink hover:bg-bg-2';

export function NoteComposer({
  idPrefix,
  draft,
  onChange,
  onSubmit,
  submitLabel,
  submitting = false,
  onCancel,
  cancelLabel,
}: NoteComposerProps): ReactElement {
  const { t } = useTranslation('notes');

  const canSubmit = draft.body.trim().length > 0 || draft.mood !== null;

  function handleSubmit(e: FormEvent): void {
    e.preventDefault();
    if (!canSubmit || submitting) return;
    onSubmit();
  }

  function toggleCategory(category: CareNoteCategory): void {
    const selected = draft.categories.includes(category);
    onChange({
      ...draft,
      categories: selected
        ? draft.categories.filter((c) => c !== category)
        : [...draft.categories, category],
    });
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <TextArea
        id={`${idPrefix}-body`}
        label={t('composer.label')}
        placeholder={t('composer.placeholder')}
        value={draft.body}
        onChange={(e) => onChange({ ...draft, body: e.target.value })}
        maxLength={MAX_CARE_NOTE_LENGTH}
        rows={3}
      />

      {/* Visible field labels are aria-hidden: each chip row is a role="group"
          whose aria-label carries the same (matching) accessible name, so
          announcing the span too would double it up for screen readers. */}
      <div className="flex flex-col gap-1.5">
        <span aria-hidden="true" className="text-sm font-medium text-ink-2">
          {t('composer.moodLabel')}
        </span>
        <ChipSelect
          id={`${idPrefix}-mood`}
          label={t('composer.moodLabel')}
          options={CARE_NOTE_MOODS.map((mood) => ({ value: mood, label: t(`moods.${mood}`) }))}
          value={draft.mood}
          onChange={(next) => onChange({ ...draft, mood: (next as CareNoteMood | null) ?? null })}
        />
      </div>

      {/* Category multi-toggle — per-chip aria-pressed buttons in a labeled
          group (condition-tags a11y spec); ChipSelect is single-select, so the
          smallest multi capable row is inlined here with the same classes. */}
      <div className="flex flex-col gap-1.5">
        <span aria-hidden="true" className="text-sm font-medium text-ink-2">
          {t('composer.categoriesLabel')}
        </span>
        <div
          id={`${idPrefix}-categories`}
          role="group"
          aria-label={t('composer.categoriesLabel')}
          className="flex flex-wrap gap-2"
        >
          {CARE_NOTE_CATEGORIES.map((category) => {
            const selected = draft.categories.includes(category);
            return (
              <button
                key={category}
                type="button"
                aria-pressed={selected}
                onClick={() => toggleCategory(category)}
                className={selected ? CHIP_SELECTED : CHIP_UNSELECTED}
              >
                {t(`categories.${category}`)}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex justify-end gap-2">
        {onCancel && (
          <Button variant="ghost" onClick={onCancel}>
            {cancelLabel ?? t('composer.cancel')}
          </Button>
        )}
      {!canSubmit ? (
        <p className="m-0 text-xs text-ink-3" role="status">
          {t('notes:postRequirementHint')}
        </p>
      ) : null}
        <Button type="submit" disabled={!canSubmit || submitting}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}

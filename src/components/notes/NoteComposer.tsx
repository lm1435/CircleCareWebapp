import { useEffect, useRef, type FormEvent, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, ChipSelect, TextArea, chipClass } from '@/components/ui';
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
  /**
   * A failed submit, shown INLINE inside the sticky submit row, directly above
   * Post, with `role="alert"` so it is announced without moving focus, and
   * linked to Post via `aria-describedby`. It lives IN the sticky row, not in
   * the form's normal flow above it: at phone widths the form is taller than
   * the viewport, so an in-flow error landed under the sticky row and nav pill
   * (390x844) or below the fold (360x640) and was never seen. Inline rather
   * than a toast: the
   * create composer is 423px tall at 360x640 and only 371px fit between the
   * page toast band and the nav pill, so a toast for its own submit always
   * covered the textarea the user is asked to retry from
   * (e2e/unhappy/writes/toast-page-overlap.spec.ts).
   */
  error?: string | null;
  /**
   * Focus the body textarea on mount — WCAG 2.4.3 (focus order). `NoteRow`
   * passes this for its inline EDIT instance: choosing "Edit" from the row's
   * MoreMenu unmounts the trigger that had focus, and the generic
   * `MoreMenu.close()` refocus (which runs synchronously, before the
   * editing-mode re-render commits) ends up focusing a node that is removed a
   * moment later — focus then falls back to `<body>`. Moving focus into the
   * field the user is about to type in is the correct destination anyway, and
   * doing it here (mount-only effect on the freshly-mounted instance) means
   * it never depends on the generic menu-refocus timing. The CREATE composer
   * at the top of the page does not pass this — nothing removed its focus.
   */
  autoFocus?: boolean;
}

export function NoteComposer({
  idPrefix,
  draft,
  onChange,
  onSubmit,
  submitLabel,
  submitting = false,
  onCancel,
  cancelLabel,
  error = null,
  autoFocus = false,
}: NoteComposerProps): ReactElement {
  const { t } = useTranslation('notes');
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  // Mount-only: this component instance is created fresh each time NoteRow
  // enters edit mode (its editing branch renders a new NoteComposer), so a
  // plain empty-deps effect fires exactly once, right when that happens.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (autoFocus) bodyRef.current?.focus();
  }, []);

  const canSubmit = draft.body.trim().length > 0 || draft.mood !== null;
  const errorId = `${idPrefix}-error`;
  const errorRef = useRef<HTMLParagraphElement>(null);

  // The alert lives in the sticky submit row, so it is normally on screen with
  // Post. But a sticky box cannot rise above its form's top edge: when the form
  // has only just scrolled into view and the alert makes the row tall (narrow
  // phone, 200% text: a 4-line alert at 320px), the row is pinned to the form
  // top and its lower part — the alert — hangs under the nav pill / below the
  // fold. Bring it into view when it appears; `nearest` is a no-op whenever it
  // is already visible, which is the common case.
  useEffect(() => {
    if (error) errorRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, [error]);

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
        ref={bodyRef}
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
                className={chipClass(selected)}
              >
                {t(`categories.${category}`)}
              </button>
            );
          })}
        </div>
      </div>

      {/* STICKY: the submit row stays in view while the form is taller than
          what is left of the viewport (phone widths, or the keyboard up), so
          Post/Save never has to be scrolled to. Below xl it clears the
          floating nav pill; from xl the sidebar replaces the pill. The cream
          ground and top rule are what the fields scroll under.
          OFFSET: the row rests 12px above the pill (xl: above the viewport
          floor) and has 4px bottom padding, so Post's bottom edge sits exactly
          16px clear — the root `scroll-padding-bottom` band (globals.css). Any
          less and focusing Post makes the browser scroll the page to clear the
          band (a 4px nudge per focus that a sticky row can never satisfy).
          A failed submit's alert sits HERE, above the buttons, so it is on
          screen whenever Post is. */}
      <div
        data-testid="note-composer-footer"
        className="sticky bottom-[calc(var(--nav-h,64px)+var(--nav-inset,0px)+12px)] z-10 -mx-1 flex flex-col gap-2 border-t border-line-2 bg-cream px-1 pt-3 pb-1 xl:bottom-3"
      >
        {error ? (
          <p
            ref={errorRef}
            id={errorId}
            data-testid="note-composer-error"
            role="alert"
            className="m-0 min-w-0 text-sm text-terracotta-deep text-balance break-words"
          >
            {error}
          </p>
        ) : null}
        <div className="flex flex-wrap items-center justify-end gap-2">
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
          <Button
            type="submit"
            size="sm"
            disabled={!canSubmit || submitting}
            aria-describedby={error ? errorId : undefined}
          >
            {submitLabel}
          </Button>
        </div>
      </div>
    </form>
  );
}

import { useMemo, useState, type KeyboardEvent, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

export interface TagInputProps {
  /** Base id for the input element (label is wired via htmlFor). */
  id: string;
  /** Visible field label — also names the suggestion group (i18n string). */
  label: string;
  /** Selected tags (controlled). */
  values: string[];
  onChange: (next: string[]) => void;
  /** Curated suggestion labels (already localized). */
  suggestions: string[];
  placeholder?: string;
  /** Server cap: max tags per field. */
  maxTags?: number;
  /** Server cap: max characters per tag. */
  maxTagLength?: number;
}

const COLLAPSED_COUNT = 8;

/** Case/diacritic-insensitive comparison key. */
function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

/**
 * Tag entry field: selected values as removable pills + search/add input +
 * curated suggestion chips (Condition Tags — docs/plans/condition-tags.md).
 *
 * Controlled, no I/O. Plain buttons at the right altitude (no ARIA combobox):
 * suggestions are aria-pressed toggle chips inside a labeled group (the
 * CategoryFilter idiom); selected pills are buttons named "Remove «tag»".
 * Adds/removals are announced through a polite live region. Custom tags are
 * comma-stripped (older shipped clients comma-split on load), deduped
 * case-insensitively, and capped at maxTags/maxTagLength.
 */
export function TagInput({
  id,
  label,
  values,
  onChange,
  suggestions,
  placeholder,
  maxTags = 100,
  maxTagLength = 200,
}: TagInputProps): ReactElement {
  const { t } = useTranslation('emergency');
  const [input, setInput] = useState('');
  const [showAll, setShowAll] = useState(false);
  const [announcement, setAnnouncement] = useState('');

  const inputId = `${id}-input`;
  const atCap = values.length >= maxTags;

  const selectedKeys = useMemo(() => new Set(values.map(normalize)), [values]);
  const query = normalize(input);

  // Suggestions minus already-selected (case-insensitive), filtered by input.
  const available = useMemo(
    () =>
      suggestions.filter(
        (s) => !selectedKeys.has(normalize(s)) && (query === '' || normalize(s).includes(query))
      ),
    [suggestions, selectedKeys, query]
  );

  const visible = showAll ? available : available.slice(0, COLLAPSED_COUNT);
  const hiddenCount = available.length - COLLAPSED_COUNT;

  // Free-text candidate: trim + strip commas + truncate to the per-tag cap.
  const candidate = input.replace(/,/g, '').trim().slice(0, maxTagLength);
  const candidateKey = normalize(candidate);
  // The one suggestion that IS the candidate, if any (case/diacritic
  // insensitive). A SUBSTRING match (e.g. "Sulfa" inside "Sulfa drugs") does
  // NOT count — that was the WB6 bug: typing "Sulfa" silently offered no way
  // to add "Sulfa" itself, because the presence of "Sulfa drugs" in the
  // filtered list suppressed the custom-add affordance entirely.
  const exactSuggestionMatch = suggestions.find((s) => normalize(s) === candidateKey);
  const showAddCustom =
    !atCap && candidate.length > 0 && !exactSuggestionMatch && !selectedKeys.has(candidateKey);

  const add = (tag: string): void => {
    const cleaned = tag.replace(/,/g, '').trim().slice(0, maxTagLength);
    if (cleaned.length === 0 || atCap || selectedKeys.has(normalize(cleaned))) {
      return; // empty/duplicate/over-cap adds are no-ops
    }
    onChange([...values, cleaned]);
    setInput('');
    setAnnouncement(t('tagInput.addedAnnouncement', { tag: cleaned }));
  };

  /** Remove by INDEX, not value — legacy data can carry duplicate tags (pre-
   *  dating this component's dedup-on-add guard), and removing by value would
   *  either drop every matching occurrence at once or collide on React keys. */
  const remove = (index: number): void => {
    const tag = values[index];
    onChange(values.filter((_, i) => i !== index));
    setAnnouncement(t('tagInput.removedAnnouncement', { tag }));
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key !== 'Enter') return;
    event.preventDefault(); // never submit the surrounding form
    // Enter prefers an EXACT match (adds the suggestion's canonical casing);
    // otherwise it adds the typed text verbatim as a custom tag. It must
    // NEVER silently swap in a substring-matched suggestion the user didn't
    // actually select — that was the WB6 bug ("Sulfa" + Enter → "Sulfa drugs").
    if (exactSuggestionMatch) {
      add(exactSuggestionMatch);
    } else {
      add(candidate);
    }
  };

  // Round 7 chip slimming: pills/chips are min-h-9 (36px) — still comfortably
  // above the 24px SC 2.5.8 minimum. Non-chip controls (input, show-more,
  // clear) keep their 44px targets.
  const pillClass =
    'inline-flex min-h-9 items-center gap-2 rounded-full bg-ink px-4 py-1.5 text-left text-sm font-medium text-cream';
  const chipClass =
    'min-h-9 rounded-full border border-line bg-transparent px-4 py-1.5 text-left text-sm text-ink hover:bg-bg-2';

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={inputId} className="text-sm font-medium text-ink-2">
        {label}
      </label>

      {/* Screen-reader announcements for add/remove (silence otherwise). */}
      <span aria-live="polite" className="sr-only">
        {announcement}
      </span>

      {values.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {values.map((tag, index) => (
            <button
              key={`${tag}-${index}`}
              type="button"
              aria-label={t('tagInput.removeTag', { tag })}
              onClick={() => remove(index)}
              className={pillClass}
            >
              <span>{tag}</span>
              <span aria-hidden="true">✕</span>
            </button>
          ))}
        </div>
      ) : null}

      {atCap ? (
        <p className="m-0 text-sm text-ink-3">{t('tagInput.limitReached')}</p>
      ) : (
        <>
          <div className="relative">
            <input
              id={inputId}
              type="text"
              value={input}
              placeholder={placeholder}
              maxLength={maxTagLength}
              autoComplete="off"
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              className="min-h-[44px] w-full rounded-xl border border-line bg-cream px-4 py-3 pr-12 text-base text-ink placeholder:text-ink-3"
            />
            {input.length > 0 ? (
              <button
                type="button"
                aria-label={t('tagInput.clearInput')}
                onClick={() => setInput('')}
                className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-sm text-ink-3 hover:text-ink"
              >
                <span aria-hidden="true">✕</span>
              </button>
            ) : null}
          </div>

          <div role="group" aria-label={label} className="flex flex-wrap gap-2">
            {showAddCustom ? (
              <button type="button" onClick={() => add(candidate)} className={chipClass}>
                {t('tagInput.addCustom', { text: candidate })}
              </button>
            ) : null}
            {visible.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                aria-pressed={false}
                onClick={() => add(suggestion)}
                className={chipClass}
              >
                {suggestion}
              </button>
            ))}
            {hiddenCount > 0 ? (
              <button
                type="button"
                aria-expanded={showAll}
                onClick={() => setShowAll((prev) => !prev)}
                className="min-h-11 px-2 text-sm font-medium text-ink-2 underline underline-offset-2 hover:text-ink"
              >
                {showAll ? t('tagInput.showLess') : t('tagInput.showMore', { count: hiddenCount })}
              </button>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}

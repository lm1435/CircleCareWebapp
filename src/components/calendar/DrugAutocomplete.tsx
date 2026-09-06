import {
  useEffect,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
  type ReactElement,
} from 'react';
import { useTranslation } from 'react-i18next';
import { Icon, TextField } from '@/components/ui';
import { DRUG_SEARCH_MIN_CHARS, searchDrugs, type DrugSearchResult } from '@/api/drugs';

/** Mobile `DrugAutocomplete` waits 300ms after the last keystroke; same here. */
const SEARCH_DEBOUNCE_MS = 300;

export interface DrugAutocompleteProps {
  id: string;
  label: string;
  value: string;
  onChange: (next: string) => void;
  /**
   * The RxNorm row behind `value` — `null` when the name was typed rather than
   * picked. Both REQUIRED, deliberately (mobile `MedicationNameStep`): a
   * hand-edit reports `onSelectDrug(null)`, and with nowhere to report it a
   * medication could save carrying an `rxcui` that no longer matches its
   * typed name.
   */
  selectedDrug: DrugSearchResult | null;
  onSelectDrug: (drug: DrugSearchResult | null) => void;
  placeholder?: string;
  error?: string;
  required?: boolean;
  autoFocus?: boolean;
  maxLength?: number;
  disabled?: boolean;
}

/**
 * Medication-name field with RxNorm suggestions (mobile
 * `components/DrugAutocomplete.tsx`): type two characters, get real drug
 * names from the backend's RxNorm proxy, pick one to carry its `rxcui` onto
 * the saved event. Typing again after a pick clears the pick — the name and
 * the concept id must never disagree.
 *
 * WAI-ARIA combobox: the input is `role="combobox"` over a `role="listbox"`
 * of options, with `aria-activedescendant` tracking the keyboard highlight.
 * Arrow keys move, Enter picks (and never submits the surrounding form),
 * Escape closes, and options are chosen on mousedown so the input's blur does
 * not dismiss the list before the click lands. Requests for superseded
 * keystrokes are aborted, and a slow response that arrives after a newer one
 * is dropped — the list always reflects the text in the box.
 */
export function DrugAutocomplete({
  id,
  label,
  value,
  onChange,
  selectedDrug,
  onSelectDrug,
  placeholder,
  error,
  required,
  autoFocus,
  maxLength,
  disabled,
}: DrugAutocompleteProps): ReactElement {
  const { t } = useTranslation('calendar');
  const listboxId = useId();
  const [suggestions, setSuggestions] = useState<DrugSearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const requestSeq = useRef(0);
  // Suggestions only ever follow the USER's typing — never a prefilled value
  // (an edit, a wizard hand-off), which would pop a list over a field nobody
  // is looking at.
  const userTypedRef = useRef(false);

  const cancelPending = (): void => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    abortRef.current?.abort();
    abortRef.current = null;
  };

  useEffect(() => cancelPending, []);

  useEffect(() => {
    if (!userTypedRef.current || selectedDrug) return;
    cancelPending();
    if (value.trim().length < DRUG_SEARCH_MIN_CHARS) {
      setSuggestions([]);
      setOpen(false);
      setSearching(false);
      return;
    }
    setSearching(true);
    timerRef.current = setTimeout(() => {
      const controller = new AbortController();
      abortRef.current = controller;
      const seq = ++requestSeq.current;
      searchDrugs(value, controller.signal)
        .then((results) => {
          if (seq !== requestSeq.current) return;
          setSuggestions(results);
          setActiveIndex(-1);
          setOpen(results.length > 0);
        })
        .catch(() => {
          // Aborted, offline, or rate limited: the field still works as a
          // plain text input, which is all a failed lookup should cost.
          if (seq !== requestSeq.current) return;
          setSuggestions([]);
          setOpen(false);
        })
        .finally(() => {
          if (seq === requestSeq.current) setSearching(false);
        });
    }, SEARCH_DEBOUNCE_MS);
    // `cancelPending` is stable module logic over refs; listing it would
    // re-run this on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, selectedDrug]);

  const pick = (drug: DrugSearchResult): void => {
    cancelPending();
    userTypedRef.current = false;
    onChange(drug.name);
    onSelectDrug(drug);
    setSuggestions([]);
    setOpen(false);
    setActiveIndex(-1);
    setSearching(false);
  };

  const handleChange = (event: ChangeEvent<HTMLInputElement>): void => {
    userTypedRef.current = true;
    onChange(event.target.value);
    if (selectedDrug) onSelectDrug(null);
  };

  const handleClear = (): void => {
    cancelPending();
    userTypedRef.current = false;
    onChange('');
    onSelectDrug(null);
    setSuggestions([]);
    setOpen(false);
    setSearching(false);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (!open || suggestions.length === 0) {
      if (event.key === 'Escape' && value.length > 0) {
        // Nothing to close: leave Escape to the dialog.
        return;
      }
      return;
    }
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        setActiveIndex((index) => (index + 1) % suggestions.length);
        break;
      case 'ArrowUp':
        event.preventDefault();
        setActiveIndex((index) => (index <= 0 ? suggestions.length - 1 : index - 1));
        break;
      case 'Enter':
        if (activeIndex >= 0) {
          event.preventDefault();
          pick(suggestions[activeIndex]);
        }
        break;
      case 'Escape':
        // Consumed here so the dialog does not close over an open list.
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
        break;
      case 'Tab':
        setOpen(false);
        break;
    }
  };

  const activeId = activeIndex >= 0 ? `${listboxId}-${activeIndex}` : undefined;

  return (
    <div className="relative">
      <TextField
        id={id}
        label={label}
        value={value}
        placeholder={placeholder}
        error={error}
        required={required}
        autoFocus={autoFocus}
        maxLength={maxLength}
        disabled={disabled}
        autoComplete="off"
        spellCheck={false}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        aria-activedescendant={activeId}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onFocus={() => {
          if (suggestions.length > 0 && !selectedDrug) setOpen(true);
        }}
        onBlur={() => setOpen(false)}
        // "Searching…" rides in the hint slot (already wired to
        // aria-describedby) rather than as a spinner glyph: `rightIcon` takes
        // an icon NAME, and a status line is the more honest signal anyway.
        hint={searching ? t('addEvent.drugSearch.searching') : undefined}
        rightIcon={value.length > 0 && !disabled ? 'close-outline' : undefined}
        onRightIconPress={value.length > 0 && !disabled ? handleClear : undefined}
        rightIconLabel={t('addEvent.drugSearch.clear')}
      />

      {/* Result count for screen readers — the visible list is a listbox the
          combobox already announces, this says how many arrived. */}
      <span aria-live="polite" className="sr-only">
        {open ? t('addEvent.drugSearch.resultCount', { count: suggestions.length }) : ''}
      </span>

      {open && suggestions.length > 0 && (
        <ul
          id={listboxId}
          role="listbox"
          aria-label={t('addEvent.drugSearch.suggestionsLabel')}
          className="absolute left-0 right-0 z-20 m-0 mt-1 max-h-64 list-none overflow-y-auto rounded-lg bg-cream p-1 shadow-lg ring-1 ring-line"
        >
          {suggestions.map((drug, index) => {
            const active = index === activeIndex;
            return (
              <li
                key={drug.rxcui}
                id={`${listboxId}-${index}`}
                role="option"
                aria-selected={active}
                // mousedown, not click: the input blurs on mousedown and would
                // close this list before a click ever fired.
                onMouseDown={(event) => {
                  event.preventDefault();
                  pick(drug);
                }}
                onMouseEnter={() => setActiveIndex(index)}
                className={`flex min-h-[44px] cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-md text-ink ${
                  active ? 'bg-bg-2' : ''
                }`}
              >
                <Icon name="medical-outline" size="row" className="shrink-0 text-moss" />
                <span className="min-w-0 flex-1 truncate">{drug.name}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

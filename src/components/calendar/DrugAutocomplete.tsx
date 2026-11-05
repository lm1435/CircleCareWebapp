import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
  type ReactElement,
} from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Icon, TextField } from '@/components/ui';
import { Analytics } from '@/lib/analytics';
import {
  DRUG_SEARCH_MIN_CHARS,
  drugSearchFailureKind,
  searchDrugs,
  type DrugSearchResult,
} from '@/api/drugs';

/** Case- and accent-insensitive form of a query or drug name, for matching rows against the typed text. */
function foldDrugQuery(text: string): string {
  return text.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/** Mobile `DrugAutocomplete` waits 300ms after the last keystroke; same here. */
const SEARCH_DEBOUNCE_MS = 300;
/**
 * "Searching medications" is only for a lookup that is actually SLOW: it shows when the answer has
 * not arrived this long after the request was SENT, never while typing or during the debounce
 * (mobile `SLOW_SEARCH_SPINNER_MS`; TestFlight 1.4.0 (13) feedback: an always-on spinner confused).
 */
export const SLOW_SEARCH_HINT_MS = 500;

/** One lookup that left the debounce: when its last keystroke landed and when the request went out. */
interface SentLookup {
  keystrokeAt: number;
  sentAt: number;
}

/** `drug_search_completed`, guarded: an analytics failure must never cost the caregiver the lookup. */
function reportSearchCompleted(
  lookup: SentLookup,
  result: 'matches' | 'no_match' | 'error' | 'timeout' | 'superseded'
): void {
  try {
    const now = Date.now();
    Analytics.drugSearchCompleted(now - lookup.keystrokeAt, now - lookup.sentAt, result);
  } catch {
    // ignore
  }
}

/** Gap between the field and its list, and to the edge of the room it may use. */
const LIST_GAP = 4;
/** `max-h-64` — the list's own ceiling; a longer result set scrolls inside it. */
const LIST_MAX_HEIGHT = 256;
/** Below this much room under the field the list opens above it instead (three 44px rows). */
const MIN_ROOM_BELOW = 132;

interface ListPlacement {
  left: number;
  width: number;
  maxHeight: number;
  /** Exactly one of these is set: hang below the field, or sit on top of it. */
  top?: number;
  bottom?: number;
}

/**
 * Where the suggestion list may go. The list is portalled to `document.body`
 * (see the render), so it is positioned with fixed coordinates from the
 * field's rect and confined to the DIALOG it belongs to: never past the
 * footer's top edge (the wizard's Continue / Back live there) and never above
 * the dialog's top. Same rules as `ui/pickerPopover.tsx`.
 */
function placeList(anchor: HTMLElement): ListPlacement {
  const rect = anchor.getBoundingClientRect();
  const dialog = anchor.closest('[role="dialog"]');
  const footer = dialog?.querySelector('[data-modal-footer]');
  const footerRect = footer?.getBoundingClientRect();
  const floor =
    footerRect && footerRect.height > 0
      ? Math.min(window.innerHeight, footerRect.top)
      : window.innerHeight;
  const dialogRect = dialog?.getBoundingClientRect();
  const ceiling = dialogRect && dialogRect.height > 0 ? Math.max(0, dialogRect.top) : 0;
  const roomBelow = floor - rect.bottom - LIST_GAP * 2;
  const roomAbove = rect.top - ceiling - LIST_GAP * 2;
  const base = { left: rect.left, width: rect.width };
  if (roomBelow >= MIN_ROOM_BELOW || roomBelow >= roomAbove) {
    return { ...base, top: rect.bottom + LIST_GAP, maxHeight: Math.max(0, Math.min(LIST_MAX_HEIGHT, roomBelow)) };
  }
  return {
    ...base,
    bottom: window.innerHeight - rect.top + LIST_GAP,
    maxHeight: Math.max(0, Math.min(LIST_MAX_HEIGHT, roomAbove)),
  };
}

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
  /**
   * Onboarding 1.3.1: the user chose the last row, "Use "x" as typed". The name is kept
   * exactly as typed with NO RxNorm id (`selectedDrug` stays null), so an unknown drug
   * never blocks. Optional: a host that does not care about the outcome can omit it.
   */
  onUseAsTyped?: () => void;
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
  onUseAsTyped,
}: DrugAutocompleteProps): ReactElement {
  const { t } = useTranslation('calendar');
  const listboxId = useId();
  const [suggestions, setSuggestions] = useState<DrugSearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  // The search has ANSWERED for the current text (even with no rows): the "as typed" row
  // can then stand alone, so an unknown drug always has a way forward.
  const [answered, setAnswered] = useState(false);
  // The (folded) query `suggestions` answered. While a newer search is in flight the list shows only
  // the rows that still match what is typed, so "Zy" results never sit under "Ibuprofen".
  const [resultsFor, setResultsFor] = useState('');
  const [activeIndex, setActiveIndex] = useState(-1);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const slowTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  // drug_search_completed's clocks. The last keystroke not yet sent, and the sent lookup not yet
  // ended: whoever ends it (its answer, or a keystroke that replaces it) clears this, so it is
  // reported exactly once.
  const lastKeystrokeAtRef = useRef<number | null>(null);
  const inFlightRef = useRef<SentLookup | null>(null);
  const requestSeq = useRef(0);
  // Suggestions only ever follow the USER's typing — never a prefilled value
  // (an edit, a wizard hand-off), which would pop a list over a field nobody
  // is looking at.
  const userTypedRef = useRef(false);
  const anchorRef = useRef<HTMLDivElement | null>(null);
  // Whether the field has focus right now. A debounced response that lands
  // after the caregiver has moved on (typed a name, tabbed to Dosage) must not
  // pop the list open over a field nobody is in: it stayed open there, outside
  // any focus, until the dialog closed.
  const focusedRef = useRef(false);
  const [placement, setPlacement] = useState<ListPlacement | null>(null);

  // THE LIST IS PORTALLED, not `absolute`. Every host is a `Modal`, whose
  // scrolling body clips an absolutely positioned child: in the first-run
  // wizard (a short body over a tall footer) the list showed ~2.5 rows and the
  // rest sat under the footer, so a caregiver could not pick a suggestion.
  // The portal goes to the DIALOG element itself, not `document.body`: a
  // `position: fixed` box is not clipped by the dialog's scrolling body, and
  // staying inside the `aria-modal` dialog keeps the options reachable for a
  // screen reader (which treats everything outside a modal as inert, so
  // `aria-activedescendant` pointed at nothing) and inside a landmark (axe
  // `region` failed on a body-level list). `document.body` is only the
  // fallback for a host that is not in a dialog. The price is repositioning,
  // since a fixed box does not follow a scrolling ancestor.
  const shownSuggestions = useMemo(() => {
    const q = foldDrugQuery(value);
    if (q === resultsFor) return suggestions;
    return suggestions.filter((d) => foldDrugQuery(d.name).includes(q));
  }, [suggestions, resultsFor, value]);
  const listVisible = open && (shownSuggestions.length > 0 || answered);
  // Options = the suggestions, then the "as typed" row.
  const optionCount = shownSuggestions.length + 1;
  useLayoutEffect(() => {
    if (!listVisible) {
      setPlacement(null);
      return;
    }
    const update = (): void => {
      if (anchorRef.current) setPlacement(placeList(anchorRef.current));
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [listVisible, shownSuggestions.length]);

  const cancelPending = (): void => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    if (slowTimerRef.current) clearTimeout(slowTimerRef.current);
    slowTimerRef.current = null;
    abortRef.current?.abort();
    abortRef.current = null;
  };

  useEffect(() => cancelPending, []);

  useEffect(() => {
    if (!userTypedRef.current || selectedDrug) return;
    cancelPending();
    setAnswered(false);
    // A keystroke supersedes whatever was in flight: no "Searching" while typing or debouncing.
    setSearching(false);
    if (value.trim().length < DRUG_SEARCH_MIN_CHARS) {
      setSuggestions([]);
      setOpen(false);
      return;
    }
    const scheduledAt = Date.now();
    timerRef.current = setTimeout(() => {
      const lookup: SentLookup = { keystrokeAt: lastKeystrokeAtRef.current ?? scheduledAt, sentAt: Date.now() };
      lastKeystrokeAtRef.current = null;
      inFlightRef.current = lookup;
      const endLookup = (result: Parameters<typeof reportSearchCompleted>[1]): void => {
        if (inFlightRef.current !== lookup) return; // a newer keystroke already reported it
        inFlightRef.current = null;
        reportSearchCompleted(lookup, result);
      };
      const controller = new AbortController();
      abortRef.current = controller;
      const seq = ++requestSeq.current;
      // The request is SENT now: the hint waits to see whether the answer is slow.
      slowTimerRef.current = setTimeout(() => {
        slowTimerRef.current = null;
        if (seq === requestSeq.current) setSearching(true);
      }, SLOW_SEARCH_HINT_MS);
      searchDrugs(value, controller.signal)
        .then((results) => {
          if (seq !== requestSeq.current) return;
          endLookup(results.length > 0 ? 'matches' : 'no_match');
          setSuggestions(results);
          setResultsFor(foldDrugQuery(value));
          setActiveIndex(-1);
          setAnswered(true);
          // Kept either way, so focusing the field again shows them.
          setOpen(focusedRef.current);
        })
        .catch((error: unknown) => {
          // Aborted, offline, or rate limited: the field still works as a
          // plain text input, which is all a failed lookup should cost.
          if (seq !== requestSeq.current || controller.signal.aborted) return;
          endLookup(drugSearchFailureKind(error));
          setSuggestions([]);
          setAnswered(false);
          setOpen(false);
        })
        .finally(() => {
          if (seq === requestSeq.current) {
            if (slowTimerRef.current) clearTimeout(slowTimerRef.current);
            slowTimerRef.current = null;
            setSearching(false);
          }
        });
    }, SEARCH_DEBOUNCE_MS);
    // `cancelPending` is stable module logic over refs; listing it would
    // re-run this on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, selectedDrug]);

  const pick = (drug: DrugSearchResult): void => {
    inFlightRef.current = null;
    cancelPending();
    userTypedRef.current = false;
    onChange(drug.name);
    onSelectDrug(drug);
    setSuggestions([]);
    setOpen(false);
    setActiveIndex(-1);
    setSearching(false);
  };

  const pickAsTyped = (): void => {
    Analytics.drugSuggestionUseAsTyped(shownSuggestions.length > 0, value.trim().length);
    inFlightRef.current = null;
    cancelPending();
    userTypedRef.current = false;
    setSuggestions([]);
    setOpen(false);
    setActiveIndex(-1);
    setSearching(false);
    setAnswered(false);
    onUseAsTyped?.();
  };

  const handleChange = (event: ChangeEvent<HTMLInputElement>): void => {
    userTypedRef.current = true;
    lastKeystrokeAtRef.current = Date.now();
    if (inFlightRef.current) {
      reportSearchCompleted(inFlightRef.current, 'superseded');
      inFlightRef.current = null;
    }
    onChange(event.target.value);
    if (selectedDrug) onSelectDrug(null);
  };

  const handleClear = (): void => {
    inFlightRef.current = null;
    cancelPending();
    userTypedRef.current = false;
    onChange('');
    onSelectDrug(null);
    setSuggestions([]);
    setOpen(false);
    setSearching(false);
    setAnswered(false);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (!open || !listVisible) {
      // Closed (Escape, or picked and edited back): Down / Alt+Down reopens
      // the suggestions already fetched for this text. Anything else —
      // Escape included — is left to the field and the dialog.
      if (event.key === 'ArrowDown' && (shownSuggestions.length > 0 || answered) && !selectedDrug) {
        event.preventDefault();
        setOpen(true);
        if (!event.altKey) setActiveIndex(0);
      }
      return;
    }
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        setActiveIndex((index) => (index + 1) % optionCount);
        break;
      case 'ArrowUp':
        event.preventDefault();
        setActiveIndex((index) => (index <= 0 ? optionCount - 1 : index - 1));
        break;
      case 'Home':
      case 'End':
        // Only once an option is highlighted: before that the caret owns them.
        if (activeIndex >= 0) {
          event.preventDefault();
          setActiveIndex(event.key === 'Home' ? 0 : optionCount - 1);
        }
        break;
      case 'Enter':
        if (activeIndex >= 0) {
          event.preventDefault();
          if (activeIndex < shownSuggestions.length) pick(shownSuggestions[activeIndex]);
          else pickAsTyped();
        }
        break;
      case 'Escape':
        // Consumed here so the dialog does not close over an open list.
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
        setActiveIndex(-1);
        break;
      case 'Tab':
        setOpen(false);
        break;
    }
  };

  const activeId = listVisible && activeIndex >= 0 ? `${listboxId}-${activeIndex}` : undefined;
  const portalTarget: HTMLElement =
    anchorRef.current?.closest<HTMLElement>('[role="dialog"]') ?? document.body;

  return (
    <div ref={anchorRef} className="relative">
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
        aria-expanded={listVisible}
        aria-controls={listVisible ? listboxId : undefined}
        aria-activedescendant={activeId}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onFocus={() => {
          focusedRef.current = true;
          if ((shownSuggestions.length > 0 || answered) && !selectedDrug) setOpen(true);
        }}
        onBlur={() => {
          focusedRef.current = false;
          setOpen(false);
          setActiveIndex(-1);
        }}
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
        {listVisible
          ? t('addEvent.drugSearch.resultCount', { count: shownSuggestions.length })
          : ''}
      </span>

      {listVisible &&
        placement &&
        createPortal(
        <ul
          id={listboxId}
          role="listbox"
          aria-label={t('addEvent.drugSearch.suggestionsLabel')}
          // z-[60]: the portal makes the list a SIBLING of Modal's z-50 backdrop.
          style={{
            position: 'fixed',
            left: placement.left,
            width: placement.width,
            top: placement.top,
            bottom: placement.bottom,
            maxHeight: placement.maxHeight,
          }}
          className="z-[60] m-0 list-none overflow-y-auto rounded-lg bg-cream p-1 shadow-lg ring-1 ring-line"
        >
          {shownSuggestions.map((drug, index) => {
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
          <li
            id={`${listboxId}-${shownSuggestions.length}`}
            role="option"
            aria-selected={activeIndex === shownSuggestions.length}
            data-testid="drug-use-as-typed"
            onMouseDown={(event) => {
              event.preventDefault();
              pickAsTyped();
            }}
            onMouseEnter={() => setActiveIndex(shownSuggestions.length)}
            className={`flex min-h-[44px] cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-md text-ink ${
              activeIndex === shownSuggestions.length ? 'bg-bg-2' : ''
            } ${shownSuggestions.length > 0 ? 'mt-1 border-t border-line-2' : ''}`}
          >
            <span className="min-w-0 flex-1 truncate">
              {t('addEvent.drugSearch.useAsTyped', { name: value.trim() })}
            </span>
            <Icon name="chevron-forward" size="inline" className="shrink-0 text-ink-3" />
          </li>
        </ul>,
        portalTarget
        )}
    </div>
  );
}

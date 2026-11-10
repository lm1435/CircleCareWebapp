import {
  Fragment,
  useId,
  useMemo,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';
import { FieldLabel, Icon } from '@/components/ui';
import { fieldShell, INPUT_TEXT } from '@/components/ui/inputStyles';
import {
  buildTimezoneOptions,
  filterTimezoneOptions,
  zoneOptionLabel,
  type TimezoneRegion,
} from '@/lib/timezoneOptions';
import { isSameTimezone } from '@/utils/timezone';

// Searchable circle time-zone picker (circle-timezone spec, web T11).
//
// WAI-ARIA combobox (same contract as calendar/DrugAutocomplete): the input is
// `role="combobox"` over a `role="listbox"` grouped by region, with
// `aria-activedescendant` tracking the keyboard highlight. Arrow keys move,
// Enter picks (never submits a surrounding form), Escape closes, options pick
// on mousedown so the input's blur does not dismiss the list first.
//
// The list renders IN FLOW under the field, not portalled/absolute: both hosts
// (the Edit Circle card and the create modal's scrolling body) then simply grow
// to hold it, so nothing is clipped and the options stay inside the dialog for
// a screen reader.

/** The value the "Automatic" option stands for. */
export const AUTOMATIC = null;

interface Row {
  key: string;
  zone: string | null;
  label: string;
  /** Second line (the automatic option only). */
  hint?: string;
  region: TimezoneRegion | null;
}

export interface TimezoneComboboxProps {
  id: string;
  label: ReactNode;
  /** The zone the closed field shows ("Mexico City (GMT-6)"). */
  displayZone: string;
  /**
   * The chosen value, for the checkmark: an IANA id, or `null` when the
   * automatic option is the current choice.
   */
  selected: string | null;
  /** Renders the "Automatic — follow …" option first; picking it reports `null`. */
  /**
   * Renders the "Automatic" option first — a label plus a sub-line
   * ("Follow Maria's device · currently Monterrey"); picking it reports `null`.
   */
  automaticOption?: { label: string; hint: string };
  onSelect: (zone: string | null) => void;
  /** Ids of the helper lines under the field, for `aria-describedby`. */
  describedBy?: string;
  /** A save is in flight: picks are ignored, the field stays focusable. */
  busy?: boolean;
  testId?: string;
}

export function TimezoneCombobox({
  id,
  label,
  displayZone,
  selected,
  automaticOption,
  onSelect,
  describedBy,
  busy = false,
  testId,
}: TimezoneComboboxProps): ReactElement {
  const { t, i18n } = useTranslation('circles');
  const listboxId = useId();
  const [open, setOpen] = useState(false);
  // `null` = the user has not typed since opening: the list shows everything.
  const [query, setQuery] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(-1);

  // Literal keys (not a template) so the static translation-key audit sees them.
  const regionLabels = useMemo<Record<TimezoneRegion, string>>(
    () => ({
      America: t('timezone.regions.America'),
      Europe: t('timezone.regions.Europe'),
      Asia: t('timezone.regions.Asia'),
      Africa: t('timezone.regions.Africa'),
      Australia: t('timezone.regions.Australia'),
      Pacific: t('timezone.regions.Pacific'),
      Atlantic: t('timezone.regions.Atlantic'),
      Indian: t('timezone.regions.Indian'),
      Antarctica: t('timezone.regions.Antarctica'),
      Arctic: t('timezone.regions.Arctic'),
    }),
    [t]
  );
  const regionLabel = (region: TimezoneRegion): string => regionLabels[region];
  // Rebuilt per language (city names are localized); offsets are "now".
  const options = useMemo(
    () => buildTimezoneOptions(undefined, (region) => regionLabels[region]),
    // i18n.language: city names are localized by the active language.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [regionLabels, i18n.language]
  );

  const rows: Row[] = useMemo(() => {
    const matches = filterTimezoneOptions(options, query ?? '');
    const zoneRows: Row[] = matches.map((o) => ({
      key: o.zone,
      zone: o.zone,
      label: o.label,
      region: o.region,
    }));
    // Automatic is offered only on the unfiltered list: it is not a place, so
    // it never matches a city search.
    return automaticOption && !query
      ? [
          {
            key: '__automatic',
            zone: AUTOMATIC,
            label: automaticOption.label,
            hint: automaticOption.hint,
            region: null,
          },
          ...zoneRows,
        ]
      : zoneRows;
  }, [options, query, automaticOption]);

  const close = (): void => {
    setOpen(false);
    setQuery(null);
    setActiveIndex(-1);
  };

  const pick = (row: Row): void => {
    if (busy) return;
    close();
    onSelect(row.zone);
  };

  const handleChange = (event: ChangeEvent<HTMLInputElement>): void => {
    let next = event.target.value;
    // Typing into a CLOSED field (still focused after Escape or a pick, so no
    // new focus event reopened it): the box held the chosen zone's label, and
    // the keystroke landed after it ("Denver (GMT-7)M"). The search is only
    // what was typed, never the label.
    if (!open) {
      const shown = zoneOptionLabel(displayZone);
      if (next.startsWith(shown)) next = next.slice(shown.length);
    }
    setQuery(next);
    setOpen(true);
    setActiveIndex(-1);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (!open) {
      if (event.key === 'ArrowDown' || (event.key === 'Enter' && event.altKey)) {
        event.preventDefault();
        setOpen(true);
        setActiveIndex(0);
      }
      return;
    }
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        if (rows.length) setActiveIndex((i) => (i + 1) % rows.length);
        break;
      case 'ArrowUp':
        event.preventDefault();
        if (rows.length) setActiveIndex((i) => (i <= 0 ? rows.length - 1 : i - 1));
        break;
      case 'Enter':
        // Never submit the surrounding form from inside an open list.
        event.preventDefault();
        if (activeIndex >= 0 && rows[activeIndex]) pick(rows[activeIndex]);
        break;
      case 'Escape':
        // Consumed so a host dialog does not close over an open list.
        event.preventDefault();
        event.stopPropagation();
        close();
        break;
      case 'Tab':
        close();
        break;
    }
  };

  const optionId = (index: number): string => `${listboxId}-opt-${index}`;
  const activeId = open && activeIndex >= 0 ? optionId(activeIndex) : undefined;
  // ICU canonical vs current IANA spelling (Asia/Calcutta vs Asia/Kolkata) is the same zone.
  const isChosen = (row: Row): boolean =>
    row.zone === null || selected === null ? row.zone === selected : isSameTimezone(row.zone, selected);

  // Group consecutive rows by region (the automatic row has none).
  const groups: { region: TimezoneRegion | null; items: { row: Row; index: number }[] }[] = [];
  rows.forEach((row, index) => {
    const last = groups[groups.length - 1];
    if (last && last.region === row.region) last.items.push({ row, index });
    else groups.push({ region: row.region, items: [{ row, index }] });
  });

  const renderOption = ({ row, index }: { row: Row; index: number }): ReactElement => {
    const active = index === activeIndex;
    const chosen = isChosen(row);
    return (
      <div
        key={row.key}
        id={optionId(index)}
        role="option"
        aria-selected={chosen}
        data-zone={row.zone ?? 'automatic'}
        onMouseDown={(event) => {
          event.preventDefault();
          pick(row);
        }}
        onMouseEnter={() => setActiveIndex(index)}
        className={`flex min-h-[44px] cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-md text-ink ${
          active ? 'bg-bg-2' : ''
        }`}
      >
        <span className="flex min-w-0 flex-1 flex-col">
          <span>{row.label}</span>
          {row.hint ? <span className="text-sm text-ink-3">{row.hint}</span> : null}
        </span>
        {chosen ? <Icon name="checkmark" size="inline" className="shrink-0 text-moss" /> : null}
      </div>
    );
  };

  return (
    <div data-testid={testId}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <div className={fieldShell({ disabled: false })}>
        <Icon name="time-outline" size="inline" className="shrink-0 text-ink-3" />
        <input
          id={id}
          type="text"
          role="combobox"
          autoComplete="off"
          spellCheck={false}
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={open ? listboxId : undefined}
          aria-activedescendant={activeId}
          aria-describedby={describedBy}
          aria-busy={busy || undefined}
          placeholder={t('timezone.searchPlaceholder')}
          className={INPUT_TEXT}
          // Open = a search box (empty until typed; the current choice is the
          // checked option). Closed = the chosen zone.
          value={open ? (query ?? '') : zoneOptionLabel(displayZone)}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onFocus={() => setOpen(true)}
          onClick={() => setOpen(true)}
          onBlur={close}
        />
        <Icon name="chevron-down" size="inline" className="pointer-events-none shrink-0 text-ink-2" />
      </div>

      <span aria-live="polite" className="sr-only">
        {open ? t('timezone.resultCount', { count: rows.filter((r) => r.zone !== null).length }) : ''}
      </span>

      {open && rows.length === 0 ? (
        <p className="m-0 mt-1 px-3 py-2 text-sm text-ink-3">{t('timezone.noResults')}</p>
      ) : null}

      {open && rows.length > 0 ? (
        <div
          id={listboxId}
          role="listbox"
          aria-label={t('timezone.listLabel')}
          className="mt-1 max-h-72 overflow-y-auto rounded-lg bg-cream p-1 shadow-lg ring-1 ring-line"
        >
          {groups.map((group, gi) =>
            group.region ? (
              <div key={`${group.region}-${gi}`} role="group" aria-labelledby={`${listboxId}-g${gi}`}>
                <div
                  id={`${listboxId}-g${gi}`}
                  className="px-3 pb-1 pt-3 text-xs font-semibold uppercase tracking-wide text-ink-3"
                >
                  {regionLabel(group.region)}
                </div>
                {group.items.map(renderOption)}
              </div>
            ) : (
              <Fragment key={`auto-${gi}`}>{group.items.map(renderOption)}</Fragment>
            )
          )}
        </div>
      ) : null}
    </div>
  );
}

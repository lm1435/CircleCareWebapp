import { lazy, Suspense, useCallback, useId, useRef, type ReactElement, type ReactNode } from 'react';
import { useMenu } from '@/hooks/useMenu';
import { emitNativeChange } from './pickerField';

/** Lazy for the same reason as `DateField` / `TimeField`: the panels stay out of the `components/ui` barrel. */
const DatePickerPanel = lazy(() => import('./DatePickerPanel'));
const TimePickerPanel = lazy(() => import('./TimePickerPanel'));

/**
 * A VALUE TILE THAT IS THE PICKER (owner 2026-11-10, the simple forms' "Starts | Repeats until", "From | To",
 * "At", the medication's "Other…"): tapping the tile opens the app's own date / time popover anchored to it,
 * exactly as the trailing button of `DateField` / `TimeField` does. Mobile twin: the value tiles that open the
 * native picker sheet.
 *
 * THE NATIVE INPUT STAYS, HIDDEN. A visually hidden `<input type="date|time">` (`inputId`) still carries the
 * value: the popover writes through it with `emitNativeChange` (the same path the fields use), so the form's
 * handlers keep reading `e.target.value`, and the ids the form, its error focus and the end-to-end specs
 * already address (`#scheduled_date`, `#scheduled_time`, `#endTime`, `#recurrence_end_date`) keep pointing at
 * the value. It is out of the tab order and hidden from assistive tech: the TILE is the control (named by its
 * visible text, so its label is in its name), and the error focus lands on the tile (`${inputId}-tile`).
 */
export interface PickerTileProps {
  kind: 'date' | 'time';
  /** The hidden native input's id; the tile button is `${inputId}-tile`. */
  inputId: string;
  /** The hidden input's name (scripts and tests address it by label; never announced). */
  inputLabel: string;
  /** `YYYY-MM-DD` / `HH:MM`, '' when unset. */
  value: string;
  onChange: (next: string) => void;
  /** Date only: the field's frame "today" (see `DateField`). */
  today?: string;
  /** Date only: the first pickable day. */
  min?: string;
  /** Date only: the panel's clear button label, or `null` for none (see `DatePickerPanel`). */
  clearLabel?: string | null;
  disabled?: boolean;
  /** The tile's look (the caller's: a value tile, a time chip). */
  className: string;
  testId?: string;
  describedBy?: string;
  invalid?: boolean;
  ariaLabel?: string;
  /** Called as the popover opens (before any pick). */
  onOpen?: () => void;
  children: ReactNode;
}

export function PickerTile({
  kind,
  inputId,
  inputLabel,
  value,
  onChange,
  today,
  min,
  clearLabel,
  disabled = false,
  className,
  testId,
  describedBy,
  invalid = false,
  ariaLabel,
  onOpen,
  children,
}: PickerTileProps): ReactElement {
  const menu = useMenu();
  const panelId = useId();
  const inputRef = useRef<HTMLInputElement | null>(null);

  const handlePick = useCallback((next: string): void => {
    if (inputRef.current) emitNativeChange(inputRef.current, next);
  }, []);
  const handleDismiss = useCallback((): void => menu.close(true), [menu]);

  return (
    <>
      <button
        ref={menu.buttonRef}
        type="button"
        id={`${inputId}-tile`}
        data-testid={testId}
        aria-label={ariaLabel}
        aria-haspopup="dialog"
        aria-expanded={menu.open}
        aria-controls={menu.open ? panelId : undefined}
        aria-describedby={describedBy}
        aria-invalid={invalid || undefined}
        disabled={disabled}
        onClick={() => {
          if (!menu.open) onOpen?.();
          menu.toggle();
        }}
        onKeyDown={menu.onButtonKeyDown}
        className={className}
      >
        {children}
      </button>
      <input
        ref={inputRef}
        id={inputId}
        type={kind}
        aria-label={inputLabel}
        aria-hidden="true"
        tabIndex={-1}
        disabled={disabled}
        value={value}
        min={kind === 'date' ? min : undefined}
        onChange={(event) => onChange(event.target.value)}
        className="sr-only"
      />
      {menu.open ? (
        <Suspense fallback={null}>
          {kind === 'date' ? (
            <DatePickerPanel
              id={panelId}
              anchorRef={menu.buttonRef}
              panelRef={menu.menuRef}
              triggerRef={menu.buttonRef}
              value={value}
              min={min}
              today={today}
              clearLabel={clearLabel}
              onPick={handlePick}
              onDismiss={handleDismiss}
            />
          ) : (
            <TimePickerPanel
              id={panelId}
              anchorRef={menu.buttonRef}
              panelRef={menu.menuRef}
              triggerRef={menu.buttonRef}
              value={value}
              onPick={handlePick}
              onDismiss={handleDismiss}
            />
          )}
        </Suspense>
      ) : null}
    </>
  );
}

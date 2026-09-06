/**
 * THE canonical field appearance (spec §4.5), ported from
 * `mobile/src/components/ui/inputStyles.ts` + `Field.tsx`.
 *
 * Mobile numbers, verbatim: white ground, 1px hair border (`line-2`), radius 12
 * (`rounded-md`), padding 14 horizontal / 12 vertical, min-height 44, gap 10
 * between the text and an icon slot, 16pt type. Focus animates the border to
 * `moss-light` over 200ms — on mobile that is an `Animated.Value`; here it is
 * `focus-within` + `transition-colors`, which is why the bordered box is a
 * `<div>` wrapping the native control rather than the control itself. The
 * global `*:focus-visible` ring is suppressed on `input/textarea/select`
 * (globals.css) precisely so this border IS the focus affordance.
 *
 * Error wins over focus (mobile: `error ? INPUT_ERROR_BORDER : interpolate(...)`),
 * which is why `INPUT_SHELL_ERROR` also pins `focus-within`.
 *
 * Anything that renders a text-entry control imports FROM HERE. If a field
 * needs to look different, change it here and let every form move together.
 */

/**
 * Everything the bordered box is except its border COLOR and its cross-axis
 * alignment — the two things a state or a variant swaps.
 *
 * Split out rather than layered because two utilities that set the same
 * property in one class string are resolved by the order Tailwind emits them,
 * not the order they are written: `border-terracotta` after `border-line-2`
 * wins today only because `--color-line-2` happens to be declared first in the
 * `@theme` block. `fieldShell` picks ONE, so re-ordering the palette can never
 * silently un-error a field.
 */
const SHELL_BOX =
  'gap-2.5 bg-cream border rounded-md px-3.5 min-h-[44px] transition-colors duration-fast';

/** The resting/focus border pair — mobile's `INPUT_RESTING_BORDER` → `INPUT_FOCUSED_BORDER`. */
const SHELL_RESTING = 'border-line-2 focus-within:border-moss-light';

/** The bordered box. Wraps the native control; never applied TO it. */
export const INPUT_SHELL = `flex items-center ${SHELL_BOX} ${SHELL_RESTING}`;

/** Multiline variant (mobile `containerMultiline`): text starts at the top. */
export const INPUT_SHELL_MULTILINE = `flex items-start ${SHELL_BOX} ${SHELL_RESTING}`;

/**
 * The error border. REPLACES the resting pair (see `fieldShell`) — on mobile
 * the error color short-circuits the focus interpolation entirely, so focusing
 * an invalid field must not turn it moss.
 */
export const INPUT_SHELL_ERROR = 'border-terracotta focus-within:border-terracotta';

/** Spec §4.5: disabled is 50% opacity everywhere. */
export const INPUT_SHELL_DISABLED = 'opacity-50';

export interface FieldShellOptions {
  error?: boolean;
  disabled?: boolean;
  /** Top-aligns the content for a textarea. */
  multiline?: boolean;
  /** Extra classes for the box (e.g. `relative` for the date/time overlay). */
  extra?: string;
}

/** The shell for one field, in one state. Every §4.5 control builds its box here. */
export function fieldShell({ error, disabled, multiline, extra }: FieldShellOptions = {}): string {
  return [
    multiline ? 'flex items-start' : 'flex items-center',
    SHELL_BOX,
    error ? INPUT_SHELL_ERROR : SHELL_RESTING,
    disabled ? INPUT_SHELL_DISABLED : null,
    extra ?? null,
  ]
    .filter(Boolean)
    .join(' ');
}

/**
 * The native control inside the shell. `border-0 m-0` + `outline-none` because
 * the box around it owns the border/background/focus animation; `min-w-0` so
 * a long value shrinks instead of pushing the trailing icon out of the box.
 *
 * `self-stretch py-3` (not the shell's `py-3`, see `SHELL_BOX`) is why a click
 * anywhere in the shell now lands ON this element: the shell contributes NO
 * vertical padding of its own, so its content-box height IS this control's
 * box (self-stretch matches whatever the row's tallest sibling — e.g. a
 * trailing icon button — needs), and there is no dead space between the
 * shell's border and the control for a click to get lost in. `px-0` keeps the
 * shell's own `px-3.5` as the only horizontal inset.
 */
export const INPUT_TEXT =
  'flex-1 min-w-0 self-stretch bg-transparent border-0 px-0 py-3 m-0 text-md leading-normal text-ink placeholder:text-placeholder outline-none';

/**
 * The trailing 44×44 slot (mobile `INPUT_TRAILING_SLOT`). Only the horizontal
 * margin cancels the shell's own `px-3.5` so the touch target reaches the
 * box's right edge — there is no vertical padding left on the shell to cancel
 * (see `INPUT_TEXT`), so no `-my-*` here; `items-center` on the shell centers
 * this slot against whatever height the control establishes.
 */
export const INPUT_TRAILING =
  'min-w-[44px] min-h-[44px] -mr-3.5 inline-flex items-center justify-center text-ink-2';

/**
 * For `<input type="date">` / `type="time"`: keep the browser's own picker
 * button, but make it invisible and stretch it over the trailing icon slot, so
 * the app's `calendar-outline`/`time-outline` glyph is what you SEE while the
 * native control is what you CLICK. Hiding the indicator outright would make
 * the picker unreachable with a mouse (typing still works, and so does
 * Alt+Down), and leaving it visible would draw two glyphs side by side.
 *
 * The pseudo-element is positioned against the shell (the input itself is a
 * static flex child), which is why both date fields add `relative` to it.
 * WebKit/Blink only; Firefox draws no indicator of its own.
 */
export const PICKER_INDICATOR_OVERLAY =
  '[&::-webkit-calendar-picker-indicator]:absolute [&::-webkit-calendar-picker-indicator]:right-0 [&::-webkit-calendar-picker-indicator]:top-0 [&::-webkit-calendar-picker-indicator]:h-full [&::-webkit-calendar-picker-indicator]:w-11 [&::-webkit-calendar-picker-indicator]:cursor-pointer [&::-webkit-calendar-picker-indicator]:opacity-0';

/** Wraps `<Text variant="label">`: 8px below the label (spec §4.5). */
export const INPUT_LABEL = 'block mb-2 ml-1';

/** Wraps `<Text variant="caption">`: 4px above, 4px left inset (spec §4.5). */
export const INPUT_HINT = 'mt-1 ml-1';

/** The error line: same 4px offsets, plus the `alert-circle-outline` glyph. */
export const INPUT_ERROR =
  'mt-1 ml-1 flex items-center gap-1 text-sm text-terracotta';

/**
 * Chips (ChipSelect, TagInput suggestions/pills) minus their border color —
 * same reason `SHELL_BOX` omits it: `border-ink` and `border-line` in one class
 * string are resolved by Tailwind's emit order, and `--color-line` is declared
 * AFTER `--color-ink`, so the selected chip would have quietly kept the
 * hairline border. Pill radius, 44 tall, and the press-scale mobile gets from
 * `Pressable`.
 */
const CHIP_BOX =
  'min-h-[44px] px-4 rounded-full border text-sm font-medium inline-flex items-center gap-1.5 transition-[transform,background-color] duration-fast ease-spring active:scale-[0.97]';

/** The unselected chip's full class string. */
export const CHIP_BASE = `${CHIP_BOX} border-line`;

/** Selected chip — ink is the interactive language (decision 2026-09-04). */
export const CHIP_SELECTED = 'bg-ink text-cream border-ink';

/** Unselected chip. */
export const CHIP_UNSELECTED = 'border-line text-ink hover:bg-bg-2';

export function chipClass(selected: boolean): string {
  return `${CHIP_BOX} ${selected ? CHIP_SELECTED : CHIP_UNSELECTED}`;
}

/**
 * A radio/checkbox option row (RadioGroup), border color excluded for the same
 * reason as the chip. `py-2` is not extra height — the row's 44 is a FLOOR, and
 * an option carrying a hint is two lines that would otherwise sit flush against
 * the border.
 */
const OPTION_BOX = 'min-h-[44px] rounded-md border px-4 py-2 flex items-center gap-3';

/** The unselected, enabled option row's full class string. */
export const OPTION_ROW = `${OPTION_BOX} border-line-2 cursor-pointer`;

/** The selected option row. */
export const OPTION_ROW_SELECTED = 'border-ink bg-bg-2';

/**
 * One option row, in one state.
 *
 * The cursor is PICKED, not layered, for the same reason the border color is:
 * Tailwind emits `.cursor-not-allowed` before `.cursor-pointer`, so a disabled
 * row carrying both would still show the pointer — the exact opposite of what
 * the disabled branch exists to say.
 */
export function optionRow(selected: boolean, disabled?: boolean): string {
  return [
    OPTION_BOX,
    selected ? OPTION_ROW_SELECTED : 'border-line-2',
    disabled ? `cursor-not-allowed ${INPUT_SHELL_DISABLED}` : 'cursor-pointer',
  ].join(' ');
}

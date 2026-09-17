import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import { useCoarsePointer } from '@/hooks/useCoarsePointer';

/**
 * THE POPOVER SHELL BOTH FIELD PICKERS HANG OFF — one module, deliberately.
 *
 * ── TWO PRESENTATIONS, ONE DECISION, MADE HERE ────────────────────────────
 *
 * {@link usePickerPresentation} picks `anchored` (a box hanging off the field)
 * or `sheet` (full width, on the viewport floor, with its own scrim) and
 * NOTHING ELSE in the codebase makes that call. It is one decision in one place
 * on purpose: presentation drives the placement arithmetic, the scrim, the
 * scroll lock and the animation, and a second copy of the condition is how
 * three of those four end up agreeing and the fourth does not.
 *
 * THE SHEET EXISTS BECAUSE THE ANCHORED PANEL COULD NOT BE SHIPPED TO TOUCH,
 * and these are the three measured defects it had to answer — all three, or the
 * gate that used to hide this widget from touch devices was the honest answer:
 *
 *   1. IOS SUMMONS ITS OWN PICKER FROM THE FOCUSED INPUT, not from a button.
 *      `PICKER_INDICATOR_HIDDEN` is a Chromium affordance and a MEASURED no-op
 *      in WebKit (a bare `<input type="date">` is 97px -> 97px there, against
 *      148 -> 128 in Chromium; pinned by `e2e/coarse-pointer.spec.ts`), so
 *      rendering a popover on touch without closing that route is BOTH pickers
 *      on one field. Answered in the FIELDS, not here: they make the input
 *      `readOnly` on a coarse pointer and route a tap on it to this shell.
 *   2. OCCLUSION AT PHONE WIDTH. Anchored, the date panel covered 65% of the
 *      Add Medication modal and INTERCEPTED taps meant for Close, the event
 *      type, the name and the dosage (Playwright refused one outright:
 *      "gridcell … intercepts pointer events"); at 390x360 with the keyboard up
 *      the calendar clamped to 176px and showed about 1.5 of 6 week rows; at
 *      320px the 304px panel was wider than the modal card it sat in. A sheet
 *      is full-bleed and MODAL — the scrim is the surface those taps land on,
 *      and dismissing is what they now do — and it takes its height from the
 *      viewport rather than from the gap under one field.
 *   3. ROW HEIGHT. `TimePickerPanel`'s 36px row was justified by "the whole
 *      control exists only on a pointer device". That premise died with the
 *      gate, so the sheet's ceiling ({@link SHEET_MAX_PANEL_HEIGHT}) is built
 *      out of 44px rows instead — the house standard, and WCAG 2.5.5 AAA.
 *
 * ── AND EVERYTHING BELOW IS THE ANCHORED CASE ─────────────────────────────
 *
 * `TimePickerPanel` and `DatePickerPanel` show completely different things (three
 * scrollable columns vs a month grid), but everything AROUND what they show is
 * the same problem with the same non-obvious answer, and every one of those
 * answers was paid for by a bug:
 *
 *   - PORTALLED TO `document.body`, FIXED. Both fields live inside `Modal`,
 *     whose panel is `overflow-hidden` around a scrollable body. An `absolute`
 *     popover (what `MoreMenu` still does, and what its FOLLOW-UP note
 *     describes) is painted CLIPPED by that body — the bottom half of a picker
 *     hung off a field near the end of AddEventModal simply is not there. A
 *     portal to `document.body` has no clipping ancestor at all, which is the
 *     only complete answer; the price is the repositioning below, since a fixed
 *     box does not follow a scrolling ancestor.
 *   - `z-[60]`, because the portal makes the panel a SIBLING of `Modal`'s
 *     `z-50` backdrop and nothing about DOM order guarantees it paints on top.
 *   - FLIP ABOVE, THEN CLAMP. Flipping alone is not enough and shipped broken:
 *     the time picker correctly flipped above a field near the bottom of a long
 *     modal and then ran off the TOP of the window, with its first rows
 *     unreachable. The panel is capped to the room actually available on the
 *     chosen side, and the panel's own scrolling region absorbs the rest.
 *   - AND A CEILING ON TOP OF THAT CLAMP, because the clamp only ever fires
 *     when the panel does NOT fit: a picker with room to spare took its full
 *     natural height and covered the form it belongs to. See
 *     {@link MAX_PANEL_HEIGHT} — the two caps answer different questions and
 *     the shell needs both.
 *   - ESCAPE AND TAB STOP PROPAGATING. React portals bubble along the REACT
 *     tree, not the DOM one, so a keydown in the panel still reaches `Modal`'s
 *     `onKeyDown`. Left alone, Escape closes the DIALOG instead of the picker,
 *     and Tab hits the dialog's focus trap — which cannot see a portalled node
 *     inside itself (`dialog.contains(active)` is false), so it yanks focus
 *     back to the modal's close button on the first Tab inside the popover.
 *   - OUTSIDE CLICK RESTORES FOCUS. `useMenu`'s own outside-click listener
 *     calls `setOpen(false)` and nothing else, so clicking away from an open
 *     picker dropped focus on the floor (Escape, Enter and a second trigger
 *     click all restored it — the one path that did not was the common one).
 *     Fixed HERE rather than in `useMenu` on purpose: every other `useMenu`
 *     consumer is a menu whose items navigate or mutate, where forcing focus
 *     back to the trigger on an outside click would fight the click that just
 *     landed somewhere else. A field popover is the case where the trigger IS
 *     where focus belongs. The listener below runs on `mousedown` alongside
 *     `useMenu`'s, and a click that lands on something focusable still wins —
 *     the browser's own focus follows our handler, not the other way round.
 *
 * Keeping two copies of that list was never going to work: the flip-and-clamp
 * bug above was fixed once, and a second copy is how it comes back on the
 * calendar, which is taller and hits it harder.
 *
 * WHAT IS NOT HERE: what the panel shows, how its own keys move a selection,
 * and where focus goes on open. Those are the panels' own, and the shell hands
 * them {@link PickerPopoverProps.onPositioned} — the one moment when the panel
 * is in the DOM, measured, and clamped — to do it in.
 *
 * NOT in `components/ui/index.ts`, and imported only by the two lazily-loaded
 * panels: this module is on the far side of `React.lazy` from the fields, which
 * is what keeps `react-dom`'s portal and the panels' own weight out of the
 * barrel every screen imports.
 */

/** `mt-1` on the panel — the gap it keeps from the field. */
const ANCHOR_GAP = 4;
/** Breathing room between the panel and the viewport edge. */
const EDGE_GUTTER = 8;

/**
 * THE LOWEST PIXEL THE PANEL MAY OCCUPY — the viewport floor, or the top of the
 * dialog footer when the field is in one.
 *
 * A `Modal` footer is Cancel and the submit button, and the panel is `fixed` at
 * `z-[60]` OVER it. At <=400px of viewport width the calendar covered both
 * outright (the time panel does it at short viewports), so a mouse aimed at
 * Create landed on a `gridcell` and COMMITTED A DATE instead of submitting the
 * form. Keyboard users never hit it — Tab is trapped in the popover, which is
 * the whole of this widget's WCAG 2.4.11 answer — and the coarse-pointer gate
 * does not cover it either, because a narrow DESKTOP window is a fine pointer.
 *
 * Read off the DOM rather than passed in as a prop: the popover is portalled to
 * `document.body`, so its only route back to the dialog it belongs to is the
 * ANCHOR, which is still in that dialog's tree. `height > 0` is the guard that
 * matters — an unrendered or unmeasured footer reports a rect of zeros, and
 * reserving from `top: 0` would squeeze the panel to nothing.
 */
function bottomLimitFor(anchorEl: HTMLElement): number {
  const footer = anchorEl.closest('[role="dialog"]')?.querySelector('[data-modal-footer]');
  const rect = footer?.getBoundingClientRect();
  return rect && rect.height > 0 ? Math.min(window.innerHeight, rect.top) : window.innerHeight;
}

/**
 * THE CEILING ON THE PANEL'S OWN APPETITE — the cap that is NOT about the
 * viewport, and the one the first version of this shell was missing.
 *
 * The flip-and-clamp below limits a panel to the room available on the side it
 * chose, which sounds like the whole problem and is only half of it: a panel
 * that already FITS makes that clamp a no-op, so the height it settles on is
 * its natural one. The time picker shipped the proof — twelve hour rows is a
 * ~470px panel, there was ~740px of room under a field near the top of the Add
 * Event modal, so nothing capped anything and the "dropdown" covered the form
 * from above the dialog's top edge down past the Repeat field. A control that
 * tall is a second dialog, not a menu hanging off a field.
 *
 * 288 = seven 36px rows + the 26px column header + `p-1` + the borders, exactly
 * (see `TimePickerPanel`'s `ROW_HEIGHT` and `MIN_USABLE_PANEL`). Seven is the
 * number because a scrolling column opens CENTRED on its value
 * ({@link centerInColumn}, driven from `onPositioned`): three neighbours either
 * side is as much context as picking a minute needs, and anything more is
 * height spent covering the form the value is being typed into.
 *
 * Shorter content is left alone — the effective height is
 * `min(natural, ceiling, room)` — so no panel is made to scroll to reach a row
 * it already had space for. {@link PickerPopoverProps.maxHeight} raises the
 * ceiling for the one panel whose content is not a list: see the calendar's
 * `NATURAL_PANEL_HEIGHT`.
 */
export const MAX_PANEL_HEIGHT = 288;

/**
 * THE SAME CEILING, REBUILT OUT OF TOUCH ROWS — the sheet's default appetite.
 *
 * 359 = seven 44px rows (308) + the 26px column header + the SHEET's own
 * chrome: `pt-3`, the 0.75rem floor of its `pb-[max(…)]`, and its single
 * `border-t`. SEVEN is the design decision in both ceilings (an odd count, so
 * the selected row sits on the centre line with three either side); the two
 * numbers are only its arithmetic at the two row sizes AND in the two boxes,
 * which is why `src/__tests__/bans/pickerRowHeight.test.ts` derives both rather
 * than pinning either as a literal — and now reads the padding straight out of
 * the class strings below, so a change to one without the other is a named
 * failure.
 *
 * IT IS NOT {@link MAX_PANEL_HEIGHT}'s CHROME, and used to be. The sheet wore
 * the anchored panel's `p-1` and counted the anchored panel's two borders; it
 * now has 12px of padding at both ends and one border, so the same seven rows
 * need 15px more box to sit in. Substituting only `TOUCH_ROW_HEIGHT` and
 * leaving the chrome alone is how the ceiling quietly becomes six rows and a
 * sliver.
 *
 * A device that reports a real `safe-area-inset-bottom` spends it on the home
 * indicator and gets a little under seven rows. That is the correct trade and
 * the same one the old 0.25rem floor made — the difference is that the devices
 * reporting NO inset are no longer the ones paying for it.
 *
 * Not a second cap on top of the first — it REPLACES it, for the one panel
 * whose content is a list. The calendar's cells are already 44px, so its
 * `NATURAL_PANEL_HEIGHT` needs no touch variant and it passes the same ceiling
 * in both presentations.
 */
export const SHEET_MAX_PANEL_HEIGHT = 359;

/**
 * How much of the viewport a sheet may take at most.
 *
 * The remaining 15% is not decoration: it is the strip of scrim that says there
 * is a page behind this and that tapping it comes back. A sheet grown to the
 * full height is a full-screen takeover with no visible way out, which is the
 * shape this widget must not become — it is a field editor, not a route.
 *
 * Applied as a CAP, never as a height: a two-column 24-hour time picker and a
 * short month grid both stay at their natural size on a tall phone.
 */
const SHEET_VIEWPORT_FRACTION = 0.85;

/**
 * WHICH SHAPE THIS WIDGET TAKES — and the only place that question is asked.
 *
 * `useCoarsePointer` used to gate whether the popover rendered AT ALL; it now
 * decides how, here, and two more things elsewhere that the shell has no
 * business knowing (the fields' `readOnly`, the time panel's row height). Read
 * the hook's header for why a media query and never a viewport width: a 13"
 * laptop is fine-pointer at 1280px and an 11" tablet is coarse at the same
 * width, and it is the POINTER, not the room, that decides whether a 36px row
 * is a target or a coin toss.
 *
 * Exported because the panels need the same answer for their own row metrics,
 * and an exported hook is the only way for them to get it that cannot drift
 * from what the shell actually rendered.
 */
export function usePickerPresentation(): 'sheet' | 'anchored' {
  return useCoarsePointer() ? 'sheet' : 'anchored';
}

/**
 * THE SCROLLBAR NEEDS A LANE OF ITS OWN — the same defect `Modal` documents at
 * length, one level down.
 *
 * On macOS (and anywhere else the platform paints an OVERLAY scrollbar) the bar
 * takes no layout width and is drawn ON TOP of the rightmost ~12px of whatever
 * scrolls. In the time picker that was the minute digits and the moss fill
 * behind the selected row. `scrollbar-gutter: stable` is not the fix — it
 * reserves space only for a scrollbar that CONSUMES space, so it is a no-op in
 * exactly the case being reported.
 *
 * `Modal` carves the lane out of its own `p-6` with a `-mr-5 pr-4` pair — 20px
 * out, 16px back, so its body's content box does move, by the 4px that pair
 * does not return (see the block on that element; the mismatch is deliberate).
 * A picker column has `p-1` and nothing to carve from, so the space comes from
 * the other direction instead: the scrolling element gets this padding and its
 * column is widened by exactly the same amount. Better outcome for the same
 * budget — here the digits really do not move, and the scrollbar still has
 * somewhere to be.
 *
 * 12px, not `Modal`'s 16: that is the full width a macOS overlay scrollbar
 * occupies (a 7px bar inset ~2px), and a picker column is 56px wide, where
 * every extra pixel of gutter is a pixel of digit.
 */
export const SCROLL_GUTTER = 'pr-3';

/** {@link SCROLL_GUTTER} in pixels, for the column widths that pay for it. */
export const SCROLL_GUTTER_PX = 12;

/**
 * `option`'s top edge IN `list`'S OWN SCROLL COORDINATES — which is emphatically
 * not `option.offsetTop`, and believing it was is a shipped bug.
 *
 * `offsetTop` is measured against the nearest POSITIONED ancestor, and neither
 * scrolling element in this widget is positioned: `overflow-y-auto` does not
 * create a containing block, so the `<ul>` columns of `TimePickerPanel` and the
 * `role="grid"` of `DatePickerPanel` are both transparent to that walk and
 * `offsetParent` resolves all the way up to the PANEL — which is `position:
 * fixed` and therefore always positioned. Every row's `offsetTop` came back
 * inflated by whatever chrome sits above the scroller inside the panel, while
 * the `clientHeight` it was being centred against belonged to the scroller: a
 * constant +30 in the time picker (`p-1` plus the 26px column header — nearly a
 * whole 36px row) and +52 in the calendar (`p-1` plus the 48px month header —
 * more than a 44px week). The symptom was a centred minute sitting a row high,
 * and a day in week 4 computing a scroll target past the end of the grid, so
 * the clamp pinned the calendar to its bottom with the focused day tucked under
 * the sticky weekday row.
 *
 * WALKING THE CHAIN, rather than the two one-liners that also fix today's DOM
 * (`option.offsetTop - list.offsetTop`, or `relative` on both scrollers), for
 * one reason: those two are each other's opposite. Adding `relative` to a
 * column silently breaks the subtraction, and deleting it in a class cleanup
 * silently breaks the other — and "silently" is the word, because nothing in
 * either panel says the arithmetic in this file depends on its positioning. The
 * loop is correct whether the scroller is positioned, not positioned, or grows
 * a positioned wrapper in between, so there is no CSS edit that can quietly
 * un-fix it.
 */
function offsetWithin(list: HTMLElement, option: HTMLElement): number {
  let top = 0;
  let node: HTMLElement | null = option;
  while (node && node !== list) {
    top += node.offsetTop;
    const parent = node.offsetParent as HTMLElement | null;
    // The chain jumped straight PAST `list` (it is not positioned), so what has
    // accumulated so far is measured in the same box `list.offsetTop` is, and
    // the difference is the distance actually wanted. Also the jsdom path:
    // `offsetParent` is null there, which lands here on the first step.
    if (!parent || !list.contains(parent)) return top - list.offsetTop;
    node = parent;
  }
  return top;
}

/**
 * Scroll `option` into view INSIDE `list` — and inside nothing else.
 *
 * REPLACES `element.scrollIntoView({ block: 'center' })`, which is the right
 * call everywhere except here. `scrollIntoView` walks EVERY scrollable ancestor
 * and scrolls each one, and this panel is `position: fixed` in a portal: its
 * containing block is the viewport, so the ancestors it reaches are the
 * document and whatever the field happens to sit in. The shipped symptom was
 * the minute column of an `08:00` field opening on `02` — the selected row
 * scrolled out of sight — while the hour column beside it centred correctly,
 * because the two calls were fighting over the same ancestors in order.
 *
 * Writing `scrollTop` cannot touch an ancestor at all, and the clamp is the
 * other half of the fix: an option near the START of the list cannot be
 * centred (the ideal offset is negative) and one near the END cannot either, so
 * the column pins to that end WITH THE SELECTION STILL VISIBLE rather than
 * landing wherever the arithmetic fell. `00` and `59` are the two rows this
 * class of bug always hits.
 *
 * The offset is {@link offsetWithin}'s, NOT `option.offsetTop` — read that
 * function before touching this line, and before adding `relative` to either
 * scroller.
 */
export function centerInColumn(list: HTMLElement, option: HTMLElement): void {
  const ideal = offsetWithin(list, option) - (list.clientHeight - option.offsetHeight) / 2;
  const furthest = Math.max(list.scrollHeight - list.clientHeight, 0);
  list.scrollTop = Math.max(0, Math.min(ideal, furthest));
}

/**
 * Everything in the panel that can take focus, in DOM order.
 *
 * `tabIndex >= 0` rather than a `:not([tabindex="-1"])` selector because both
 * panels use a ROVING tabindex — 41 of the calendar's 42 day buttons, and 59 of
 * the 60 minute rows, are `tabIndex={-1}` and must not be Tab stops. A bare
 * `button` selector would have made Tab walk the whole month.
 */
function tabbablesIn(panel: HTMLElement): HTMLElement[] {
  return Array.from(
    panel.querySelectorAll<HTMLElement>('a[href],button,input,select,textarea,[tabindex]')
  ).filter((el) => !el.hasAttribute('disabled') && el.tabIndex >= 0);
}

/**
 * Put focus back where the dismiss just put it, after an outside click — a beat
 * later, and only if the click left it nowhere.
 *
 * `onDismiss` already focuses the trigger synchronously, and that is not
 * enough: the browser's OWN focus fixup for the same mousedown runs after every
 * handler on it. A click that lands on something focusable focuses that thing,
 * which is right — the user asked for it, and this function stays out of the
 * way. A click that lands on a modal's padding or a paragraph focuses NOTHING,
 * undoing the restore and leaving the keyboard back at the top of the document.
 * Re-asserting once the fixup has happened is the only ordering that satisfies
 * both.
 *
 * "LEFT IT NOWHERE" IS NOT THE SAME AS "LEFT IT ON `<body>`" — and the `body`
 * test alone made this function dead code exactly where it was written for.
 * Every call site of these fields is inside a `Modal`, whose panel is
 * `tabIndex={-1}` (and now this one is too): a click on the dialog's padding or
 * its heading has no focusable node under it, so the fixup parks on the DIALOG,
 * `active === document.body` is false, the re-assert stands down, and the
 * keyboard is left at the top of the dialog instead of on the field being
 * edited. What actually distinguishes the two cases is the TAB ORDER: a node
 * the fixup fell back to is `tabIndex < 0` (`document.body` included, at -1),
 * while anything the user genuinely clicked into — a button, an input, the
 * modal's own scrollable region at `tabIndex={0}` — is 0 or more and is still
 * left strictly alone.
 *
 * AND `target` IS NOT ALWAYS THE TRIGGER — hard-coding it there silently
 * defeated the fields' `openedFromInput`. Alt+ArrowDown is the INPUT's native
 * picker opener, intercepted and routed to this popover, and `onDismiss` puts
 * focus back in the input for it; the fixup then parks on the `tabIndex={-1}`
 * panel, this function reads that as "nobody claimed focus" — correctly — and
 * used to move focus to the trigger anyway, i.e. to the exact control the
 * field had just decided against. Escape covered the ref and the outside click
 * quietly undid it.
 *
 * The element is READ OFF `document.activeElement` immediately after
 * `onDismiss` rather than taken as a prop, because this shell has no route to
 * one: `PickerPopover` is rendered by the two lazily-loaded panels, so a new
 * prop would have to be threaded through both of them to reach the fields that
 * actually own the answer. `onDismiss` focuses SYNCHRONOUSLY (both fields do,
 * deliberately — see their `handleDismiss`), so the active element on the next
 * line IS the field's answer, and taking it there needs nothing from anyone.
 *
 * Deliberately NOT cancelled when the popover unmounts: the popover unmounting
 * is the whole reason this is running. It self-guards on a target that is
 * still in the document instead.
 */
function reassertFocus(target: HTMLElement | null): void {
  // `<body>` is what a dismiss that focused NOTHING leaves behind, and calling
  // `focus()` on it would be a no-op dressed up as a restore.
  if (!target || target === document.body) return;
  window.setTimeout(() => {
    const active = document.activeElement as HTMLElement | null;
    if (!target.isConnected) return;
    if ((active?.tabIndex ?? -1) < 0) target.focus();
  }, 0);
}

interface PanelPosition {
  /** `null` in sheet mode: CSS pins that panel, and an inline coordinate would fight it. */
  top: number | null;
  left: number | null;
  maxHeight: number;
}

export interface PickerPopoverProps {
  /** The panel's DOM id — the trigger's `aria-controls` while open. */
  id: string;
  /** The dialog's accessible name. */
  label: string;
  /** The bordered field shell. The panel anchors to it. */
  anchorRef: RefObject<HTMLElement | null>;
  /** `useMenu`'s `menuRef`, so its outside-click test sees the portalled panel. */
  panelRef: RefObject<HTMLDivElement>;
  /** `useMenu`'s `buttonRef` — the one click target that is not "outside". */
  triggerRef: RefObject<HTMLButtonElement>;
  /** Close the popover and return focus to the trigger. */
  onDismiss: () => void;
  /**
   * The shortest this panel may be squeezed to before a cap stops being
   * containment and starts being breakage — its chrome plus one usable row.
   * Same floor, and the same reasoning, as `MoreMenu`'s `MIN_USABLE_PANEL`.
   */
  minHeight: number;
  /**
   * This panel's own ceiling, when {@link MAX_PANEL_HEIGHT} is the wrong shape
   * for its content. Raises (or lowers) only the appetite cap — the room on the
   * chosen side still wins over it, and `minHeight` still wins over that.
   */
  maxHeight?: number;
  /**
   * Panel-specific box classes — its width, mostly. ANCHORED ONLY: a sheet is
   * as wide as the viewport by construction, and a declared width beats
   * `inset-x-0` rather than being widened by it.
   */
  className?: string;
  /**
   * Run once the panel is in the DOM, measured and CLAMPED, before paint.
   *
   * The panels' own open-time work (centre the columns on the value, focus the
   * selected day) reads `clientHeight`, which is meaningless until the cap
   * computed below is actually applied — and a `useEffect` in the panel is not
   * ordered against that second commit. This is.
   */
  onPositioned?: () => void;
  children: ReactNode;
}

export function PickerPopover({
  id,
  label,
  anchorRef,
  panelRef,
  triggerRef,
  onDismiss,
  minHeight,
  maxHeight = MAX_PANEL_HEIGHT,
  className,
  onPositioned,
  children,
}: PickerPopoverProps): ReactElement | null {
  const sheet = usePickerPresentation() === 'sheet';
  const [position, setPosition] = useState<PanelPosition | null>(null);
  /**
   * The panel's height with NO cap on it, measured once.
   *
   * Re-measuring `offsetHeight` on every reposition reads back the CLAMPED
   * height, so a panel capped to 300px then reports that it "fits" in 300px of
   * room and gets capped to 300 again, then to whatever the next scroll event
   * offers — a ratchet that shrinks the picker a little on every scroll of the
   * modal behind it and never grows back. The natural height is a property of
   * the content, so it is measured before any cap exists and kept.
   */
  const naturalHeight = useRef<number | null>(null);
  const positioned = useRef(false);
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;
  const onPositionedRef = useRef(onPositioned);
  onPositionedRef.current = onPositioned;

  /**
   * Anchor the panel to the field, choosing a side and then living within it.
   *
   * Below is the default and wins whenever the panel fits there; above only
   * when it actually fits above; otherwise the roomier side — and then the cap
   * is the room on that side, never the panel's own appetite. "Below" ends at
   * {@link bottomLimitFor}, not at the window: a dialog footer is a band of
   * buttons this panel must not cover.
   *
   * The last two steps exist for the case no cap can satisfy — when neither
   * side can hold `minHeight`, so the panel is taller than anywhere to put it.
   * It is then slid up until its BOTTOM clears the floor (accepting an overlap
   * with its own field, the long-standing trade here) and only then, if the
   * band is shorter than the minimum itself, cut below `minHeight`. In that
   * order: shrinking is the worse outcome and goes last.
   *
   * The ceiling is applied BEFORE a side is chosen, deliberately: a panel cut
   * to 288px fits below fields that could never have held its natural 470, so
   * the ceiling decides which way it flips as well as how tall it ends up.
   * Every cap below is therefore reading an appetite that is already honest.
   */
  const reposition = useCallback((): void => {
    const anchorEl = anchorRef.current;
    const panel = panelRef.current;
    if (!anchorEl || !panel) return;
    if (naturalHeight.current === null) naturalHeight.current = panel.offsetHeight;
    const height = Math.min(naturalHeight.current, maxHeight);
    // THE SHEET HAS NOTHING TO ANCHOR TO, and that is the point of it: its box
    // is the viewport's bottom edge and its full width, both written in CSS,
    // so the only number this shell still owes it is the height budget. It
    // reads NO rect — not the anchor's, not the footer's — which is also why
    // the scroll listener below costs a sheet nothing: there is no measurement
    // for a scroll to invalidate.
    if (sheet) {
      setPosition({
        top: null,
        left: null,
        // The viewport cap wins over the ceiling for the same reason it does in
        // the anchored branch: below `minHeight` is a bad panel, past the edge
        // is no panel. `minHeight` is deliberately NOT a floor here — a sheet
        // taller than the window it is pinned to has no scroll that can reach
        // its bottom rows.
        maxHeight: Math.max(Math.min(height, window.innerHeight * SHEET_VIEWPORT_FRACTION), 0),
      });
      return;
    }
    const width = panel.offsetWidth;
    const rect = anchorEl.getBoundingClientRect();
    const bottomLimit = bottomLimitFor(anchorEl);
    const roomBelow = Math.max(bottomLimit - rect.bottom - ANCHOR_GAP - EDGE_GUTTER, 0);
    const roomAbove = Math.max(rect.top - ANCHOR_GAP - EDGE_GUTTER, 0);
    const up = height <= roomBelow ? false : height <= roomAbove ? true : roomAbove > roomBelow;
    const room = up ? roomAbove : roomBelow;
    // `capped`, not `maxHeight`: the prop of that name is the ceiling going IN,
    // and this is the height coming out of every cap there is.
    const capped = Math.max(Math.min(height, room), minHeight);
    // NO EDGE CLAMP ON THIS ONE — the `Math.max(..., EDGE_GUTTER)` on `top`
    // below already is it, in both branches and for every input. Where
    // `preferred >= EDGE_GUTTER` a clamp here is the identity; where it is
    // less, `Math.min` can only take it lower, so the outer `Math.max` returns
    // `EDGE_GUTTER` regardless. Two expressions of one guarantee is how the
    // two drift apart in a later edit, and the outer one is the load-bearing
    // copy: it is what the `up` and `down` branches, and the floor-slide
    // between them, all pass through.
    const preferred = up ? rect.top - ANCHOR_GAP - capped : rect.bottom + ANCHOR_GAP;
    // THEN SLIDE IT UP OFF THE FLOOR. The cap above cannot always do this on its
    // own: `minHeight` is a floor under it, so a panel that does not fit in the
    // room left above the footer keeps its minimum height and simply hangs over
    // the footer from `rect.bottom`. Shifting the whole panel up costs an
    // overlap with its own field — which this shell already accepts as the
    // lesser evil when neither side has room — and buys back the buttons.
    const top = Math.max(Math.min(preferred, bottomLimit - EDGE_GUTTER - capped), EDGE_GUTTER);
    setPosition({
      top,
      // Left-aligned with the field, then pulled back inside the viewport — the
      // right-hand field of a two-column form row sits close enough to the edge
      // that a 300px calendar would otherwise hang off it.
      left: Math.max(Math.min(rect.left, window.innerWidth - width - EDGE_GUTTER), EDGE_GUTTER),
      // NO `minHeight` FLOOR ON THIS ONE, and that asymmetry with `capped` is
      // the fix, not an oversight. `minHeight` is the floor under a CAP — it
      // stops the room on the chosen side squeezing a panel into rubble. Used
      // again HERE it outranked the viewport instead, so a band shorter than
      // the minimum produced a panel taller than the band: at 400% zoom the
      // calendar's Clear and Today sat ~38 of their 44px below the fold, and a
      // `fixed` panel has no scroll that can reach them. Below `minHeight` is a
      // bad panel; past the edge is no panel.
      maxHeight: Math.max(Math.min(capped, bottomLimit - top - EDGE_GUTTER), 0),
    });
  }, [anchorRef, panelRef, minHeight, maxHeight, sheet]);

  // Measured after the panel is in the DOM but before paint, so it never
  // renders in the wrong place for a frame.
  useLayoutEffect(() => {
    reposition();
  }, [reposition]);

  // The second commit: `position` is now in the DOM, so the panel's scrolling
  // region finally has a real `clientHeight` for the panel to work against.
  useLayoutEffect(() => {
    if (!position || positioned.current) return;
    positioned.current = true;
    onPositionedRef.current?.();
  }, [position]);

  // A fixed box does not move with a scrolling ancestor, and the ancestor here
  // is a modal body people scroll WHILE the picker is open. `capture: true` is
  // required: scroll does not bubble, so a listener on `document` only hears it
  // during the capture phase.
  //
  // AND THAT IS ALSO WHY THE PANEL HAS TO EXCLUDE ITSELF. Capturing on
  // `document` hears scroll from EVERY element, and the two things this widget
  // is made of — three 60-row columns and a six-week grid — are scrollers. Left
  // unfiltered, every wheel tick inside the minute column re-ran `reposition`
  // for a field that had not moved: an `anchorEl.getBoundingClientRect()` plus
  // `bottomLimitFor`'s `closest()` + `querySelector()` + a second rect, so two
  // forced reflows per event, during a drag. It was not only a drag, either —
  // `onPositioned` centres three columns by writing `scrollTop`, and each of
  // those writes is a scroll event, so opening the popover paid for it three
  // times before anything was touched. The panel's own scrolling never moves
  // the anchor, by construction: it is `fixed`, in a portal, with no layout
  // relationship to the field at all.
  useEffect(() => {
    const onResize = (): void => reposition();
    const onScroll = (event: Event): void => {
      // `instanceof Node` before `contains`: a scroll event's target can be
      // `document` (that is what the page itself scrolling reports), which
      // `Node.contains` refuses.
      const target = event.target;
      if (target instanceof Node && panelRef.current?.contains(target)) return;
      reposition();
    };
    window.addEventListener('resize', onResize);
    document.addEventListener('scroll', onScroll, true);
    return () => {
      window.removeEventListener('resize', onResize);
      document.removeEventListener('scroll', onScroll, true);
    };
  }, [reposition, panelRef]);

  /**
   * A SHEET IS MODAL, SO THE PAGE UNDER IT STOPS SCROLLING.
   *
   * Without this the scrim is a window onto a document that still moves: a drag
   * that starts on the scrim, or one that runs past the end of the sheet's own
   * `overscroll-contain` scroller, scrolls the form behind it — so the user
   * dismisses the sheet and finds the field they were editing somewhere else.
   * The anchored panel wants none of this (it is a dropdown; the page carries
   * on, and the `scroll` listener above is what keeps it attached).
   *
   * SAVE-AND-RESTORE RATHER THAN CLEAR, which is what makes it safe to nest:
   * every call site of these fields is inside a `Modal`, which has already set
   * `hidden` and will restore its own previous value when it closes. Writing
   * `''` on the way out would unlock the page underneath a dialog that is still
   * open.
   */
  useEffect(() => {
    if (!sheet) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [sheet]);

  // The focus-restoring half of the outside click (see the module comment).
  // Subscribed once, through a ref, because `onDismiss` is an inline arrow at
  // both call sites and re-subscribing on every pick would be noise.
  useEffect(() => {
    const onMouseDown = (event: MouseEvent): void => {
      const target = event.target as Node;
      if (panelRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      onDismissRef.current();
      // Whatever the dismiss just focused — the trigger, or the input when the
      // field's `openedFromInput` says the keyboard opened this. Read here and
      // not later: by the time the deferred check runs, the browser's own
      // fixup for this same mousedown has already overwritten it.
      reassertFocus(document.activeElement as HTMLElement | null);
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [panelRef, triggerRef]);

  /**
   * The two keys the panels do NOT own (see the module comment on why they must
   * not reach `Modal`).
   *
   * Tab cycles inside the panel rather than leaving it: the popover is a
   * `dialog` and the way out is Escape or a pick, both of which restore focus
   * to the trigger. With a roving tabindex on either side of this, the cycle is
   * the time picker's three columns or the calendar's chrome plus its one
   * focused day — which is exactly the stop list each panel wants, without
   * either of them writing a Tab handler.
   *
   * AND THAT CYCLE IS LOAD-BEARING FOR WCAG 2.2 §2.4.11 — DO NOT "SIMPLIFY" IT.
   * Focus Not Obscured passes here by CONTAINMENT, not by placement: the panel
   * really does cover the dialog's Cancel and submit buttons in some geometries
   * (see {@link bottomLimitFor} for the mouse half of that same defect), and it
   * is compliant purely because keyboard focus cannot reach them while it is
   * open. Letting Tab fall through — or leaning on `useMenu`'s "close on Tab",
   * which is the obvious-looking simplification — moves focus UNDER the panel
   * and breaks 2.2 AA the same day, with no visual symptom to notice. Pinned by
   * "picker tab containment (WCAG 2.2 §2.4.11)" in
   * `__tests__/pickerPopover.test.tsx`, which Tabs `PRESSES` times in both
   * directions and asserts focus never leaves this subtree.
   */
  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onDismissRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      event.preventDefault();
      event.stopPropagation();
      const panel = panelRef.current;
      if (!panel) return;
      const stops = tabbablesIn(panel);
      if (stops.length === 0) return;
      const at = stops.indexOf(document.activeElement as HTMLElement);
      const next = event.shiftKey
        ? at <= 0
          ? stops.length - 1
          : at - 1
        : at === -1 || at === stops.length - 1
          ? 0
          : at + 1;
      stops[next]?.focus();
    },
    [panelRef]
  );

  if (typeof document === 'undefined') return null;

  /**
   * The box, in one of its two shapes.
   *
   * `fixed` and the flex column are the whole of what the two share — the
   * anchored panel is a bordered card placed by `reposition`, the sheet is a
   * full-bleed surface pinned to the floor with only its top corners rounded
   * and its bottom border dropped (there is no edge down there to draw). The
   * sheet sits one layer ABOVE its own scrim; the anchored panel has no scrim
   * and stays where it has always been, immediately over `Modal`'s `z-50`.
   *
   * ── AND THEY DO NOT SHARE A PADDING, WHICH THEY USED TO ──────────────────
   *
   * The sheet inherited `p-1` from the panel it was forked out of, and 4px is
   * the RIGHT number for exactly one of the two boxes. Anchored it is a
   * hairline ring holding a bordered 328px card off its own content, where the
   * border is the edge the eye reads and padding is only what keeps a day cell
   * from touching it. A sheet has no side borders and is AS WIDE AS THE PHONE:
   * the same 4px put the weekday header and the month grid ~4px from the glass
   * on both sides and the Clear/Today row hard against the bottom, which reads
   * as a layout that overflowed rather than one that was placed.
   *
   * So `px-4`, off the same scale `Sheet`'s own rows use (`px-4 py-3`): 16px of
   * side gutter is the house's mobile margin. It costs 32px of the width the
   * calendar's seven `flex-1` columns divide, which is why
   * `e2e/picker-geometry.spec.ts` measures the narrowest day cell at 320px
   * against WCAG 2.2 §2.5.8 rather than trusting that it is fine: this padding
   * is exactly the kind of change that takes a target under 24px.
   *
   * ── AND WHY THE VERTICAL HALF IS BEHIND A MEDIA QUERY ────────────────────
   *
   * THE SIDE GUTTERS ARE FREE AND THE TOP AND BOTTOM ARE NOT, which is the one
   * asymmetry in this box worth a paragraph. A sheet is as wide as the viewport
   * whatever its padding; its HEIGHT is capped at
   * {@link SHEET_VIEWPORT_FRACTION} of the viewport, so every pixel of vertical
   * padding is taken from the scrolling grid in the middle rather than from the
   * screen.
   *
   * MEASURED, at the 390x360 keyboard-up viewport the geometry spec pins: the
   * cap is 306px, and the chrome that is NOT padding — one border, the 48px
   * month header, the 49px Clear/Today row — is 98 of it. Four 44px week rows
   * plus the grid's 22px sticky weekday strip need 198 more. That leaves TEN
   * pixels for vertical padding, against the eight this box already had. 12px
   * top and bottom does not make that viewport a little tighter; it costs a
   * WEEK ROW, and the sheet presentation exists precisely because the anchored
   * panel showed about 1.5 of 6 there.
   *
   * So the comfortable vertical padding is gated on a viewport with the height
   * to spend on it, and the keyboard-up case keeps the 4px it had. 500px is
   * chosen to sit above the keyboard-up viewport (360) and below the shortest
   * one the app claims to support with a keyboard down (568, an iPhone SE) —
   * i.e. every real phone gets the comfortable pair and only the squeezed case
   * does not. It is the same trade the geometry spec already makes out loud
   * when it explains why the day cells were NOT shrunk to fit: at a viewport
   * this short, content wins over margin.
   *
   * THE BOTTOM IS A `max()` OF TWO DIFFERENT ANSWERS TO TWO DIFFERENT
   * QUESTIONS, at both sizes. `env(safe-area-inset-bottom)` is the home
   * indicator on an iPhone — without it the sheet's last row sits under the
   * system's own gesture strip, where a tap is a swipe up to the app switcher.
   * But that inset is 0 on Android, on desktop emulation, and on every iPhone
   * with a home button, and the floor under it was `0.25rem` everywhere — i.e.
   * the devices with no system furniture to clear got 4px and nothing else.
   * The floor is the DESIGN's bottom margin and the inset is the HARDWARE's;
   * 0.75rem matches `pt-3` at the top, and the inset still wins wherever it is
   * larger.
   *
   * The tall pair is load-bearing beyond the look: `pt-3` and that 0.75rem
   * floor are two of the terms in {@link SHEET_MAX_PANEL_HEIGHT}'s seven-row
   * arithmetic, and `src/__tests__/bans/pickerRowHeight.test.ts` reads them
   * straight out of this string so that changing one here without the other is
   * a named failure rather than a ceiling that silently becomes six rows and a
   * sliver. The ceiling is built from the TALL pair on purpose: an appetite cap
   * only ever binds where the panel had room to reach it, and a viewport short
   * enough to select the 4px branch is capped by the viewport long before.
   */
  const box = sheet
    ? `fixed inset-x-0 bottom-0 z-[61] flex flex-col overflow-hidden rounded-t-2xl border-t border-line-2 bg-cream px-4 pt-1 pb-[max(0.25rem,env(safe-area-inset-bottom))] [@media(min-height:500px)]:pt-3 [@media(min-height:500px)]:pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-xl animate-[sheet-in_240ms_var(--ease-spring)] motion-reduce:animate-none`
    : `fixed z-[60] flex flex-col overflow-hidden rounded-xl border border-line-2 bg-cream p-1 shadow-lg animate-[modal-in_200ms_var(--ease-spring)] motion-reduce:animate-none`;

  return createPortal(
    <>
      {sheet ? (
        // THE SURFACE THE INTERCEPTED TAPS LAND ON. `aria-hidden` and no
        // handler of its own: dismissal already runs off the document-level
        // `mousedown` above (which is where the focus restore lives too, and a
        // second path would have to repeat it), and a named region here would
        // be one more thing for a screen reader to walk past on the way to a
        // dialog that is already labelled. `touch-none` stops a drag on the
        // scrim from scrolling anything at all — the body lock covers the
        // document, this covers the scrim itself.
        <div
          data-picker-scrim
          aria-hidden="true"
          className="fixed inset-0 z-[60] touch-none bg-overlay animate-[fade-in_200ms_ease-out] motion-reduce:animate-none"
        />
      ) : null}
      <div
        ref={panelRef}
        id={id}
        role="dialog"
        aria-label={label}
        // `aria-modal` only in the sheet presentation, and only because it is
        // TRUE there: the scrim really does make everything behind it
        // inaccessible. Claiming it on the anchored dropdown — which leaves the
        // page fully operable with a mouse — would tell a screen reader to hide
        // a form the user can still click into.
        aria-modal={sheet ? true : undefined}
        // THE PANEL IS WHERE FOCUS FALLS WHEN A CLICK LANDS ON NOTHING — the
        // same `tabIndex={-1}` `Modal` puts on its own dialog panel, for the
        // same reason one level down. A click on this padding ring (`p-1`
        // anchored, the sheet's wider gutters), the time picker's
        // column-header strip or the calendar's weekday row has no
        // focusable node under it, so the browser's focus fixup parks on
        // `document.body` — and every key this shell owns is an `onKeyDown` on
        // THIS div, which a keydown on `body` never reaches. The shipped
        // symptom was Escape silently ceasing to dismiss the popover after one
        // click on its own chrome (one Tab recovered it, and nothing said so).
        // Not a Tab stop: `tabbablesIn` filters on `tabIndex >= 0`, so the
        // cycle below is unchanged.
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        // The panel's own width class is ANCHORED-ONLY: a sheet's width is the
        // viewport's, and `w-[20.5rem]` alongside `inset-x-0` does not widen to
        // meet it — the declared width wins and the "sheet" becomes a 328px
        // card wedged against the left edge.
        className={`${box}${!sheet && className ? ` ${className}` : ''}`}
        // The pre-measurement 0,0 is never PAINTED — `reposition` runs in a
        // layout effect, which React flushes after the DOM mutation and before
        // the browser paints. Deliberately not `visibility: hidden` until
        // measured, tempting as that is: a hidden element cannot take focus, and
        // the panels' open-focus work runs in the same frame.
        //
        // `undefined`, not `0`, in sheet mode: CSS owns those two edges there,
        // and an inline `top: 0` would stretch the panel from the ceiling to the
        // floor — an inline declaration outranks every class in the sheet.
        style={{
          top: position?.top ?? (sheet ? undefined : 0),
          left: position?.left ?? (sheet ? undefined : 0),
          maxHeight: position?.maxHeight,
        }}
      >
        {children}
      </div>
    </>,
    document.body
  );
}

/**
 * THE card every care item is drawn with on web — medication doses, the
 * medications roster, tasks and vitals readings.
 *
 * The mirror of mobile's `src/components/ui/careCard.ts`. Both platforms had the
 * same failure mode: each surface hand-wrote its own Tailwind classes, so the
 * same object looked different depending on which screen you opened. Today the
 * three web surfaces disagree on both radius and border token —
 * `rounded-xl border-line-2` on Today's Meds versus `rounded-2xl border-line`
 * on Tasks and Vitals — which is exactly how that drift starts.
 *
 * Rule (same as mobile): the LIST owns inset and gap; a card never carries its
 * own margin.
 */

/**
 * Card surface WITHOUT padding — radius, border, background.
 *
 * Split from the padded shell because some surfaces pad an inner wrapper
 * instead of the card itself (Tasks and Vitals both do, so their rows can put a
 * full-height swipe/hover affordance edge-to-edge). Those use the surface and
 * keep their own padding; everything else uses `careCardShell`.
 */
export const careCardSurface = 'rounded-2xl border border-line bg-cream';

/**
 * De-emphasized surface for an item that is still real but no longer active —
 * a discontinued medication.
 *
 * ONLY the fill differs. The web roster also swapped the border token
 * (`border-line-2` vs `border-line`), which made an inactive medication read as
 * a different kind of object rather than the same object in a quieter state.
 * Mobile's inactive card keeps the identical shell and border and changes just
 * the background; this is that.
 */
export const careCardSurfaceMuted = 'rounded-2xl border border-line bg-bg';

/** Card surface with the standard padding. Compose with a `<li>` or `<div>`. */
export const careCardShell = `${careCardSurface} p-4`;

/**
 * Title row: the name, then any type badge, then the status pinned to the end.
 *
 * `flex-wrap` so that at large browser zoom / small widths the badge and status
 * drop to a second line instead of crushing the title — the web counterpart of
 * mobile's Dynamic Type wrapping.
 */
export const careCardNameRow = 'flex flex-wrap items-center gap-1.5';

/**
 * Applied to the title itself. `min-w-0` + `truncate` let a long medication
 * name ellipsize rather than force the row wider; deliberately NO min-width,
 * which on mobile padded short names out and pushed the badge away from them.
 */
export const careCardTitle = 'min-w-0 flex-1 truncate text-sm font-medium leading-snug';

/** Pins the status to the end of the title row so a column of them lines up. */
export const careCardStatusPush = 'ml-auto shrink-0';

/** Meta line beneath the title — pure item data (time · dosage). */
export const careCardMeta = 'mt-1 flex flex-wrap items-center gap-1 text-xs text-ink-3';

/** Action area: compact and right-aligned, matching mobile's Skip/Take/Done. */
export const careCardActions = 'mt-2 flex justify-end gap-2';

/** Vertical gap between stacked cards, owned by the list. */
export const careCardListGap = 'space-y-3';

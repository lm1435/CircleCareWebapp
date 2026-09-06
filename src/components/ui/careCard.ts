/**
 * THE card every care item is drawn with on web — medication doses, the
 * medications roster, tasks and vitals readings.
 *
 * The mirror of mobile's `src/components/ui/careCard.ts`, copied NUMERICALLY:
 * 14px padding, 1.5px border, 20px radius, 12px gap between the leading
 * element and the text column. Just like mobile, the LIST owns inset (20)
 * and gap (12); a card never carries its own margin.
 *
 * Today's failure mode (before this file) was three web surfaces disagreeing
 * on both radius and border token — `rounded-xl border-line-2` on Today's
 * Meds versus `rounded-2xl border-line` on Tasks and Vitals — which is
 * exactly how that drift starts. Mobile settled on `border-line-2` / r20
 * padding-14, so that is what every export below produces.
 */

/**
 * Card surface WITHOUT padding — radius, border, background.
 *
 * Split from the padded shell because some surfaces pad an inner wrapper
 * instead of the card itself (Tasks and Vitals both do, so their rows can put
 * a full-height swipe/hover affordance edge-to-edge). Those use the surface
 * and keep their own padding; everything else uses `careCardShell`.
 */
export const careCardSurface = 'bg-cream rounded-xl border-[1.5px] border-line-2';

/**
 * De-emphasized surface for an item that is still real but no longer active —
 * a discontinued medication. ONLY the fill differs from `careCardSurface`,
 * matching mobile: the shell and border stay identical so an inactive item
 * reads as the same kind of object in a quieter state, not a different one.
 */
export const careCardSurfaceMuted = 'bg-bg rounded-xl border-[1.5px] border-line-2';

/**
 * Card surface with the standard padding (14px) plus container-query
 * containment, so a card's own action row can react to ITS width rather than
 * the viewport's (see `careCardActionsInline` / `careCardActionsRow`).
 */
export const careCardShell = `${careCardSurface} p-3.5 [container-type:inline-size]`;

/** Top row: the leading element (circle/checkbox), then the text column. 12px gap. */
export const careCardTopRow = 'flex items-start gap-3';

/** Leading circular element (status circle / checkbox) — 22x22, 1.5px border. */
export const careCardLeading =
  'w-[22px] h-[22px] rounded-full border-[1.5px] shrink-0 inline-flex items-center justify-center';

/** The item name/title. 16/500, no truncation — mobile wraps long names rather than cutting them. */
export const careCardTitle = 'text-md font-medium leading-snug text-ink';

/** Row beneath the title carrying the type badge and the status pill. Wraps, gap 6, margin-top 2. */
export const careCardBadgeRow = 'mt-0.5 flex flex-wrap items-center gap-1.5';

/**
 * Meta line beneath the title — pure item data (time · dosage). 12/400 ink-2
 * with a 20px line box per piece, so a dose ("8:00 AM · 500mg") and an
 * appointment ("10:00 AM") sit at the same card height regardless of which
 * piece is tallest.
 */
export const careCardMeta = 'mt-0.5 flex flex-wrap items-center gap-1 text-xs text-ink-2 [&>*]:leading-[20px]';

/** Same size as the meta time, heavier — the dosage/detail piece of the meta line. */
export const careCardMetaDetail = 'font-medium';

/** The status pill shell — Overdue / Upcoming / Due soon / Taken / Skipped all share it. Compose with `STATUS_PILL`. */
export const careCardStatusPill =
  'inline-flex items-center gap-1 rounded-full px-2 py-[3px] text-xs leading-[17px] max-w-full';

/**
 * Action pills placed INLINE at the trailing end of the meta row at default
 * card width — hidden once the card's own content-box narrows below 360px
 * (container query on `careCardShell`'s `[container-type:inline-size]`),
 * where `careCardActionsRow` takes over as the stacked fallback.
 */
export const careCardActionsInline = 'ml-auto flex items-center gap-1 @max-[360px]:hidden';

/** Stacked, right-aligned action row — shown only when the card's own width can't fit the inline actions. */
export const careCardActionsRow = 'mt-2 hidden items-center justify-end gap-1 @max-[360px]:flex';

/** Shared action pill: min-height 44, min-width 88, padding 8/18, r-full, text 14/600. */
export const careCardActionBtn =
  'inline-flex items-center justify-center min-h-[44px] min-w-[88px] px-[18px] py-2 rounded-full gap-1.5 text-sm font-semibold transition-transform duration-fast ease-spring active:scale-[0.97]';

/** Primary action pill (e.g. Take, Done) — moss fill, cream text. */
export const careCardActionPrimary = `${careCardActionBtn} bg-moss text-cream`;

/** Secondary action pill (e.g. Skip) — bg-2 fill, ink-2 text. */
export const careCardActionSecondary = `${careCardActionBtn} bg-bg-2 text-ink-2`;

/** Bare-label action (no fill) — a lesser, secondary-of-secondary action. */
export const careCardActionText = 'inline-flex items-center justify-center min-h-[44px] px-3 text-sm font-semibold text-ink-2';

/** Vertical gap between stacked cards, owned by the list. 12px. */
export const careCardListGap = 'flex flex-col gap-3';

/**
 * Status pill tones. Every value STARTS WITH `careCardStatusPill` so a
 * consumer can grep/verify the shell is always present, then layers the
 * tone's background + text on top.
 */
export const STATUS_PILL = {
  upcoming: `${careCardStatusPill} bg-moss-soft text-moss`,
  dueSoon: `${careCardStatusPill} bg-clay-soft text-clay`,
  overdue: `${careCardStatusPill} bg-terracotta-soft text-terracotta-deep`,
  taken: `${careCardStatusPill} bg-moss-soft text-moss-deep font-semibold`,
  skipped: `${careCardStatusPill} bg-line-2 text-ink-2`,
  inactive: `${careCardStatusPill} bg-line-2 text-ink-2`,
} as const;

// ── Backward-compatible aliases for existing importers ─────────────────────
// `TodaysMeds.tsx` imports `careCardNameRow`, `careCardStatusPush` and
// `careCardActions`; `TaskRow.tsx` imports `careCardActions` only.
// (`VitalsPage.tsx` and `MedicationsPage.tsx` import neither — they only use
// `careCardSurface`, unaffected by this block.) Neither has migrated to the
// new inline/stacked action split above (that migration is a later task), so
// these names stay exported and keep those two files behaving the way they
// do today.
//
// `careCardActions` in particular cannot simply become an alias of
// `careCardActionsRow`: that class is `hidden` by default and only turns on
// (`flex`) once its `[container-type:inline-size]` ancestor's content-box
// narrows below 360px. `TodaysMeds.tsx` DOES render inside such an ancestor
// (its `<li>` uses `careCardShell`, which carries `[container-type:inline-
// size]`) but only renders the ONE action slot — never the inline
// (`careCardActionsInline`) counterpart alongside it — so at every width
// above 360px both would be invisible and the Skip/Take pair would vanish at
// normal card widths. `TaskRow.tsx` renders inside `careCardSurface`, which
// carries no container-type at all, so the same alias would hide its Done
// button unconditionally. Remove this block once each caller renders BOTH
// `careCardActionsInline` and `careCardActionsRow` (planned Task 24).
export const careCardNameRow = careCardTopRow;
export const careCardStatusPush = 'ml-auto shrink-0';
/**
 * NOT an alias of `careCardActionsRow` — see the block comment above. This
 * keeps the OLD always-visible layout (never `hidden`) so today's callers
 * keep showing their action pills; only the gap is updated to the new 4px
 * (`gap-1`) figure since that carries no visibility risk.
 */
export const careCardActions = 'mt-2 flex items-center justify-end gap-1';

import { useCallback, useMemo, useState, type ReactElement, type ReactNode } from 'react';

export interface AccordionProps {
  /**
   * Stable id for this section. Used to wire `aria-controls`/`aria-labelledby`
   * AND as the key passed to `onToggle` so a page-level group can track which
   * sections are open.
   */
  id: string;
  /** Header label — rendered with the `.section-title` treatment so it reads as a title. */
  title: ReactNode;
  /** Controlled open state. */
  open: boolean;
  /** Called with this section's `id` when the header is activated. */
  onToggle: (id: string) => void;
  /** Optional right-aligned header slot (e.g. a count). Hidden from the title link semantics. */
  meta?: ReactNode;
  children: ReactNode;
}

/**
 * Accessible disclosure section (controlled).
 *
 * a11y: the header is a real `<button>` with `aria-expanded` + `aria-controls`;
 * the panel is `role="region"` + `aria-labelledby` pointing back at the header.
 *
 * PRINT + MOUNT: the panel is ALWAYS mounted (children never unmount) so its
 * content stays in the DOM for screen readers/tests. Collapse is visual only —
 * `open ? 'block' : 'hidden'` PLUS `print:block`, so `@media print` reveals a
 * collapsed panel. The chevron is `print:hidden`. This needs no globals.css
 * change for print; the global prefers-reduced-motion block already neutralizes
 * the chevron transition.
 */
export function Accordion({
  id,
  title,
  open,
  onToggle,
  meta,
  children,
}: AccordionProps): ReactElement {
  const headerId = `${id}-accordion-header`;
  const titleId = `${id}-accordion-title`;
  const panelId = `${id}-accordion-panel`;

  return (
    <section className="scroll-mt-28" id={id}>
      <h2 className="m-0">
        <button
          type="button"
          id={headerId}
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => onToggle(id)}
          className="flex w-full items-center gap-3 rounded-2xl px-1 py-2 text-left hover:text-ink"
        >
          <ChevronIcon open={open} />
          <span id={titleId} className="flex-1 text-lg font-semibold leading-snug text-ink">
            {title}
          </span>
          {meta != null && <span className="shrink-0 text-sm text-ink-3">{meta}</span>}
        </button>
      </h2>
      {/* Panel name comes from the title span ONLY (not the whole button), so the
          accessible region name excludes the chevron + meta count. */}
      <div
        id={panelId}
        role="region"
        aria-labelledby={titleId}
        className={`${open ? 'block' : 'hidden'} print:block pt-2`}
      >
        {/* Inner wrapper gives stacked panel items consistent vertical
            separation (e.g. multiple contact/doctor cards) instead of letting
            their borders touch. Single-child panels (a list with its own gap)
            are unaffected since the gap only applies between siblings. */}
        <div className="flex flex-col gap-4">{children}</div>
      </div>
    </section>
  );
}

function ChevronIcon({ open }: { open: boolean }): ReactElement {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width={16}
      height={16}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 text-ink-3 transition-transform duration-200 print:hidden ${
        open ? 'rotate-90' : 'rotate-0'
      }`}
    >
      <path d="M9 18l6-6-6-6" />
    </svg>
  );
}

export interface AccordionGroup {
  isOpen: (id: string) => boolean;
  toggle: (id: string) => void;
  expandAll: () => void;
  collapseAll: () => void;
  /** True when every id in the group is open. */
  allOpen: boolean;
  /** True when at least one id in the group is open. */
  anyOpen: boolean;
}

export interface UseAccordionGroupOptions {
  /** When true (default), every id starts expanded. */
  defaultOpen?: boolean;
}

// Internal "set everything" sentinels for the expand/collapse-all actions.
// Tracking the action rather than a snapshot of ids means ids that arrive
// AFTER an expandAll/collapseAll still honor the last bulk choice — and ids
// never seen before fall back to `defaultOpen`. This is what makes the hook
// safe for pages whose id set is async (e.g. Vitals groups load with data).
type GroupState = { mode: 'default' | 'all-open' | 'all-closed'; overrides: Set<string> };

/**
 * Page-level open/closed state for a set of accordion ids. Standardizes the
 * "Expand all / Collapse all" control.
 *
 * Resilient to a CHANGING `ids` array: an id's open state is derived from the
 * last bulk action (expand/collapse all) plus any per-id toggles since, falling
 * back to `defaultOpen` for ids never acted on. `allOpen` / `anyOpen` are
 * derived against the CURRENT `ids`.
 */
export function useAccordionGroup(
  ids: string[],
  opts: UseAccordionGroupOptions = {}
): AccordionGroup {
  const { defaultOpen = true } = opts;
  const [state, setState] = useState<GroupState>({ mode: 'default', overrides: new Set() });

  const resolve = useCallback(
    (id: string): boolean => {
      if (state.overrides.has(id)) return !baseOpen(state.mode, defaultOpen);
      return baseOpen(state.mode, defaultOpen);
    },
    [state, defaultOpen]
  );

  const isOpen = useCallback((id: string) => resolve(id), [resolve]);

  const toggle = useCallback((id: string) => {
    setState((prev) => {
      const overrides = new Set(prev.overrides);
      if (overrides.has(id)) overrides.delete(id);
      else overrides.add(id);
      return { ...prev, overrides };
    });
  }, []);

  const expandAll = useCallback(() => setState({ mode: 'all-open', overrides: new Set() }), []);
  const collapseAll = useCallback(() => setState({ mode: 'all-closed', overrides: new Set() }), []);

  const allOpen = useMemo(
    () => ids.length > 0 && ids.every((id) => resolve(id)),
    [ids, resolve]
  );
  const anyOpen = useMemo(() => ids.some((id) => resolve(id)), [ids, resolve]);

  return { isOpen, toggle, expandAll, collapseAll, allOpen, anyOpen };
}

/** Base open state for the current bulk mode (before per-id overrides). */
function baseOpen(mode: GroupState['mode'], defaultOpen: boolean): boolean {
  if (mode === 'all-open') return true;
  if (mode === 'all-closed') return false;
  return defaultOpen;
}

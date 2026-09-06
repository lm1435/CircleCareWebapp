import { useCallback, useMemo, useState, type ElementType, type ReactElement, type ReactNode } from 'react';
import { Icon } from './Icon';

export interface AccordionProps {
  /**
   * Stable id for this section. Used to wire `aria-controls`/`aria-labelledby`
   * AND as the key passed to `onToggle` so a page-level group can track which
   * sections are open.
   */
  id: string;
  /** Header label — rendered at the section-title weight/size so it reads as a title. */
  title: ReactNode;
  /** Controlled open state. */
  open: boolean;
  /** Called with this section's `id` when the header is activated. */
  onToggle: (id: string) => void;
  /** Optional right-aligned header slot (e.g. a count). Hidden from the title link semantics. */
  meta?: ReactNode;
  /**
   * The heading level wrapping this section's header button. Default `'h2'`
   * (unchanged behavior). Pass `'h3'` (or `'h4'`) for a NESTED accordion — e.g.
   * a per-question disclosure inside a per-section one — so heading navigation
   * reflects the real outline (section `h2` → question `h3`) instead of two
   * sibling `h2`s. Purely the wrapping tag; the visual title styling is
   * unchanged at every level.
   */
  headingAs?: 'h2' | 'h3' | 'h4';
  children: ReactNode;
}

/**
 * Accessible disclosure section (controlled).
 *
 * a11y: the header is a real `<button>` with `aria-expanded` + `aria-controls`;
 * the panel is `role="region"` + `aria-labelledby` pointing back at the header.
 *
 * PRINT + MOUNT: the panel is ALWAYS mounted (children never unmount) so its
 * content stays in the DOM for screen readers/tests. Collapse is visual only.
 *
 * The collapse ANIMATES with the grid trick: the panel is a one-column grid
 * whose single row goes `0fr` → `1fr`, with an `overflow-hidden min-h-0` inner
 * div. That is the only way to transition to a CONTENT-DERIVED height in CSS
 * (`height: auto` is not animatable and a hardcoded max-height either clips
 * long panels or makes short ones ease at the wrong speed) and it needs no JS
 * measurement. `print:[grid-template-rows:1fr]` keeps a collapsed panel on the
 * printed page, as `print:block` used to, and `inert` keeps the collapsed
 * panel's controls out of the tab order and the a11y tree the way the old
 * `display:none` did.
 */
export function Accordion({
  id,
  title,
  open,
  onToggle,
  meta,
  headingAs = 'h2',
  children,
}: AccordionProps): ReactElement {
  const headerId = `${id}-accordion-header`;
  const titleId = `${id}-accordion-title`;
  const panelId = `${id}-accordion-panel`;
  const Heading = headingAs as ElementType;

  return (
    <section className="scroll-mt-28" id={id}>
      <Heading className="m-0">
        <button
          type="button"
          id={headerId}
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => onToggle(id)}
          className="flex min-h-[44px] w-full items-center gap-3 rounded-2xl px-1 py-2 text-left hover:text-ink"
        >
          <Icon
            name="chevron-down"
            size="inline"
            className={`text-ink-3 transition-transform duration-normal ease-spring motion-reduce:transition-none print:hidden ${
              open ? 'rotate-180' : ''
            }`.trim()}
          />
          <span id={titleId} className="flex-1 text-lg font-semibold leading-snug text-ink">
            {title}
          </span>
          {meta != null && <span className="shrink-0 text-sm text-ink-3">{meta}</span>}
        </button>
      </Heading>
      {/* Panel name comes from the title span ONLY (not the whole button), so the
          accessible region name excludes the chevron + meta count. */}
      <div
        id={panelId}
        role="region"
        aria-labelledby={titleId}
        // A zero-height `overflow-hidden` panel is still FOCUSABLE — unlike the
        // `display:none` it replaced, the grid collapse leaves every link and
        // button inside it in the tab order, so a keyboard user tabs into a
        // section they just closed and lands on controls they cannot see.
        // `inert` restores what `hidden` gave for free (no focus, out of the
        // a11y tree) without removing the node from layout, so the panel still
        // animates and still prints.
        //
        // @types/react is 18.3.31, which predates `inert` in the JSX intrinsics
        // (React 19's types have it), hence the spread. The value is the empty
        // string rather than `true` because React 18 stringifies an unknown
        // boolean prop to `inert="false"` — which is still inert, per HTML's
        // boolean-attribute rules, and would collapse the open state too.
        {...(open ? {} : ({ inert: '' } as Record<string, string>))}
        className={`grid transition-[grid-template-rows] duration-normal ease-spring motion-reduce:transition-none print:[grid-template-rows:1fr] ${
          open ? '[grid-template-rows:1fr]' : '[grid-template-rows:0fr]'
        }`}
      >
        {/* `min-h-0` defeats the grid item's `auto` minimum, without which the
            row can never actually collapse to 0fr. */}
        <div className="overflow-hidden min-h-0">
          {/* Inner wrapper gives stacked panel items consistent vertical
              separation (e.g. multiple contact/doctor cards) instead of letting
              their borders touch. Single-child panels (a list with its own gap)
              are unaffected since the gap only applies between siblings. */}
          <div className="flex flex-col gap-4 pt-2">{children}</div>
        </div>
      </div>
    </section>
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

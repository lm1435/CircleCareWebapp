import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Analytics } from '@/lib/analytics';
import { Card } from '@/components/ui';

/** Most names listed; the rest collapse into one "+N more" line. */
export const SEEN_BY_LIST_CAP = 50;
/** An open must last this long before it counts as an "expanded" analytics event. */
export const SEEN_BY_OPEN_DWELL_MS = 300;
/** Grace period when the pointer leaves, so it can cross onto the popover. */
const LEAVE_DELAY_MS = 150;
const VIEWPORT_MARGIN = 8;

type SeenByTrigger = 'hover' | 'focus' | 'click';

interface SeenByCaptionProps {
  /** The caption sentence ("Seen by Maria, Luis and 3 others"): the button's visible label. */
  line: string;
  /** Every reader name, read order, nameless readers already replaced by the fallback. */
  names: string[];
}

/**
 * The "Seen by" caption for a note with 3+ readers: a real button that reveals the full reader
 * list on hover, keyboard focus and click/tap. Dismissible with Escape without moving focus,
 * hoverable, and persistent until dismissed (WCAG 1.4.13). Closes on blur, pointer leave (unless
 * pinned by a click) and click outside.
 */
export function SeenByCaption({ line, names }: SeenByCaptionProps): ReactElement {
  const { t } = useTranslation('notes');
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countRef = useRef(names.length);
  countRef.current = names.length;

  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [pinned, setPinned] = useState(false);
  // Escape / a second click closes even while still hovered or focused, until the next enter/focus.
  const [dismissed, setDismissed] = useState(false);
  const [shift, setShift] = useState(0);
  const open = !dismissed && (pinned || hovered || focused);

  const clearLeave = () => {
    if (leaveTimer.current) clearTimeout(leaveTimer.current);
    leaveTimer.current = null;
  };
  useEffect(() => clearLeave, []);

  const closeAll = useCallback(() => {
    setHovered(false);
    setFocused(false);
    setPinned(false);
  }, []);

  // Analytics: once per OPEN. Hover and focus count only after the dwell (a fly-by or a tab-through is
  // not a read); a click counts immediately. A click that pins an already-open popover reuses the open.
  const firedRef = useRef(false);
  const triggerRef = useRef<SeenByTrigger>('hover');
  const dwellTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fire = useCallback((trigger: SeenByTrigger) => {
    if (firedRef.current) return;
    firedRef.current = true;
    if (dwellTimer.current) clearTimeout(dwellTimer.current);
    dwellTimer.current = null;
    Analytics.careNoteSeenByExpanded({ readerCount: countRef.current, trigger });
  }, []);
  useEffect(() => {
    if (!open) return;
    if (!firedRef.current) {
      dwellTimer.current = setTimeout(() => fire(triggerRef.current), SEEN_BY_OPEN_DWELL_MS);
    }
    return () => {
      if (dwellTimer.current) clearTimeout(dwellTimer.current);
      dwellTimer.current = null;
      firedRef.current = false;
    };
  }, [open, fire]);
  const openRef = useRef(false);
  openRef.current = open;

  // Escape (without moving focus) and click/tap outside, only while open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setPinned(false);
      setDismissed(true);
    };
    const onPointerDown = (e: Event) => {
      if (rootRef.current && e.target instanceof Node && rootRef.current.contains(e.target)) return;
      closeAll();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [open, closeAll]);

  // Keep the popover inside the viewport (360 px wide phones): shift it left/right as needed.
  useLayoutEffect(() => {
    if (!open || !popRef.current) {
      setShift(0);
      return;
    }
    const el = popRef.current;
    el.style.transform = 'none';
    const rect = el.getBoundingClientRect();
    const vw = document.documentElement.clientWidth || window.innerWidth;
    let dx = 0;
    if (rect.right > vw - VIEWPORT_MARGIN) dx = vw - VIEWPORT_MARGIN - rect.right;
    if (rect.left + dx < VIEWPORT_MARGIN) dx = VIEWPORT_MARGIN - rect.left;
    el.style.transform = '';
    setShift(Math.round(dx));
  }, [open]);

  const enter = () => {
    clearLeave();
    if (!openRef.current) triggerRef.current = 'hover';
    setHovered(true);
    setDismissed(false);
  };
  const leave = () => {
    clearLeave();
    leaveTimer.current = setTimeout(() => setHovered(false), LEAVE_DELAY_MS);
  };

  const shown = names.slice(0, SEEN_BY_LIST_CAP);
  const extra = names.length - shown.length;

  return (
    <div
      ref={rootRef}
      className="relative mt-2 inline-block max-w-full"
      onMouseEnter={enter}
      onMouseLeave={leave}
      onBlur={(e) => {
        if (rootRef.current && e.relatedTarget instanceof Node && rootRef.current.contains(e.relatedTarget)) {
          return;
        }
        setFocused(false);
        setPinned(false);
      }}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-controls={listId}
        onFocus={() => {
          if (!openRef.current) triggerRef.current = 'focus';
          setFocused(true);
          setDismissed(false);
        }}
        onClick={() => {
          if (open && pinned) {
            setPinned(false);
            setDismissed(true);
          } else {
            fire('click');
            setPinned(true);
            setDismissed(false);
          }
        }}
        className="m-0 inline-flex min-h-6 max-w-full cursor-pointer items-center border-0 bg-transparent p-0 text-left text-xs text-ink-3"
      >
        {line}
      </button>
      {open && (
        <div
          ref={popRef}
          id={listId}
          role="group"
          aria-label={t('row.seenByListLabel')}
          style={shift ? { transform: `translateX(${shift}px)` } : undefined}
          // pt-1 is a transparent bridge so the pointer never leaves the hover area between button and list.
          className="absolute left-0 top-full z-30 w-max min-w-[min(180px,calc(100vw-16px))] max-w-[min(280px,calc(100vw-16px))] pt-1"
        >
          {/* The surface is the shared <Card> (spec §4.6: no hand-written card shell). */}
          <Card variant="outlined" padding="none" className="max-h-48 overflow-y-auto rounded-lg px-4 py-3 shadow-lg">
            <p aria-hidden="true" className="m-0 mb-1.5 text-xs text-ink-3">
              {t('row.seenByListLabel')}
            </p>
            <ul className="m-0 list-none p-0 text-xs text-ink-2">
              {shown.map((name, i) => (
                <li key={i} className="break-words py-0.5">
                  {name}
                </li>
              ))}
            </ul>
            {extra > 0 && (
              <p className="m-0 mt-1 text-xs text-ink-3">{t('row.seenByMore', { count: extra })}</p>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}

export default SeenByCaption;

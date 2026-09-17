import { useRef, type ReactElement } from 'react';
import { render, screen } from '@testing-library/react';
import '@/i18n';
import { COARSE_POINTER_QUERY } from '@/hooks/useCoarsePointer';
import { TimePickerPanel } from '../TimePickerPanel';

/**
 * THE ROW IS 36 ON A MOUSE AND 44 UNDER A FINGER.
 *
 * `ROW_HEIGHT = 36` was justified in its own comment by "the whole control
 * exists only on a pointer device (the field's own `<input type="time">` is
 * what a touch keyboard edits)". That premise is gone: the popover is now the
 * picker on every device, so the 44 this app gives every other touch target —
 * the house standard, and WCAG 2.5.5 Target Size (Enhanced), AAA — has to
 * apply to a column of sixty minutes too, where a mis-tap is a dose an hour out.
 *
 * 36 STAYS ON FINE POINTERS, and that is not timidity: twelve hour rows at 44
 * is a 562px panel, which is the "dropdown that is really a second dialog"
 * `MAX_PANEL_HEIGHT` exists to stop. A mouse does not need the 44 (`Modal`'s
 * `MODAL_FOOTER_CLASS` made the same call for the same reason), and the rows
 * are stacked rather than spaced, so the extra height buys no separation from a
 * neighbour a MOUSE would ever miss.
 *
 * Rendered rather than read off the source: the class is what paints, and the
 * source scan that keeps the class and the constants in step is a different
 * guard (`src/__tests__/bans/pickerRowHeight.test.ts`) answering a different
 * question. Pixels are Playwright's — jsdom reports every box as zero.
 */

vi.mock('@/hooks/useHourCycle', () => ({ useHourCycle: () => '12h' }));

function stubPointerClass(coarse: boolean): void {
  vi.stubGlobal('matchMedia', (query: string) => ({
    media: query || COARSE_POINTER_QUERY,
    matches: coarse,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

function Host(): ReactElement {
  const anchorRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  return (
    <div ref={anchorRef}>
      <button ref={triggerRef} type="button">
        Choose a time
      </button>
      <TimePickerPanel
        id="panel"
        anchorRef={anchorRef}
        panelRef={panelRef}
        triggerRef={triggerRef}
        value="08:30"
        onPick={vi.fn()}
        onDismiss={vi.fn()}
      />
    </div>
  );
}

/** Every distinct `min-h-[Npx]` the rendered rows carry. */
function rowHeights(): Set<string> {
  return new Set(
    screen
      .getAllByRole('option')
      .map((row) => /\bmin-h-\[(\d+)px\]/.exec(row.className)?.[1] ?? 'none')
  );
}

describe('time picker row height follows the pointer, not the design era', () => {
  it('gives every row 44px on a coarse pointer', () => {
    stubPointerClass(true);
    render(<Host />);
    // One answer for all 60+ rows: a column that sized only its selected row
    // would pass a spot check and ship 59 rows a finger cannot land on.
    expect(rowHeights()).toEqual(new Set(['44']));
  });

  it('keeps 36px on a fine pointer', () => {
    stubPointerClass(false);
    render(<Host />);
    expect(rowHeights()).toEqual(new Set(['36']));
  });
});

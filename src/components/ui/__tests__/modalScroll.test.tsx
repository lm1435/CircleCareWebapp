import { useState, type ReactElement } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { Modal } from '../Modal';

/**
 * Regression guard for `D-health.md` §9.2: a tall modal body was CLIPPED by the
 * panel's `overflow-hidden` instead of scrolling.
 *
 * The cause is a flexbox default, not a missing `overflow-y-auto`: a flex item's
 * `min-height` is `auto`, so it refuses to shrink below its content's height.
 * The body therefore grew past the panel's `max-h-[90vh]` and the overflow was
 * clipped by the panel rather than scrolled by the body. `min-h-0` is the part
 * that actually fixes it, so it is asserted alongside `flex-1`/`overflow-y-auto`
 * — dropping it silently reintroduces the bug in every browser while every
 * "does it scroll" style assertion still passes.
 */
function renderTallModal(onClose = vi.fn()) {
  render(
    <Modal title="Long form" onClose={onClose} closeLabel="Close dialog">
      <div style={{ height: 3000 }} data-testid="tall-content">
        Very tall body
      </div>
    </Modal>
  );
  return onClose;
}

/** The body wrapper is the panel child that holds the caller's children. */
function bodyWrapper(): HTMLElement {
  return screen.getByTestId('tall-content').parentElement as HTMLElement;
}

describe('Modal body scrolling', () => {
  afterEach(() => {
    document.body.style.overflow = '';
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function reduceMotion(matches: boolean): void {
    // jsdom ships no `matchMedia`, so it has to be defined, not spied on.
    vi.stubGlobal('matchMedia', (query: string) => ({ matches, media: query }));
  }

  it('gives a 3000px body a shrinkable, scrollable wrapper', () => {
    renderTallModal();
    const body = bodyWrapper();
    // min-h-0 is the fix; flex-1 + overflow-y-auto are what it enables.
    expect(body).toHaveClass('min-h-0');
    expect(body).toHaveClass('flex-1');
    expect(body).toHaveClass('overflow-y-auto');
  });

  /**
   * THE SCROLLBAR'S OWN LANE. On macOS — and anywhere else the platform paints
   * an OVERLAY scrollbar — a body that spans the panel's full content box has
   * the bar drawn ON TOP of its rightmost ~15px rather than beside it, so
   * `Toggle` switches and the right edge of wrapped text sit under it
   * (`AddEventModal` is the visible case). `scrollbar-gutter: stable` is not the
   * fix and never was: it reserves width only for a scrollbar that CONSUMES
   * width, which an overlay scrollbar does not, so it is a no-op in exactly the
   * reported case. The lane is carved by hand out of the panel's `p-6` instead.
   *
   * BOTH HALVES, because either alone is a different bug: `-mr-5` without `pr-4`
   * runs the body's content into the panel edge and under the rounded corner,
   * and `pr-4` without `-mr-5` just indents the text while leaving the bar
   * exactly where it was. And they are deliberately NOT equal — 20 out, 16 back
   * — which is the one thing a reader is most likely to "correct" to `-mr-4`.
   * The 4px difference is what buys the clearance; matching them spends it.
   */
  it('carves the overlay scrollbar a gutter out of the panel padding', () => {
    renderTallModal();
    const body = bodyWrapper();
    expect(body).toHaveClass('-mr-5');
    expect(body).toHaveClass('pr-4');
    // The lane is only real while the panel has the 24px it is cut from — and
    // this is `toHaveClass`, not `toContain`, because the substring form is
    // satisfied by the one refactor most likely to happen here: a mobile
    // padding pass to `p-4 sm:p-6` still CONTAINS "p-6" while the panel has
    // only 16px at phone width, so `-mr-5`/`pr-4` would be carving a 20px lane
    // out of a 16px budget and pulling the body past the panel edge — the exact
    // claim the assertion above it makes, silently false. `toHaveClass` matches
    // whole tokens, so `sm:p-6` is correctly not `p-6`.
    expect(screen.getByRole('dialog')).toHaveClass('p-6');
  });

  it('keeps the panel clipping its own rounded corners', () => {
    renderTallModal();
    // Whole tokens for the same reason as the `p-6` above: a responsive variant
    // (`sm:max-h-[90vh]`, say) would satisfy a substring check while leaving the
    // panel uncapped at the width where a 3000px body most needs the cap.
    const panel = screen.getByRole('dialog');
    expect(panel).toHaveClass('overflow-hidden');
    expect(panel).toHaveClass('max-h-[90vh]');
  });

  /**
   * WHY THESE TWO LIVE HERE AND NOT IN `Modal.test.tsx`'s "animation" block.
   *
   * The mount/unmount half IS covered there ("reports the close gesture but
   * plays no exit — uncontrolled callers own their own unmount", and its
   * reduced-motion twin), and duplicating it would be worth nothing: whether a
   * modal retires itself is decided by the `open` prop being undefined, and a
   * 3000px child cannot reach that decision.
   *
   * What is NOT covered there is this file's own subject surviving the close
   * gesture. `closing` swaps the panel's animation class, which means it rebuilds
   * the panel's className string — the one that carries `p-6`, `max-h-[90vh]`
   * and `overflow-hidden`, i.e. the budget the `-mr-5`/`pr-4` lane above is cut
   * out of. A scroll wrapper that silently loses `min-h-0` or a panel that loses
   * its cap DURING the exit is a real regression and an invisible one: the
   * modal is on its way out, so nobody looks. So these keep the animation
   * choreography (it is the only way to reach the `closing` render) and assert
   * the SCROLLING, which is what earns them their place in this file.
   *
   * CONTROLLED, OR THERE IS NO `closing` RENDER TO TEST. An earlier version of
   * these mounted the shell without `open`, and an uncontrolled shell never
   * touches its own phase on the close gesture (see `requestClose`) — so the
   * "closing" render they asserted on was the OPEN render, unchanged, and
   * dropping `max-h-[90vh]` or the body's scroll classes from the closing
   * branch left both green. The host below does what every controlled caller
   * does — `onClose` flips `open` to false — and the animated test proves it
   * reached the closing branch by the exit animation class before it asserts
   * anything else.
   */
  function ControlledTallModal({ onClose }: { onClose: () => void }): ReactElement {
    const [open, setOpen] = useState(true);
    return (
      <Modal
        open={open}
        title="Long form"
        onClose={() => {
          onClose();
          setOpen(false);
        }}
        closeLabel="Close dialog"
      >
        <div style={{ height: 3000 }} data-testid="tall-content">
          Very tall body
        </div>
      </Modal>
    );
  }

  /** The panel's exit animation — present only on the `closing` render. */
  const EXIT_CLASS = 'animate-[modal-out_160ms_ease-in]';

  it('keeps the tall body scrollable through the close gesture, unmount left to the exit', () => {
    reduceMotion(false);
    const onClose = vi.fn();
    render(<ControlledTallModal onClose={onClose} />);
    expect(screen.getByRole('dialog')).not.toHaveClass(EXIT_CLASS);

    fireEvent.click(screen.getByRole('button', { name: 'Close dialog' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    // THE PRECONDITION THE OLD VERSION NEVER HAD: this is the closing render.
    expect(screen.getByRole('dialog')).toHaveClass(EXIT_CLASS);
    // The `closing` re-render rebuilt both class strings; neither may have
    // dropped the scroll apparatus on the way through.
    expect(bodyWrapper()).toHaveClass('min-h-0', 'flex-1', 'overflow-y-auto', '-mr-5', 'pr-4');
    expect(screen.getByRole('dialog')).toHaveClass('max-h-[90vh]', 'overflow-hidden', 'p-6');

    // And the exit is the shell's to finish, not the caller's.
    fireEvent.animationEnd(screen.getByRole('dialog'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  /**
   * UNDER REDUCED MOTION THERE IS NO CLOSING RENDER AT ALL — which is the
   * guarantee, and the only one this path can make about scrolling.
   *
   * `open={false}` retires the shell straight from `open` to `closed`, so the
   * panel is never re-rendered with a class string that could have lost its cap
   * or its lane: the last panel on screen is the open one asserted above. What
   * CAN go wrong here is the reduced-motion check being skipped, which puts the
   * `closing` render — and whatever it did to the classes — back on screen for
   * 160ms that the viewer asked not to see. So this pins that the panel's class
   * string never changed between the open render and its removal.
   */
  it('retires straight from the scrollable open render under prefers-reduced-motion', () => {
    reduceMotion(true);
    const onClose = vi.fn();
    render(<ControlledTallModal onClose={onClose} />);
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveClass('max-h-[90vh]', 'p-6');
    expect(bodyWrapper()).toHaveClass('min-h-0', 'flex-1', 'overflow-y-auto', '-mr-5', 'pr-4');

    const observer = new MutationObserver(() => {});
    observer.observe(dialog, { attributes: true, attributeFilter: ['class'], subtree: true });
    fireEvent.click(screen.getByRole('button', { name: 'Close dialog' }));
    const classChanges = observer.takeRecords();
    observer.disconnect();

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    // No intermediate render rewrote the panel's (or the body's) classes on the
    // way out — i.e. no `closing` render happened to lose anything in.
    expect(classChanges).toHaveLength(0);
  });
});

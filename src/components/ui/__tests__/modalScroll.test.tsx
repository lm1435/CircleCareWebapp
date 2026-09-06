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

  it('keeps the panel clipping its own rounded corners', () => {
    renderTallModal();
    const panel = screen.getByRole('dialog');
    expect(panel.className).toContain('overflow-hidden');
    expect(panel.className).toContain('max-h-[90vh]');
  });

  // M1 regression: uncontrolled Modal never retires itself on close — see
  // Modal.test.tsx's "animation" describe block for the full coverage. This
  // guards specifically that a tall body (this file's whole reason for
  // being) does not change that: the panel stays put regardless of
  // `prefers-reduced-motion`, and the caller is the one who unmounts it.
  it('stays mounted after close in uncontrolled mode, regardless of prefers-reduced-motion', () => {
    reduceMotion(false);
    const onClose = renderTallModal();

    fireEvent.click(screen.getByRole('button', { name: 'Close dialog' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    fireEvent.animationEnd(screen.getByRole('dialog'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('stays mounted after close under prefers-reduced-motion too', () => {
    reduceMotion(true);
    const onClose = renderTallModal();

    fireEvent.click(screen.getByRole('button', { name: 'Close dialog' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});

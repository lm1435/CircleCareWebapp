import { useRef } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { Modal } from '../Modal';

function renderModal(onClose = vi.fn(), props: Partial<React.ComponentProps<typeof Modal>> = {}) {
  render(
    <Modal title="Edit event" onClose={onClose} closeLabel="Close dialog" {...props}>
      <button type="button">First field</button>
      <button type="button">Second field</button>
    </Modal>
  );
  return onClose;
}

describe('Modal', () => {
  afterEach(() => {
    document.body.style.overflow = '';
  });

  it('is a labelled, modal dialog and focuses the close button on open', () => {
    renderModal();
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    // Labelled by the title slot
    expect(dialog).toHaveAccessibleName('Edit event');
    expect(screen.getByRole('button', { name: 'Close dialog' })).toHaveFocus();
  });

  it('locks body scroll while open and restores it on unmount', () => {
    document.body.style.overflow = 'scroll';
    const { unmount } = render(
      <Modal title="t" onClose={vi.fn()} closeLabel="x">
        <button type="button">ok</button>
      </Modal>
    );
    expect(document.body.style.overflow).toBe('hidden');
    unmount();
    expect(document.body.style.overflow).toBe('scroll');
  });

  it('closes on Escape', () => {
    const onClose = renderModal();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes when the backdrop is clicked, but not when the panel is clicked', () => {
    const onClose = renderModal();
    const dialog = screen.getByRole('dialog');
    // Clicking inside the panel must not close
    fireEvent.click(dialog);
    expect(onClose).not.toHaveBeenCalled();
    // The backdrop is the dialog's grandparent wrapper (the outer fixed layer)
    const backdrop = dialog.parentElement as HTMLElement;
    fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not close on backdrop click when closeOnBackdropClick is false', () => {
    const onClose = renderModal(vi.fn(), { closeOnBackdropClick: false });
    const backdrop = screen.getByRole('dialog').parentElement as HTMLElement;
    fireEvent.click(backdrop);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('ignores Escape, backdrop clicks, and disables the close button when not dismissible', () => {
    const onClose = renderModal(vi.fn(), { dismissible: false });

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();

    const backdrop = screen.getByRole('dialog').parentElement as HTMLElement;
    fireEvent.click(backdrop);
    expect(onClose).not.toHaveBeenCalled();

    expect(screen.getByRole('button', { name: 'Close dialog' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Close dialog' }));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('remains dismissible by default (dismissible=true)', () => {
    const onClose = renderModal();
    expect(screen.getByRole('button', { name: 'Close dialog' })).not.toBeDisabled();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('traps Tab focus within the dialog (wraps both directions)', () => {
    renderModal();
    const dialog = screen.getByRole('dialog');
    const focusables = Array.from(dialog.querySelectorAll<HTMLElement>('button'));
    const first = focusables[0]!;
    const last = focusables[focusables.length - 1]!;

    last.focus();
    fireEvent.keyDown(dialog, { key: 'Tab' });
    expect(first).toHaveFocus();

    first.focus();
    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });
    expect(last).toHaveFocus();
  });

  // M4 follow-up: a caller whose body supplies its own visible heading (e.g. a
  // wizard's per-step heading) can hide the title band without losing the
  // dialog's accessible name — the h2 stays in the tree, sr-only.
  it('keeps the dialog named but renders a borderless, compact header when hideTitle is set', () => {
    renderModal(vi.fn(), { hideTitle: true });

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAccessibleName('Edit event');

    const heading = screen.getByRole('heading', { name: 'Edit event' });
    expect(heading).toHaveClass('sr-only');

    const header = screen.getByRole('button', { name: 'Close dialog' })
      .parentElement as HTMLElement;
    expect(header.className).not.toContain('border-b');
    expect(header.className).not.toContain('pb-4');
  });

  it('renders the normal bordered header when hideTitle is not set', () => {
    renderModal();

    const heading = screen.getByRole('heading', { name: 'Edit event' });
    expect(heading).not.toHaveClass('sr-only');

    const header = screen.getByRole('button', { name: 'Close dialog' })
      .parentElement as HTMLElement;
    expect(header.className).toContain('border-b');
  });

  // ── Entrance / exit animation (spec §4.5) ────────────────────────────────
  describe('animation', () => {
    afterEach(() => {
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
    });

    function reduceMotion(matches: boolean): void {
      // jsdom ships no `matchMedia`, so it has to be defined, not spied on.
      vi.stubGlobal('matchMedia', (query: string) => ({ matches, media: query }));
    }

    it('enters with modal-in on the panel and fade-in on the backdrop', () => {
      renderModal();
      const dialog = screen.getByRole('dialog');
      expect(dialog.className).toContain('animate-[modal-in_240ms_var(--ease-spring)]');
      expect(dialog.className).toContain('motion-reduce:animate-none');
      const backdrop = dialog.parentElement as HTMLElement;
      expect(backdrop.className).toContain('animate-[fade-in_200ms_ease-out]');
      expect(backdrop.className).toContain('motion-reduce:animate-none');
    });

    // M1 regression: an uncontrolled shell must NEVER retire itself on a close
    // gesture — only a controlled caller flipping `open={false}` starts the
    // exit (see the "open prop" describe block below for that coverage). A
    // caller whose `onClose` declines to close (shows a confirm dialog
    // instead, say) must keep the panel exactly as it was; self-retiring here
    // previously stranded exactly that caller.
    it('reports the close gesture but plays no exit — uncontrolled callers own their own unmount', () => {
      reduceMotion(false);
      const onClose = renderModal();

      fireEvent.click(screen.getByRole('button', { name: 'Close dialog' }));
      expect(onClose).toHaveBeenCalledTimes(1);
      const dialog = screen.getByRole('dialog');
      expect(dialog).toBeInTheDocument();
      expect(dialog.className).toContain('animate-[modal-in');
      expect(dialog.className).not.toContain('modal-out');

      // No fallback timer was ever armed — a stray `animationend` (or one
      // firing well after the fact) must not unmount it either.
      fireEvent.animationEnd(dialog);
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    it('ignores an animationend bubbling up from inside the body', () => {
      reduceMotion(false);
      render(
        <Modal title="t" onClose={vi.fn()} closeLabel="Close dialog">
          <button type="button">inner</button>
        </Modal>
      );
      fireEvent.click(screen.getByRole('button', { name: 'Close dialog' }));
      fireEvent.animationEnd(screen.getByRole('button', { name: 'inner' }));
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    it('plays no exit in uncontrolled mode even under prefers-reduced-motion', () => {
      reduceMotion(true);
      const onClose = renderModal();
      fireEvent.click(screen.getByRole('button', { name: 'Close dialog' }));
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });
  });

  // ── Controlled lifecycle: the `open` prop (spec §4.5) ────────────────────
  describe('open prop', () => {
    afterEach(() => {
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
    });

    function reduceMotion(matches: boolean): void {
      vi.stubGlobal('matchMedia', (query: string) => ({ matches, media: query }));
    }

    function renderControlled(open: boolean, onClose = vi.fn()) {
      const view = render(
        <Modal open={open} title="Edit event" onClose={onClose} closeLabel="Close dialog">
          <button type="button">First field</button>
        </Modal>
      );
      const rerenderWith = (next: boolean): void => {
        view.rerender(
          <Modal open={next} title="Edit event" onClose={onClose} closeLabel="Close dialog">
            <button type="button">First field</button>
          </Modal>
        );
      };
      return { onClose, rerenderWith };
    }

    it('renders nothing while open={false}, and locks no scroll', () => {
      renderControlled(false);
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(document.body.style.overflow).toBe('');
    });

    it('mounts and plays modal-in when open flips to true', () => {
      const { rerenderWith } = renderControlled(false);
      rerenderWith(true);

      const dialog = screen.getByRole('dialog');
      expect(dialog.className).toContain('animate-[modal-in_240ms_var(--ease-spring)]');
      expect(document.body.style.overflow).toBe('hidden');
    });

    it('unmounts only after animationend when open flips to false', () => {
      reduceMotion(false);
      const { rerenderWith } = renderControlled(true);
      expect(screen.getByRole('dialog')).toBeInTheDocument();

      rerenderWith(false);
      const dialog = screen.getByRole('dialog');
      expect(dialog).toBeInTheDocument();
      expect(dialog.className).toContain('animate-[modal-out_160ms_ease-in]');

      fireEvent.animationEnd(dialog);
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(document.body.style.overflow).toBe('');
    });

    it('unmounts immediately on open=false under prefers-reduced-motion', () => {
      reduceMotion(true);
      const { rerenderWith } = renderControlled(true);
      rerenderWith(false);
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('reports the close gesture but does not close itself — `open` is the source of truth', () => {
      reduceMotion(false);
      const { onClose } = renderControlled(true);

      fireEvent.click(screen.getByRole('button', { name: 'Close dialog' }));
      expect(onClose).toHaveBeenCalledTimes(1);
      // The caller ignored it, so the dialog stays fully open — no exit.
      const dialog = screen.getByRole('dialog');
      expect(dialog).toBeInTheDocument();
      expect(dialog.className).toContain('animate-[modal-in');
      expect(dialog.className).not.toContain('modal-out');
    });

    it('reopens after a completed exit without ever being unmounted', () => {
      reduceMotion(false);
      const { rerenderWith } = renderControlled(true);

      rerenderWith(false);
      fireEvent.animationEnd(screen.getByRole('dialog'));
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

      rerenderWith(true);
      expect(screen.getByRole('dialog')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Close dialog' })).toHaveFocus();
    });

    it('plays no exit on an initial open={false} mount', () => {
      reduceMotion(false);
      renderControlled(false);
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  // axe `scrollable-region-focusable` (WCAG 2.1.1): the scrollable body must
  // itself be keyboard-reachable, even when its content holds nothing else
  // focusable.
  it('makes the scrollable body a focusable, labelled region', () => {
    renderModal();
    const body = screen.getByRole('region', { name: 'Edit event' });
    expect(body).toHaveAttribute('tabindex', '0');
    expect(body.className).toContain('overflow-y-auto');
  });

  // The region sits BETWEEN the close button and the body's own buttons in DOM
  // order, so it never changes what "first"/"last" are for the wrap-around
  // trap (still the close button and the last body button) — the pre-existing
  // "traps Tab focus" test above already proves that wrap still lands
  // correctly with the region present in the focusable list.

  // WCAG 2.4.3: a caller's own field should be able to win initial focus
  // instead of the close button.
  it('focuses initialFocusRef instead of the close button when given', () => {
    function Harness() {
      const fieldRef = useRef<HTMLInputElement>(null);
      return (
        <Modal title="Edit event" onClose={vi.fn()} closeLabel="Close dialog" initialFocusRef={fieldRef}>
          <input ref={fieldRef} aria-label="Name" />
        </Modal>
      );
    }
    render(<Harness />);
    expect(screen.getByLabelText('Name')).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Close dialog' })).not.toHaveFocus();
  });

  it('falls back to the close button when initialFocusRef has no current element', () => {
    function Harness() {
      const fieldRef = useRef<HTMLInputElement>(null);
      return (
        <Modal title="Edit event" onClose={vi.fn()} closeLabel="Close dialog" initialFocusRef={fieldRef}>
          <button type="button">First field</button>
        </Modal>
      );
    }
    render(<Harness />);
    expect(screen.getByRole('button', { name: 'Close dialog' })).toHaveFocus();
  });

  it('restores focus to the previously focused element on unmount', () => {
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    trigger.focus();

    const { unmount } = render(
      <Modal title="t" onClose={vi.fn()} closeLabel="x">
        <button type="button">ok</button>
      </Modal>
    );
    expect(trigger).not.toHaveFocus();

    unmount();
    expect(trigger).toHaveFocus();
    trigger.remove();
  });

  it('renders a `header` in the title row beside the close button, with the sr-only title still naming the dialog', () => {
    render(
      <Modal title="Care Assistant" hideTitle header={<p>Ask about caregiving</p>} onClose={vi.fn()} closeLabel="Close">
        body
      </Modal>
    );
    const close = screen.getByRole('button', { name: 'Close' });
    const header = screen.getByText('Ask about caregiving');
    // Same row: the header's wrapper and the × share one parent.
    expect(header.parentElement?.parentElement).toBe(close.parentElement);
    expect(screen.getByRole('dialog')).toHaveAccessibleName('Care Assistant');
    // The row keeps the header band (rule beneath), not the compact ×-only strip.
    expect(close.parentElement?.className).toContain('border-b');
  });
});

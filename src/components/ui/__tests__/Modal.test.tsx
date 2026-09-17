import { useRef, useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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
  it.each([
    [undefined, 'max-w-lg'],
    ['sm', 'max-w-sm'],
    ['md', 'max-w-lg'],
    ['lg', 'max-w-2xl'],
    // xl (768px) exists for dense chip forms: EditMedicalInfoModal's four tag
    // fields wrapped into three rows of 44px chips at the default width.
    ['xl', 'max-w-3xl'],
  ] as const)('size=%s renders the panel at %s', (size, cls) => {
    renderModal(vi.fn(), size ? { size } : {});
    const dialog = screen.getByRole('dialog');
    expect(dialog.className).toContain(cls);
    for (const other of ['max-w-sm', 'max-w-lg', 'max-w-2xl', 'max-w-3xl'].filter((c) => c !== cls)) {
      expect(dialog.className).not.toContain(other);
    }
  });

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

  // WCAG 2.1.2 / 2.4.3 — the shell's Escape + Tab handling is a React
  // `onKeyDown` on ITS OWN backdrop div, so a synthetic key event only reaches
  // it while focus is inside that subtree. Any control inside a dialog that
  // becomes `disabled` mid-action is BLURRED BY THE BROWSER at that moment
  // (jsdom does not do this, which is why every test in this file has to
  // perform the blur itself), and if the action then fails, the control
  // re-enables with focus stranded on `<body>`: Escape stops closing the dialog
  // and the next Tab walks into the page behind the backdrop. (That page is
  // NOT `aria-hidden` or `inert` — this comment used to say it was, and
  // nothing in `src` does it. `aria-modal="true"` is the only background
  // suppression the shell has, and the shell renders inline rather than
  // through a portal, so there is no sibling subtree to mark. See Modal.tsx.)
  //
  // Recovering here rather than at each call site is deliberate. It is the
  // shell that owns the trap, and the same shape sits behind ProfilePage's
  // delete-account confirm, InviteMemberModal's send, and both of
  // JoinCircleModal's steps — every one of them a `disabled={...isPending}`
  // whose failure path re-enables and refocuses nothing.
  //
  // The recovery is deliberately deferred by one microtask: `focusout` fires
  // BEFORE the new target is focused, so `document.activeElement` reads as
  // `<body>` even for an ordinary move between two controls. The check has to
  // happen after that has settled, which is why this test awaits.
  it('pulls focus back into the dialog when a control inside it is blurred to nothing', async () => {
    renderModal();
    const first = screen.getByRole('button', { name: 'First field' });
    first.focus();
    expect(first).toHaveFocus();

    // What a browser does when an element becomes `disabled`.
    first.blur();
    expect(document.body).toHaveFocus();

    await waitFor(() => expect(screen.getByRole('dialog')).toHaveFocus());
  });

  it('does not steal focus when it moves to another element (inside or outside)', async () => {
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    renderModal();

    const first = screen.getByRole('button', { name: 'First field' });
    const second = screen.getByRole('button', { name: 'Second field' });
    first.focus();
    second.focus();
    expect(second).toHaveFocus();

    // A deliberate move out (the trap is a Tab-key concern, not a focus-event
    // one) must not be fought over — only a blur to NOTHING is recovered.
    outside.focus();
    await Promise.resolve();
    expect(outside).toHaveFocus();
    outside.remove();
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

/**
 * ── THE TRAP'S BLIND SPOT: THE PANEL ITSELF ────────────────────────────────
 *
 * The focus recovery above parks focus on the dialog PANEL — `tabIndex={-1}`,
 * and the FIRST node in the dialog's subtree. `FOCUSABLE_SELECTOR` excludes
 * `[tabindex="-1"]`, so the panel is not in the focusable list at all: on
 * Shift+Tab `active === first` was false (first is the close button) and
 * `dialogRef.current.contains(active)` was TRUE (a node contains itself), so
 * neither branch called `preventDefault` and the browser walked to the
 * previous tabbable OUTSIDE the dialog. WCAG 2.4.3, and it sits on a hot path
 * now that every disable-blur parks focus exactly there.
 */
describe('Tab trap from the panel itself', () => {
  it('wraps Shift+Tab from the panel back to the LAST focusable inside', () => {
    renderModal();
    const dialog = screen.getByRole('dialog');
    const focusables = Array.from(dialog.querySelectorAll<HTMLElement>('button'));
    const last = focusables[focusables.length - 1]!;

    // Where the recovery parks focus after any disable-blur.
    dialog.focus();
    expect(dialog).toHaveFocus();

    // `fireEvent` returns false when the handler called preventDefault — the
    // browser's default (walk out of the dialog) has to be cancelled, not just
    // followed by a focus() that the browser then overrides.
    expect(fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true })).toBe(false);
    expect(last).toHaveFocus();
  });

  it('sends a plain Tab from the panel to the FIRST focusable inside', () => {
    renderModal();
    const dialog = screen.getByRole('dialog');
    const first = dialog.querySelector<HTMLElement>('button')!;

    dialog.focus();
    fireEvent.keyDown(dialog, { key: 'Tab' });
    expect(first).toHaveFocus();
  });
});

/**
 * ── THE RECOVERY COVERED `disabled`-BLUR AND NOT REMOVAL ───────────────────
 *
 * Browsers fire NO `blur`/`focusout` when the focused node is DETACHED —
 * `activeElement` silently resets to `<body>`. So the `focusout` listener,
 * which is the whole recovery, never runs for the commonest way a dialog
 * loses its focused control: the control disappearing.
 *
 * The live instance is a nested dialog. `EventDetailActions` renders a
 * `ConfirmDialog` inside `EventDetailModal`'s Modal; on confirm the inner
 * Modal's cleanup calls `previouslyFocused?.focus()` on a button the same
 * commit may have removed — a silent no-op on a detached node — and focus is
 * stranded on `<body>` INSIDE the still-open outer dialog, with Escape and Tab
 * both dead (the shell's handlers are React `onKeyDown` on its own subtree).
 */
describe('focus recovery when the focused node is removed', () => {
  it('recovers when the focused control is removed rather than disabled', async () => {
    renderModal();
    const second = screen.getByRole('button', { name: 'Second field' });
    second.focus();
    expect(second).toHaveFocus();

    // No blur, no focusout — this is what a detach does.
    second.remove();
    expect(document.body).toHaveFocus();

    await waitFor(() => expect(screen.getByRole('dialog')).toHaveFocus());
  });

  it('recovers in the OUTER dialog when a nested confirm closes over a removed trigger', async () => {
    function Harness() {
      const [open, setOpen] = useState(true);
      return (
        <Modal title="Event" onClose={vi.fn()} closeLabel="Close outer">
          {/* The trigger disappears in the same commit that closes the inner
              dialog — exactly what EventDetailActions does on confirm. */}
          {open ? <button type="button">Edit</button> : null}
          {open ? (
            <Modal title="Delete?" onClose={vi.fn()} closeLabel="Close inner">
              <button type="button" onClick={() => setOpen(false)}>
                Confirm
              </button>
            </Modal>
          ) : null}
        </Modal>
      );
    }
    render(<Harness />);

    const confirm = screen.getByRole('button', { name: 'Confirm' });
    confirm.focus();
    fireEvent.click(confirm);

    // The inner dialog is gone; the outer one is still open and must still own
    // the keyboard.
    expect(screen.queryByRole('button', { name: 'Confirm' })).toBeNull();
    await waitFor(() =>
      expect(screen.getByRole('dialog', { name: 'Event' })).toHaveFocus()
    );
  });
});

/**
 * ── THE RAIL THAT STOPS THE RECOVERY FIGHTING A LEGITIMATE CLAIM ───────────
 *
 * `focusout` fires BEFORE the new target is focused, so the recovery re-checks
 * on a microtask. If something claimed focus in between — the dialog's own Tab
 * handler, a caller's `.focus()` in a submit handler — the recovery must stand
 * down. Without the `activeElement` re-check the dialog yanks focus back off
 * whatever just took it.
 */
describe('the recovery stands down when something else claimed focus', () => {
  it('does not steal focus claimed synchronously after a blur to nothing', async () => {
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    renderModal();
    const first = screen.getByRole('button', { name: 'First field' });
    first.focus();

    // A blur to NOTHING (relatedTarget null) — the case the recovery exists
    // for — immediately followed, in the same task, by a real claim.
    first.blur();
    outside.focus();

    await Promise.resolve();
    await Promise.resolve();
    expect(outside).toHaveFocus();
    outside.remove();
  });
});

/**
 * ── ESCAPE MUST NOT CLOSE TWO DIALOGS ──────────────────────────────────────
 *
 * The shell's key handler is a React `onKeyDown` on its own backdrop, and a
 * nested dialog's backdrop is a DESCENDANT of the outer one's — so without
 * `stopPropagation` one Escape reaches both handlers and dismisses the
 * confirm AND the dialog that raised it. Nested dialogs are live here
 * (ConfirmDialog inside EventDetailModal, DeleteEventDialog inside the
 * calendar's detail modal).
 */
describe('Escape in a nested dialog', () => {
  it('closes only the innermost dialog', () => {
    const outerClose = vi.fn();
    const innerClose = vi.fn();
    render(
      <Modal title="Event" onClose={outerClose} closeLabel="Close outer">
        <Modal title="Delete?" onClose={innerClose} closeLabel="Close inner">
          <button type="button">Confirm</button>
        </Modal>
      </Modal>
    );

    fireEvent.keyDown(screen.getByRole('dialog', { name: 'Delete?' }), { key: 'Escape' });

    expect(innerClose).toHaveBeenCalledTimes(1);
    expect(outerClose).not.toHaveBeenCalled();
  });
});

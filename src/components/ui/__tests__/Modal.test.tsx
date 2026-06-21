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
});

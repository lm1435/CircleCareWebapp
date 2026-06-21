import { fireEvent, render, screen } from '@testing-library/react';
import { ConfirmDialog } from '../ConfirmDialog';

describe('ConfirmDialog', () => {
  afterEach(() => {
    document.body.style.overflow = '';
  });

  function setup(props: Partial<React.ComponentProps<typeof ConfirmDialog>> = {}) {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <ConfirmDialog
        title="Delete document"
        message="This cannot be undone."
        confirmLabel="Delete"
        cancelLabel="Cancel"
        closeLabel="Close dialog"
        onConfirm={onConfirm}
        onCancel={onCancel}
        {...props}
      />
    );
    return { onConfirm, onCancel };
  }

  it('renders the title and message inside a labelled dialog', () => {
    setup();
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAccessibleName('Delete document');
    expect(screen.getByText('This cannot be undone.')).toBeInTheDocument();
  });

  it('fires onConfirm when the confirm button is pressed', () => {
    const { onConfirm, onCancel } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('fires onCancel from the cancel button, Escape, and backdrop click', () => {
    const { onCancel } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    const backdrop = screen.getByRole('dialog').parentElement as HTMLElement;
    fireEvent.click(backdrop);
    expect(onCancel).toHaveBeenCalledTimes(3);
  });

  it('uses the destructive (terracotta) variant when destructive', () => {
    setup({ destructive: true });
    expect(screen.getByRole('button', { name: 'Delete' })).toHaveClass('btn-terracotta');
  });

  it('uses the primary variant by default', () => {
    setup();
    expect(screen.getByRole('button', { name: 'Delete' })).toHaveClass('btn-primary');
  });

  it('disables the confirm button when confirmDisabled', () => {
    setup({ confirmDisabled: true });
    expect(screen.getByRole('button', { name: 'Delete' })).toBeDisabled();
  });
});

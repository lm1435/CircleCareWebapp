import { fireEvent, render, screen } from '@testing-library/react';
import { ConfirmDialog } from '../ConfirmDialog';

describe('ConfirmDialog', () => {
  afterEach(() => {
    document.body.style.overflow = '';
  });

  function setup(props: Partial<React.ComponentProps<typeof ConfirmDialog>> = {}) {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    const { container } = render(
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
    return { onConfirm, onCancel, container };
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

  it('uses the danger variant when destructive', () => {
    setup({ destructive: true });
    const confirm = screen.getByRole('button', { name: 'Delete' });
    expect(confirm.className).toContain('bg-terracotta-soft');
    expect(confirm.className).toContain('text-terracotta-deep');
    expect(confirm.className).not.toContain('bg-moss ');
  });

  it('uses the primary variant by default', () => {
    setup();
    const confirm = screen.getByRole('button', { name: 'Delete' });
    expect(confirm.className).toContain('bg-moss');
    expect(confirm.className).toContain('text-cream');
  });

  it('uses the secondary variant for cancel', () => {
    setup();
    const cancel = screen.getByRole('button', { name: 'Cancel' });
    expect(cancel.className).toContain('bg-cream');
    expect(cancel.className).toContain('border-line ');
  });

  it('disables the confirm button when confirmDisabled', () => {
    setup({ confirmDisabled: true });
    expect(screen.getByRole('button', { name: 'Delete' })).toBeDisabled();
  });

  it('shows a terracotta mark for the destructive variant', () => {
    const { container } = setup({ variant: 'destructive' });
    // Attribute-substring selector: the tone class is `bg-terracotta/15`, and
    // the `/` would have to be escaped in a class selector.
    const mark = container.querySelector('[class*="bg-terracotta/15"]');
    expect(mark).toBeInTheDocument();
    expect(mark?.className).toContain('text-terracotta');
  });

  it('shows a moss mark for the success variant', () => {
    const { container } = setup({ variant: 'success' });
    const mark = container.querySelector('[class*="bg-moss/15"]');
    expect(mark).toBeInTheDocument();
    expect(mark?.className).toContain('text-moss');
  });

  it('renders a caller-chosen mark, tinted dusk on a plain confirm by default', () => {
    const { container } = setup({ icon: 'log-out-outline' });
    const mark = container.querySelector('[class*="rounded-[10px]"]');
    expect(mark).toBeInTheDocument();
    expect(mark?.className).toContain('bg-dusk/15');
  });

  it('a caller-chosen mark on a destructive dialog keeps the terracotta tint', () => {
    const { container } = setup({ icon: 'person-outline', destructive: true });
    const mark = container.querySelector('[class*="rounded-[10px]"]');
    expect(mark?.className).toContain('bg-terracotta/15');
    expect(container.querySelector('[class*="bg-moss/15"]')).not.toBeInTheDocument();
  });

  it('shows no mark at all for the default confirm variant', () => {
    const { container } = setup();
    // A plain question carries no glyph (the grey "?" tile said nothing the
    // title did not — mobile's plain confirm is a bare alert). Assert the
    // tinted marks are absent too, so a mark that renders unconditionally
    // still fails here.
    expect(container.querySelector('[class*="bg-terracotta/15"]')).not.toBeInTheDocument();
    expect(container.querySelector('[class*="bg-moss/15"]')).not.toBeInTheDocument();
    expect(container.querySelector('[class*="rounded-[10px]"]')).not.toBeInTheDocument();
  });

  it('does not cancel on backdrop click when destructive', () => {
    const { onCancel } = setup({ destructive: true });
    const backdrop = screen.getByRole('dialog').parentElement as HTMLElement;
    fireEvent.click(backdrop);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('still cancels on Escape and the cancel button when destructive', () => {
    const { onCancel } = setup({ destructive: true });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(2);
  });

  // The confirm button is the footer's LAST button. While `loading`, Button
  // keeps the label in flow under `visibility:hidden` and adds an sr-only
  // copy; jsdom loads no CSS (`css: false`), so it counts BOTH copies and the
  // computed name doubles ("Deleting…Deleting…"). That is an artifact of the
  // environment, not of the DOM shipped to users — so these assert the busy
  // state and the label text rather than the computed name.
  function confirmButton(): HTMLElement {
    const buttons = screen.getAllByRole('button');
    return buttons[buttons.length - 1];
  }

  it('disables both buttons and swaps the confirm label while loading', () => {
    setup({ loading: true, loadingLabel: 'Deleting…' });
    const confirm = confirmButton();
    expect(confirm).toBeDisabled();
    expect(confirm).toHaveAttribute('aria-busy', 'true');
    expect(confirm).toHaveTextContent('Deleting…');
    expect(confirm).not.toHaveTextContent('Delete document');
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
  });

  it('keeps the confirm label while loading when no loadingLabel is given', () => {
    setup({ loading: true });
    const confirm = confirmButton();
    expect(confirm).toBeDisabled();
    expect(confirm).toHaveTextContent('Delete');
  });

  it('is addressable by its plain label when not loading', () => {
    setup({ loadingLabel: 'Deleting…' });
    expect(screen.getByRole('button', { name: 'Delete' })).not.toBeDisabled();
    expect(screen.getByRole('button', { name: 'Delete' })).not.toHaveAttribute('aria-busy');
  });

  it('blocks Escape dismissal while loading (dismissible=false)', () => {
    const { onCancel } = setup({ loading: true });
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onCancel).not.toHaveBeenCalled();
  });

  // Spec §4.5 footer convention: one right-aligned row, secondary first, then
  // the confirm action — stacked full width (confirm on top) below 480px.
  it('puts the cancel button before the confirm button in DOM/tab order', () => {
    setup();
    const labels = screen.getAllByRole('button').map((button) => button.textContent);
    const confirmIndex = labels.indexOf('Delete');
    const cancelIndex = labels.indexOf('Cancel');
    expect(confirmIndex).toBeGreaterThan(-1);
    expect(cancelIndex).toBeGreaterThan(-1);
    expect(cancelIndex).toBeLessThan(confirmIndex);
  });

  it('renders both buttons in the shell footer row (right-aligned, stacked below 480px)', () => {
    setup();
    const footer = screen.getByRole('button', { name: 'Cancel' }).parentElement as HTMLElement;
    expect(footer).toBe(screen.getByRole('button', { name: 'Delete' }).parentElement);
    expect(footer.className).toContain('justify-end');
    expect(footer.className).toContain('gap-3');
    expect(footer.className).toContain('max-[479px]:flex-col-reverse');
    expect(footer.className).toContain('max-[479px]:[&>*]:w-full');
  });

  it('centers a string message under a mark without capping its width (spec §4.5)', () => {
    setup({ message: 'This cannot be undone.', destructive: true });
    const messageEl = screen.getByText('This cannot be undone.');
    expect(messageEl).toHaveClass('text-center');
    expect(messageEl.className).not.toContain('max-w-[280px]');
  });

  it('leaves a mark-less string message left-aligned, like an alert body', () => {
    setup({ message: 'Are you sure you want to sign out?' });
    const messageEl = screen.getByText('Are you sure you want to sign out?');
    expect(messageEl).not.toHaveClass('text-center');
  });

  it('renders a ReactNode message full width and left-aligned (not squeezed/centered)', () => {
    setup({
      message: <input aria-label="Type DELETE to confirm" defaultValue="" />,
    });
    const messageWrapper = screen.getByLabelText('Type DELETE to confirm').parentElement as HTMLElement;
    expect(messageWrapper).not.toHaveClass('mx-auto');
    expect(messageWrapper).not.toHaveClass('max-w-[280px]');
    expect(messageWrapper).not.toHaveClass('text-center');
  });

  // EditCirclePage gates its "delete circle" confirm on the user typing a
  // keyword; the dialog must keep passing `confirmDisabled` through untouched
  // while a rich ReactNode message hosts the input.
  it('keeps the keyword gate working with a ReactNode message', () => {
    const { onConfirm } = setup({
      message: <input aria-label="Type DELETE to confirm" defaultValue="" />,
      confirmDisabled: true,
    });
    const confirm = screen.getByRole('button', { name: 'Delete' });
    expect(confirm).toBeDisabled();
    fireEvent.click(confirm);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('breaks a long unbreakable string (email/name) instead of overflowing the 280px column', () => {
    // 45 chars, no spaces — the kind of string (an email or a long name) that
    // overflows a fixed-width column without word-breaking.
    const unbreakable = 'a'.repeat(20) + '@' + 'b'.repeat(20) + '.com';
    setup({ message: unbreakable });
    expect(screen.getByText(unbreakable)).toHaveClass('break-words');
  });

  it('breaks a long unbreakable ReactNode-wrapped string too', () => {
    const unbreakable = 'x'.repeat(45);
    setup({ message: <span>{unbreakable}</span> });
    const messageWrapper = screen.getByText(unbreakable).parentElement as HTMLElement;
    expect(messageWrapper).toHaveClass('break-words');
  });

  it('shows a terracotta mark for the error variant but keeps the confirm button primary', () => {
    const { container } = setup({ variant: 'error' });
    const mark = container.querySelector('[class*="bg-terracotta/15"]');
    expect(mark).toBeInTheDocument();
    const confirmButton = screen.getByRole('button', { name: 'Delete' });
    expect(confirmButton.className).toContain('bg-moss');
    expect(confirmButton.className).not.toContain('bg-terracotta-soft');
  });
});

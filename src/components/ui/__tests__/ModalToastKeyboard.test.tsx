import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import '@/i18n';
import { ToastProvider, useToast } from '@/components/ui';
import { Modal } from '@/components/ui/Modal';

// WCAG 2.1.1 — a toast raised while a dialog is open lives OUTSIDE the dialog,
// so the Modal appends the toast's controls to the END of its Tab cycle
// (Modal.tsx, "THE TOAST IS PART OF THE TOPMOST DIALOG'S TAB CYCLE"). The real
// browser proof (Enter on a premium-gate "Upgrade" raised inside a dialog) is
// e2e/unhappy/writes/toast-focus-keyboard.spec.ts.

type Show = ReturnType<typeof useToast>['showToast'];

function Harness({ onReady }: { onReady: (show: Show) => void }): ReactElement {
  const { showToast } = useToast();
  onReady(showToast);
  return <div />;
}

function reduceMotion(matches: boolean): void {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches, media: query }));
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.style.overflow = '';
});

function setup(
  onClose = vi.fn(),
  children: ReactNode = (
    <>
      <button type="button">First field</button>
      <button type="button">Last field</button>
    </>
  )
): { show: Show; onClose: typeof onClose } {
  let show!: Show;
  render(
    <ToastProvider>
      <Harness onReady={(s) => (show = s)} />
      <Modal title="Dialog" closeLabel="Close dialog" onClose={onClose}>
        {children}
      </Modal>
    </ToastProvider>
  );
  return { show, onClose };
}

const tab = (shift = false): void => {
  fireEvent.keyDown(document.activeElement as Element, { key: 'Tab', shiftKey: shift });
};
// A string `name` is matched against the WHOLE accessible name ("Close" ≠ "Close dialog").
const byName = (name: string): HTMLElement => screen.getByRole('button', { name });

describe('the open dialog Tab cycle reaches the toast', () => {
  it('Tab off the dialog\'s LAST control enters the toast, walks its controls, then wraps to the dialog\'s FIRST', () => {
    reduceMotion(true);
    const onUpgrade = vi.fn();
    const { show } = setup();
    act(() => show('Premium feature', 'info', { label: 'Upgrade', onClick: onUpgrade }));

    byName('Last field').focus();
    tab();
    expect(byName('Upgrade')).toHaveFocus();
    tab();
    expect(byName('Close')).toHaveFocus();
    tab();
    expect(byName('Close dialog')).toHaveFocus();

    // Activation works from the keyboard-focused control.
    byName('Last field').focus();
    tab();
    fireEvent.click(document.activeElement as Element);
    expect(onUpgrade).toHaveBeenCalledTimes(1);
  });

  it("Shift+Tab off the dialog's FIRST control enters the toast from its end, and back out to the dialog's LAST", () => {
    reduceMotion(true);
    const { show } = setup();
    act(() => show('Premium feature', 'info', { label: 'Upgrade', onClick: vi.fn() }));

    byName('Close dialog').focus();
    tab(true);
    expect(byName('Close')).toHaveFocus();
    tab(true);
    expect(byName('Upgrade')).toHaveFocus();
    tab(true);
    expect(byName('Last field')).toHaveFocus();
  });

  it('without a toast the trap is unchanged (last wraps to first)', () => {
    setup();
    byName('Last field').focus();
    tab();
    expect(byName('Close dialog')).toHaveFocus();
  });

  it('Escape with focus in the toast still closes the dialog', () => {
    reduceMotion(true);
    const { show, onClose } = setup();
    act(() => show('Premium feature', 'info', { label: 'Upgrade', onClick: vi.fn() }));
    byName('Last field').focus();
    tab();
    expect(byName('Upgrade')).toHaveFocus();

    fireEvent.keyDown(document.activeElement as Element, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('when the focused toast control vanishes, focus returns to the dialog control Tab left from', async () => {
    reduceMotion(true);
    const { show } = setup();
    act(() => show('Boom', 'error'));
    byName('Last field').focus();
    tab();
    const close = byName('Close');
    expect(close).toHaveFocus();

    // Keyboard activation of the toast's close: the node is removed while focused.
    fireEvent.click(close);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    await waitFor(() => expect(byName('Last field')).toHaveFocus());
  });

  it("a leaving toast's controls are not part of the cycle", () => {
    reduceMotion(false);
    const { show } = setup();
    act(() => show('Boom', 'error'));
    fireEvent.click(byName('Close'));
    expect(screen.getByRole('alert')).toHaveAttribute('data-leaving');

    byName('Last field').focus();
    tab();
    expect(byName('Close dialog')).toHaveFocus();
  });

  it('with nested dialogs only the TOPMOST one adds the toast to its cycle', () => {
    reduceMotion(true);
    const { show } = setup(
      vi.fn(),
      <>
        <button type="button">Outer field</button>
        <Modal title="Inner" closeLabel="Close inner" onClose={() => {}}>
          <button type="button">Inner field</button>
        </Modal>
      </>
    );
    act(() => show('Premium feature', 'info', { label: 'Upgrade', onClick: vi.fn() }));

    byName('Inner field').focus();
    tab();
    expect(byName('Upgrade')).toHaveFocus();
    tab();
    tab();
    expect(byName('Close inner')).toHaveFocus();
  });
});

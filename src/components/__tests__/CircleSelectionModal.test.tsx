import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@/i18n';
import { ToastProvider } from '@/components/ui';

const mutate = vi.fn();

vi.mock('@/hooks/useCircles', () => ({
  useCircles: () => ({
    data: [
      { id: 'c1', name: "Mom's Care", recipient_name: 'Rose', role: 'owner', member_count: 3 },
      { id: 'c2', name: "Dad's Care", recipient_name: 'Joe', role: 'owner', member_count: 2 },
      { id: 'c3', name: 'Friend circle', recipient_name: 'Ana', role: 'member', member_count: 5 },
    ],
    isLoading: false,
  }),
}));

vi.mock('@/hooks/useSubscriptionStatus', () => ({
  useSelectDowngradeCircle: () => ({ mutate, isPending: false }),
}));

import { CircleSelectionModal } from '@/components/CircleSelectionModal';

const onClose = vi.fn();

function renderModal(): void {
  render(
    <ToastProvider>
      <CircleSelectionModal onClose={onClose} />
    </ToastProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('CircleSelectionModal', () => {
  it('lists only owned circles as radio options', () => {
    renderModal();
    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(2); // c1, c2 — not the member-only c3
    expect(screen.getByText("Mom's Care")).toBeInTheDocument();
    expect(screen.queryByText('Friend circle')).not.toBeInTheDocument();
  });

  it('keeps the Confirm action disabled until a circle is picked', () => {
    renderModal();
    expect(screen.getByRole('button', { name: 'Confirm selection' })).toBeDisabled();
  });

  // Modal footer convention (M4): a ghost Cancel before the filled primary,
  // and the RadioGroup carries its own accessible name so the dialog has one
  // heading (the Modal's own h2) rather than reusing that heading's text.
  it('puts the ghost Cancel before the filled Confirm selection on step 1', () => {
    renderModal();

    const labels = screen.getAllByRole('button').map((button) => button.textContent);
    expect(labels.indexOf('Cancel')).toBeGreaterThan(-1);
    expect(labels.indexOf('Cancel')).toBeLessThan(labels.indexOf('Confirm selection'));
  });

  it('closes on Cancel without selecting a circle', () => {
    renderModal();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('labels the radio group distinctly from the dialog heading', () => {
    renderModal();

    expect(screen.getByRole('heading', { name: 'Pick one circle to keep' })).toBeInTheDocument();
    expect(screen.getByRole('radiogroup', { name: 'Choose a circle to keep' })).toBeInTheDocument();
  });

  it('select → confirm → keep calls mutate with the chosen circle id', () => {
    renderModal();

    fireEvent.click(screen.getAllByRole('radio')[0]); // pick c1
    fireEvent.click(screen.getByRole('button', { name: 'Confirm selection' }));

    // Confirmation step
    expect(screen.getByRole('heading', { name: 'Keep this circle?' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Keep this circle' }));

    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate.mock.calls[0][0]).toBe('c1');
  });

  it('Back returns from confirm to the selection step', () => {
    renderModal();
    fireEvent.click(screen.getAllByRole('radio')[1]); // pick c2
    fireEvent.click(screen.getByRole('button', { name: 'Confirm selection' }));
    expect(screen.getByRole('heading', { name: 'Keep this circle?' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByRole('heading', { name: 'Pick one circle to keep' })).toBeInTheDocument();
  });
});

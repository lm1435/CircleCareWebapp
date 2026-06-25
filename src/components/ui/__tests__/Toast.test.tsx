import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import type { ReactElement } from 'react';
import '@/i18n';
import { ToastProvider, useToast } from '@/components/ui';

// Tiny harness that exposes showToast via a button so we can drive the provider.
function Harness({ onReady }: { onReady: (show: ReturnType<typeof useToast>['showToast']) => void }): ReactElement {
  const { showToast } = useToast();
  onReady(showToast);
  return <div />;
}

function setup(): { show: ReturnType<typeof useToast>['showToast'] } {
  let captured!: ReturnType<typeof useToast>['showToast'];
  render(
    <ToastProvider>
      <Harness onReady={(s) => (captured = s)} />
    </ToastProvider>
  );
  return { show: captured };
}

describe('Toast action', () => {
  it('renders an action button and fires its onClick', () => {
    const onClick = vi.fn();
    const { show } = setup();

    act(() => show('Premium feature', 'info', { label: 'Upgrade', onClick }));

    const btn = screen.getByRole('button', { name: 'Upgrade' });
    expect(screen.getByText('Premium feature')).toBeInTheDocument();

    fireEvent.click(btn);
    expect(onClick).toHaveBeenCalledTimes(1);
    // Toast dismisses after the action runs.
    expect(screen.queryByRole('button', { name: 'Upgrade' })).not.toBeInTheDocument();
  });

  it('renders no action button when none is passed (backward compatible)', () => {
    const { show } = setup();
    act(() => show('Just a message', 'success'));

    expect(screen.getByText('Just a message')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Upgrade' })).not.toBeInTheDocument();
  });
});

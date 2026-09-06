import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import type { ReactElement } from 'react';
import '@/i18n';
import { ToastProvider, useToast, type ToastType } from '@/components/ui';

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

/** The toast item is the `role="status"`/`role="alert"` element. */
function toastItem(type: ToastType = 'info'): HTMLElement {
  return screen.getByRole(type === 'error' ? 'alert' : 'status');
}

function reduceMotion(matches: boolean): void {
  // jsdom ships no `matchMedia`, so it has to be defined, not spied on.
  vi.stubGlobal('matchMedia', (query: string) => ({ matches, media: query }));
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Toast action', () => {
  it('renders an action button and fires its onClick', () => {
    reduceMotion(false);
    const onClick = vi.fn();
    const { show } = setup();

    act(() => show('Premium feature', 'info', { label: 'Upgrade', onClick }));

    const btn = screen.getByRole('button', { name: 'Upgrade' });
    expect(screen.getByText('Premium feature')).toBeInTheDocument();

    fireEvent.click(btn);
    expect(onClick).toHaveBeenCalledTimes(1);

    // The toast now plays its 160ms exit rather than vanishing mid-frame; it
    // is retired on `animationend` (spec §4.5).
    const item = toastItem();
    expect(item.className).toContain('animate-[modal-out_160ms_ease-in]');
    fireEvent.animationEnd(item);
    expect(screen.queryByRole('button', { name: 'Upgrade' })).not.toBeInTheDocument();
  });

  it('renders no action button when none is passed (backward compatible)', () => {
    const { show } = setup();
    act(() => show('Just a message', 'success'));

    expect(screen.getByText('Just a message')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Upgrade' })).not.toBeInTheDocument();
  });
});

describe('Toast appearance', () => {
  it.each([
    ['info', 'bg-dusk'],
    ['success', 'bg-moss'],
    ['error', 'bg-terracotta'],
  ] as const)('paints a 4px %s rail in %s', (type, railClass) => {
    const { show } = setup();
    act(() => show('Message', type));

    const rail = toastItem(type).querySelector('span[aria-hidden="true"]') as HTMLElement;
    expect(rail).toBeInTheDocument();
    expect(rail.className).toContain('w-1');
    expect(rail.className).toContain(railClass);
  });

  it('announces errors assertively and everything else politely', () => {
    const { show } = setup();
    act(() => show('Boom', 'error'));
    expect(toastItem('error')).toHaveAttribute('aria-live', 'assertive');
  });

  it('enters with modal-in and exits with modal-out', () => {
    reduceMotion(false);
    const { show } = setup();
    act(() => show('Saved', 'success'));

    const item = toastItem('success');
    expect(item.className).toContain('animate-[modal-in_240ms_var(--ease-spring)]');
    expect(item.className).toContain('motion-reduce:animate-none');

    fireEvent.click(screen.getByRole('button', { name: /close/i }));
    expect(toastItem('success').className).toContain('animate-[modal-out_160ms_ease-in]');
  });

  it('removes the toast immediately under prefers-reduced-motion', () => {
    reduceMotion(true);
    const { show } = setup();
    act(() => show('Saved', 'success'));

    fireEvent.click(screen.getByRole('button', { name: /close/i }));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('stacks bottom-right above 640px and full-bleed above the nav below it', () => {
    const { show } = setup();
    act(() => show('Message'));

    const stack = toastItem().parentElement as HTMLElement;
    expect(stack.className).toContain('sm:bottom-6');
    expect(stack.className).toContain('sm:right-6');
    expect(stack.className).toContain('sm:w-[360px]');
    expect(stack.className).toContain('max-sm:inset-x-4');
    expect(stack.className).toContain('max-sm:bottom-[calc(var(--nav-h,0px)+var(--nav-inset,0px)+16px)]');
  });
});

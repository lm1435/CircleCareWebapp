import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import type { ReactElement } from 'react';
import '@/i18n';
import esMembers from '@/i18n/es/members.json';
import { ToastProvider, useToast, type ToastType } from '@/components/ui';
import { Modal } from '@/components/ui/Modal';

type Show = ReturnType<typeof useToast>['showToast'];

// Tiny harness that exposes showToast so we can drive the provider.
function Harness({ onReady }: { onReady: (show: Show) => void }): ReactElement {
  const { showToast } = useToast();
  onReady(showToast);
  return <div />;
}

function setup(): { show: Show } {
  let captured!: Show;
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

function region(): HTMLElement {
  return document.querySelector('[data-toast-region]') as HTMLElement;
}

function reduceMotion(matches: boolean): void {
  // jsdom ships no `matchMedia`, so it has to be defined, not spied on.
  vi.stubGlobal('matchMedia', (query: string) => ({ matches, media: query }));
}

/** jsdom has no layout: make every element report a clipped box (content taller than its box). */
function pretendTextIsClipped(): void {
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(96);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(48);
}

afterEach(() => {
  vi.useRealTimers();
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
    expect(item).toHaveAttribute('data-leaving');
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
    act(() => show('Fine', 'success'));
    expect(toastItem('success')).toHaveAttribute('aria-live', 'polite');
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
});

// A stack grows over whatever sits under the region's anchor, so the region
// holds exactly ONE toast: a new one replaces the old (Toast.tsx `showToast`).
describe('one toast at a time', () => {
  it('a second toast REPLACES the first — one node on screen, and it is a new node', () => {
    const { show } = setup();
    act(() => show("Couldn't save your changes. Please try again.", 'error'));
    const first = toastItem('error');

    act(() => show('Premium feature', 'info', { label: 'Upgrade', onClick: vi.fn() }));
    expect(region().children).toHaveLength(1);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(toastItem('info')).toHaveTextContent('Premium feature');
    expect(first.isConnected).toBe(false);
  });

  it('the same failure twice is still one toast — and a fresh node, so it is announced again', () => {
    const { show } = setup();
    act(() => show('Boom', 'error'));
    const first = toastItem('error');
    act(() => show('Boom', 'error'));

    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(toastItem('error')).not.toBe(first);
    expect(first.isConnected).toBe(false);
  });

  it("the replaced toast's timer cannot dismiss its replacement early", () => {
    reduceMotion(true);
    vi.useFakeTimers();
    const { show } = setup();
    act(() => show('First', 'error'));
    act(() => vi.advanceTimersByTime(3000));
    act(() => show('Second', 'error'));

    // 5000ms after the FIRST toast — its timer would fire here.
    act(() => vi.advanceTimersByTime(2500));
    expect(toastItem('error')).toHaveTextContent('Second');

    act(() => vi.advanceTimersByTime(2600));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('auto-dismiss', () => {
  it('dismisses after 5 seconds', () => {
    reduceMotion(true);
    vi.useFakeTimers();
    const { show } = setup();
    act(() => show('Boom', 'error'));
    act(() => vi.advanceTimersByTime(4900));
    expect(toastItem('error')).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(200));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('holds while focus is inside the toast, and restarts the full 5s once focus leaves', () => {
    reduceMotion(true);
    vi.useFakeTimers();
    const { show } = setup();
    act(() => show('Premium feature', 'info', { label: 'Upgrade', onClick: vi.fn() }));
    const upgrade = screen.getByRole('button', { name: 'Upgrade' });

    act(() => upgrade.focus());
    act(() => vi.advanceTimersByTime(20_000));
    expect(toastItem()).toBeInTheDocument();

    act(() => upgrade.blur());
    act(() => vi.advanceTimersByTime(4900));
    expect(toastItem()).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(200));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});

describe('long copy', () => {
  const LONG_ES = esMembers.errors.pendingInviteSeat.replace('{{email}}', 'lucia.fernandez@example.com');

  it('clamps the message to two lines visually while the live region carries the FULL text', () => {
    const { show } = setup();
    act(() => show(LONG_ES, 'error'));
    const item = toastItem('error');
    const message = item.querySelector('[data-toast-message] > p') as HTMLElement;

    expect(message.className.split(/\s+/)).toContain('line-clamp-2');
    expect(message.textContent).toBe(LONG_ES);
    // Nothing is cut from what an assistive technology reads.
    expect(item.textContent).toContain(LONG_ES);
    expect(item.textContent).not.toMatch(/…|\.\.\./);
  });

  it('offers no "More" control when the text fits', () => {
    const { show } = setup();
    act(() => show('Saved', 'success'));
    expect(screen.queryByRole('button', { name: 'More' })).not.toBeInTheDocument();
  });

  it('offers a "More" toggle when the clamp hides text; expanding lifts the clamp, keeps the text, and holds the toast', () => {
    reduceMotion(true);
    pretendTextIsClipped();
    vi.useFakeTimers();
    const { show } = setup();
    act(() => show(LONG_ES, 'error', { label: 'Mejorar', onClick: vi.fn() }));
    const item = toastItem('error');
    const message = item.querySelector('[data-toast-message] > p') as HTMLElement;

    const more = screen.getByRole('button', { name: 'More' });
    expect(more).toHaveAttribute('aria-expanded', 'false');
    expect(more).toHaveAttribute('aria-controls', message.id);
    // A press on it must not pull focus out of an open dialog either.
    expect(fireEvent.mouseDown(more)).toBe(false);

    fireEvent.click(more);
    expect(more).toHaveAttribute('aria-expanded', 'true');
    expect(message.className.split(/\s+/)).not.toContain('line-clamp-2');
    expect(message.textContent).toBe(LONG_ES);

    // Expanded = the reader asked for time: no auto-dismiss.
    act(() => vi.advanceTimersByTime(20_000));
    expect(toastItem('error')).toBe(item);

    fireEvent.click(more);
    expect(more).toHaveAttribute('aria-expanded', 'false');
    expect(message.className.split(/\s+/)).toContain('line-clamp-2');
    act(() => vi.advanceTimersByTime(5100));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

// PLACEMENT IS CSS. jsdom applies no Tailwind, so what is provable here is the
// EXACT utility set the region carries — not "contains": an extra `!top-4`,
// `modal-open:!right-4` or `!w-auto` must fail — and that the `modal-open:`
// variant's real selector (read out of globals.css, not restated) matches
// exactly when a Modal is on screen. The pixels are e2e's
// (toast-page-overlap.spec.ts, toast-modal-overlap.spec.ts).
describe('placement', () => {
  const css = readFileSync(join(__dirname, '..', '..', '..', 'styles', 'globals.css'), 'utf8');
  const variants = [...css.matchAll(/@custom-variant\s+modal-open\s+\((.+)\s+&\);/g)];
  const modalOpenBody = variants[0]?.[1] ?? '';

  const BASE = ['pointer-events-none', 'fixed', 'z-50', 'flex', 'flex-col'];
  // Page: <640 full-bleed at 120px; 640-1023 centred 360px at 76px; >=1024 main-column left.
  const PAGE = [
    'max-sm:inset-x-4',
    'max-sm:top-30',
    'sm:left-[calc(50%-180px)]',
    'sm:top-19',
    'sm:w-[360px]',
    'xl:left-[calc(17rem+1.5rem)]',
  ];
  // Dialog: top-left at 16px, width capped short of the panel's close button.
  const MODAL = [
    'modal-open:left-4',
    'modal-open:right-auto',
    'modal-open:top-[max(1rem,env(safe-area-inset-top))]',
    'modal-open:w-[min(360px,calc(100vw-104px),calc(50vw+108px))]',
  ];

  function renderRegion(): string[] {
    render(
      <ToastProvider>
        <div />
      </ToastProvider>
    );
    return region().className.trim().split(/\s+/);
  }

  const bare = (token: string): string => token.replace(/^([a-z0-9-]+:)+/, '');

  it('the region carries EXACTLY the base, page and dialog placement utilities — nothing more', () => {
    const tokens = renderRegion();
    expect([...tokens].sort()).toEqual([...BASE, ...PAGE, ...MODAL].sort());
    expect(new Set(tokens).size, 'no duplicated utility').toBe(tokens.length);
    expect(tokens.filter((t) => t.includes('!')), 'no !important overrides').toEqual([]);
  });

  it('page state: anchored from the top only — no bottom, no right edge beyond the phone full-bleed', () => {
    const page = renderRegion().filter((t) => !t.startsWith('modal-open:') && !BASE.includes(t));
    expect(page.filter((t) => /^(bottom|inset-y|inset)-/.test(bare(t)) && !/^inset-x-/.test(bare(t)))).toEqual([]);
    expect(page.filter((t) => /^right-/.test(bare(t)))).toEqual([]);
    expect(page.filter((t) => /^-?translate/.test(bare(t)))).toEqual([]);
    // Every breakpoint band sets a top.
    expect(page.filter((t) => /^top-/.test(bare(t)))).toEqual(['max-sm:top-30', 'sm:top-19']);
  });

  it('dialog state: left edge only (its right is released), a top, a capped width — and nothing that fights them', () => {
    const modal = renderRegion().filter((t) => t.startsWith('modal-open:'));
    // Exactly one variant level: `modal-open:` directly on the utility.
    expect(modal.every((t) => /^modal-open:[^:]+$/.test(t))).toBe(true);
    const utilities = modal.map(bare);
    expect(utilities.filter((u) => /^left-/.test(u))).toEqual(['left-4']);
    expect(utilities.filter((u) => /^right-/.test(u)), 'the right edge is only ever released').toEqual(['right-auto']);
    expect(utilities.filter((u) => /^(bottom|inset|-?translate)/.test(u))).toEqual([]);
    expect(utilities.filter((u) => /^top-/.test(u))).toHaveLength(1);
    expect(utilities.filter((u) => /^(w|max-w|min-w)-/.test(u))).toEqual([
      'w-[min(360px,calc(100vw-104px),calc(50vw+108px))]',
    ]);
  });

  it('globals.css declares `modal-open` exactly ONCE (a later duplicate would silently win)', () => {
    expect(variants).toHaveLength(1);
    expect(css.match(/@custom-variant\s+modal-open\b/g)).toHaveLength(1);
    expect(modalOpenBody).toBe('body:has([aria-modal="true"])');
  });

  function Page({ open }: { open: boolean }): ReactElement {
    const { showToast } = useToast();
    return (
      <>
        <button type="button" onClick={() => showToast('Boom', 'error')}>
          raise
        </button>
        {open ? (
          <Modal title="Dialog" closeLabel="Close dialog" onClose={() => {}}>
            <p>body</p>
          </Modal>
        ) : null}
      </>
    );
  }

  const modalOpen = (): boolean => document.body.matches(modalOpenBody);

  it("the variant's selector matches while a Modal is open and not otherwise, and the region is never remounted", () => {
    reduceMotion(true);
    const { rerender } = render(
      <ToastProvider>
        <Page open={false} />
      </ToastProvider>
    );
    fireEvent.click(screen.getByRole('button', { name: 'raise' }));
    const regionBefore = region();
    const toastBefore = screen.getByRole('alert');
    expect(modalOpen()).toBe(false);

    rerender(
      <ToastProvider>
        <Page open />
      </ToastProvider>
    );
    expect(screen.getByRole('dialog', { name: 'Dialog' })).toBeInTheDocument();
    expect(modalOpen()).toBe(true);
    expect(document.querySelector(`${modalOpenBody} [data-toast-region]`)).toBe(region());
    expect(region()).toBe(regionBefore);
    expect(screen.getByRole('alert')).toBe(toastBefore);
    // The toast lives outside the dialog and never took focus.
    expect(screen.getByRole('dialog').contains(toastBefore)).toBe(false);
    expect(toastBefore.contains(document.activeElement)).toBe(false);

    rerender(
      <ToastProvider>
        <Page open={false} />
      </ToastProvider>
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(modalOpen()).toBe(false);
    expect(region()).toBe(regionBefore);
    expect(screen.getByRole('alert')).toBe(toastBefore);
  });

  it('a pointer press on a toast control does not move focus out of the open dialog', () => {
    reduceMotion(true);
    const onClick = vi.fn();
    let show!: Show;
    render(
      <ToastProvider>
        <Harness onReady={(s) => (show = s)} />
        <Modal title="Dialog" closeLabel="Close dialog" onClose={() => {}}>
          <p>body</p>
        </Modal>
      </ToastProvider>
    );
    act(() => show('Premium feature', 'info', { label: 'Upgrade', onClick }));
    const focusedInDialog = document.activeElement;
    expect(screen.getByRole('dialog').contains(focusedInDialog)).toBe(true);

    // `fireEvent` returns false when the handler called preventDefault — the
    // browser's focus-on-mousedown is what that cancels.
    const action = screen.getByRole('button', { name: 'Upgrade' });
    const close = screen.getByRole('button', { name: 'Close' });
    expect(fireEvent.mouseDown(action)).toBe(false);
    expect(fireEvent.mouseDown(close)).toBe(false);

    // The click itself still works.
    fireEvent.click(close);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(document.activeElement).toBe(focusedInDialog);
  });
});

import { type ReactElement } from 'react';
import { act, render, screen } from '@testing-library/react';
import { COARSE_POINTER_QUERY, useCoarsePointer } from '../useCoarsePointer';

function Probe(): ReactElement {
  return <output>{useCoarsePointer() ? 'coarse' : 'fine'}</output>;
}

function pointer(): string {
  return screen.getByRole('status').textContent ?? '';
}

/**
 * A `matchMedia` stand-in whose `matches` a test can flip, plus the `change`
 * listeners the hook registers. jsdom ships no `matchMedia` at all, so this is
 * defined rather than spied on — the idiom `Modal`, `Toast` and
 * `FloatingNavBar`'s tests already use.
 */
function stubMatchMedia(initial: boolean): { set: (next: boolean) => void; queries: string[] } {
  const queries: string[] = [];
  const listeners = new Set<() => void>();
  let matches = initial;
  vi.stubGlobal('matchMedia', (query: string) => {
    queries.push(query);
    return {
      media: query,
      get matches() {
        return matches;
      },
      addEventListener: (_type: string, cb: () => void) => listeners.add(cb),
      removeEventListener: (_type: string, cb: () => void) => listeners.delete(cb),
    };
  });
  return {
    set: (next: boolean) => {
      matches = next;
      act(() => {
        listeners.forEach((cb) => cb());
      });
    },
    queries,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useCoarsePointer', () => {
  it('asks the browser about the pointer, not about the viewport or the UA', () => {
    const media = stubMatchMedia(true);
    render(<Probe />);
    // The whole point of the hook: a width- or UA-based test would be wrong on
    // both a 1280px tablet and a 1280px laptop.
    expect(media.queries).toContain(COARSE_POINTER_QUERY);
    expect(COARSE_POINTER_QUERY).toContain('pointer: coarse');
    expect(COARSE_POINTER_QUERY).toContain('hover: none');
  });

  it('reports coarse when the media query matches', () => {
    stubMatchMedia(true);
    render(<Probe />);
    expect(pointer()).toBe('coarse');
  });

  it('reports fine when it does not', () => {
    stubMatchMedia(false);
    render(<Probe />);
    expect(pointer()).toBe('fine');
  });

  // A 2-in-1 docking a keyboard, or a tablet gaining a trackpad, fires `change`
  // on the list. The fields have to follow it — a stale `true` would leave a
  // docked laptop with no picker trigger at all.
  it('follows a live change in both directions', () => {
    const media = stubMatchMedia(false);
    render(<Probe />);
    expect(pointer()).toBe('fine');

    media.set(true);
    expect(pointer()).toBe('coarse');

    media.set(false);
    expect(pointer()).toBe('fine');
  });

  it('drops its listener on unmount', () => {
    const removeEventListener = vi.fn();
    vi.stubGlobal('matchMedia', (query: string) => ({
      media: query,
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener,
    }));
    render(<Probe />).unmount();
    expect(removeEventListener).toHaveBeenCalledWith('change', expect.any(Function));
  });

  // Safari < 14 has no `addEventListener` on a MediaQueryList.
  it('falls back to the deprecated addListener pair', () => {
    const addListener = vi.fn();
    const removeListener = vi.fn();
    vi.stubGlobal('matchMedia', (query: string) => ({
      media: query,
      matches: true,
      addListener,
      removeListener,
    }));
    const view = render(<Probe />);
    expect(pointer()).toBe('coarse');
    expect(addListener).toHaveBeenCalledTimes(1);
    view.unmount();
    expect(removeListener).toHaveBeenCalledTimes(1);
  });

  // THE FALLBACK, asserted so nobody flips it casually: no `matchMedia` (jsdom,
  // a non-DOM prerender) means FINE, i.e. the pre-gate desktop behavior. Every
  // engine that can render a touchscreen has shipped `matchMedia` for a decade,
  // so this branch is unreachable from a real phone.
  it('answers fine when matchMedia is missing entirely', () => {
    expect(window.matchMedia).toBeUndefined();
    render(<Probe />);
    expect(pointer()).toBe('fine');
  });
});

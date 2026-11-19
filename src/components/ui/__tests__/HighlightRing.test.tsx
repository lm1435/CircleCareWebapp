import { act, cleanup, render, screen } from '@testing-library/react';
import { HighlightRing, HIGHLIGHT_HOLD_MS, HIGHLIGHT_IN_MS, HIGHLIGHT_OUT_MS, HIGHLIGHT_TOTAL_MS } from '../HighlightRing';

// The "you came for this" ring (mobile twin DeepLinkHighlightRing): 2px moss, 200 / 1100 / 450 ms, no fade
// under prefers-reduced-motion, scrolls its row into view (nearest), reports once when it has run.

function motion(reduce: boolean): void {
  window.matchMedia = ((query: string) => ({
    matches: reduce && query.includes('prefers-reduced-motion'),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    onchange: null,
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
}

beforeEach(() => {
  vi.useFakeTimers();
  motion(false);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('HighlightRing', () => {
  it('uses the mobile timings', () => {
    expect([HIGHLIGHT_IN_MS, HIGHLIGHT_HOLD_MS, HIGHLIGHT_OUT_MS, HIGHLIGHT_TOTAL_MS]).toEqual([200, 1100, 450, 1750]);
  });

  it('fades in over 200 ms, holds 1100 ms, fades out over 450 ms, then reports exactly once', () => {
    const onDone = vi.fn();
    render(<div className="relative"><HighlightRing onDone={onDone} /></div>);
    const ring = screen.getByTestId('highlight-ring');
    expect(ring).toHaveClass('border-2', 'border-moss');
    expect(ring).toHaveAttribute('aria-hidden', 'true');
    expect(ring).toHaveAttribute('data-state', 'off');
    act(() => void vi.advanceTimersByTime(1));
    expect(ring).toHaveAttribute('data-state', 'on');
    expect(ring.style.transition).toBe('opacity 200ms linear');
    act(() => void vi.advanceTimersByTime(HIGHLIGHT_IN_MS + HIGHLIGHT_HOLD_MS));
    expect(ring).toHaveAttribute('data-state', 'off');
    expect(ring.style.transition).toBe('opacity 450ms linear');
    expect(onDone).not.toHaveBeenCalled();
    act(() => void vi.advanceTimersByTime(HIGHLIGHT_OUT_MS));
    expect(onDone).toHaveBeenCalledTimes(1);
    act(() => void vi.advanceTimersByTime(5000));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('N15 reduced motion: shown outright with NO fade, removed when the time is up', () => {
    motion(true);
    const onDone = vi.fn();
    render(<div className="relative"><HighlightRing onDone={onDone} /></div>);
    const ring = screen.getByTestId('highlight-ring');
    expect(ring).toHaveAttribute('data-reduced-motion', 'true');
    expect(ring).toHaveAttribute('data-state', 'on');
    expect(ring.style.transition).toBe('none');
    act(() => void vi.advanceTimersByTime(HIGHLIGHT_TOTAL_MS - 1));
    expect(ring).toHaveAttribute('data-state', 'on');
    expect(onDone).not.toHaveBeenCalled();
    act(() => void vi.advanceTimersByTime(1));
    expect(ring).toHaveAttribute('data-state', 'off');
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('scrolls its container into view with block: nearest', () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    render(<div className="relative"><HighlightRing /></div>);
    expect(scroll).toHaveBeenCalledWith({ block: 'nearest', behavior: 'smooth' });
  });

  it('unmounting early cancels the timers: onDone never fires for a ring that is gone', () => {
    const onDone = vi.fn();
    const { unmount } = render(<div className="relative"><HighlightRing onDone={onDone} /></div>);
    unmount();
    act(() => void vi.advanceTimersByTime(5000));
    expect(onDone).not.toHaveBeenCalled();
  });
});

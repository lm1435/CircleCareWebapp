/**
 * BootScreen: the one full-page boot state (AuthGuard's bootstrapping state and
 * App.tsx's Suspense fallback). Parity with mobile's LoadingScreen: the brand mark
 * at the viewport centre with the "CircleCare" wordmark below, a slow breath, and a
 * status line ("Loading...") that only appears after 3 s. No spinner, ring or dots.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import fs from 'node:fs';
import path from 'node:path';
import '@/i18n';
import {
  BootScreen,
  BOOT_STATUS_DELAY_MS,
  BOOT_SESSION_GAP_MS,
  __resetBootSessionForTests,
} from '@/components/BootScreen';

const ROOT = path.join(__dirname, '../../..');

/** Pixel width from a PNG's IHDR chunk. */
function pngWidth(file: string): number {
  return fs.readFileSync(path.join(ROOT, 'public', file)).readUInt32BE(16);
}

beforeEach(() => {
  vi.useFakeTimers();
  __resetBootSessionForTests();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('BootScreen status line', () => {
  it('waits exactly 3 s', () => {
    expect(BOOT_STATUS_DELAY_MS).toBe(3000);
  });

  it('is hidden before 3 s and shown after', () => {
    render(<BootScreen />);
    expect(screen.queryByText('Loading...')).not.toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(BOOT_STATUS_DELAY_MS - 1);
    });
    expect(screen.queryByText('Loading...')).not.toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.getByText('Loading...')).toBeInTheDocument();
  });

  it('reduced motion: same 3 s rule, nothing early', () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn((query: string) => ({
        matches: query.includes('prefers-reduced-motion'),
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }))
    );
    render(<BootScreen />);
    act(() => {
      vi.advanceTimersByTime(BOOT_STATUS_DELAY_MS - 1);
    });
    expect(screen.queryByText('Loading...')).not.toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.getByText('Loading...')).toBeInTheDocument();
  });

  it('is not read twice: the visible line is aria-hidden, the region carries the name', () => {
    render(<BootScreen />);
    act(() => {
      vi.advanceTimersByTime(BOOT_STATUS_DELAY_MS);
    });
    expect(screen.getByText('Loading...')).toHaveAttribute('aria-hidden', 'true');
  });
});

describe('BootScreen accessibility', () => {
  it('announces "Loading" from the first frame, not just an image', () => {
    render(<BootScreen />);
    expect(screen.getByRole('status', { name: 'Loading...' })).toBeInTheDocument();
  });

  it('the wordmark is real text "CircleCare" (never translated), read once; the mark is decorative', () => {
    render(<BootScreen />);
    // Owner decision 2026-11-11: the app's own typeface, not the marketing serif, so it
    // is text in the UI font stack and no longer an image.
    expect(screen.getAllByText('CircleCare')).toHaveLength(1);
    expect(screen.queryByAltText('CircleCare')).not.toBeInTheDocument();
    const wordmark = screen.getByTestId('boot-wordmark');
    expect(wordmark).toHaveTextContent('CircleCare');
    expect(wordmark).not.toHaveAttribute('aria-hidden');
    // Mobile parity: the type scale's 24, medium, slight positive tracking, primary ink.
    expect(wordmark).toHaveClass('text-lg', 'font-medium', 'tracking-[0.4px]', 'text-ink');
    expect(wordmark).toHaveClass('whitespace-nowrap', 'cc-boot-wordmark');
    expect(wordmark.className).not.toMatch(/font-serif|\bserif\b/);
    const marks = [screen.getByTestId('boot-mark-light'), screen.getByTestId('boot-mark-dark')];
    expect(marks.map((el) => el.getAttribute('src'))).toEqual([
      '/logo-mark-384.png',
      '/logo-mark-dark-384.png',
    ]);
    for (const mark of marks) expect(mark).toHaveAttribute('alt', '');
    expect(marks[0]).toHaveClass('cc-logo-mark-light');
    expect(marks[1]).toHaveClass('cc-logo-mark-dark');
  });
});

describe('BootScreen lockup', () => {
  it('has no spinner, ring or dots', () => {
    const { container } = render(<BootScreen />);
    act(() => {
      vi.advanceTimersByTime(BOOT_STATUS_DELAY_MS);
    });
    expect(container.querySelector('.animate-spin')).toBeNull();
    expect(container.querySelector('[class*="rounded-full"]')).toBeNull();
    expect(container.querySelectorAll('img')).toHaveLength(2);
  });

  it('draws the mark in a 120px box whose centre is the viewport centre', () => {
    render(<BootScreen />);
    const lockup = screen.getByTestId('boot-lockup');
    // Top edge at 50% minus half the mark; the wordmark and status hang below.
    expect(lockup).toHaveClass('absolute', 'top-1/2', '-mt-[60px]');
    for (const id of ['boot-mark-light', 'boot-mark-dark']) {
      const mark = screen.getByTestId(id);
      expect(mark).toHaveAttribute('width', '120');
      expect(mark).toHaveAttribute('height', '120');
    }
  });

  it('breathes through CSS only, so the global reduced-motion rule stops it', () => {
    render(<BootScreen />);
    expect(screen.getByTestId('boot-mark-wrap')).toHaveClass('cc-boot-breath');
    const css = fs.readFileSync(path.join(ROOT, 'src/styles/globals.css'), 'utf8');
    expect(css).toMatch(/@keyframes cc-boot-breath\s*\{[^}]*\}\s*50%\s*\{\s*transform:\s*scale\(1\.035\)/);
    // 2600 ms each way, ease-in-out sine.
    expect(css).toMatch(
      /\.cc-boot-breath\s*\{\s*animation:\s*cc-boot-breath 5200ms cubic-bezier\(0\.37, 0, 0\.63, 1\) infinite;/
    );
    expect(css).toMatch(
      /prefers-reduced-motion: reduce\)\s*\{[\s\S]*?animation-duration: 0\.01ms !important;\s*animation-iteration-count: 1 !important;/
    );
  });

  it('ships marks of at least 288px, and no wordmark images', () => {
    expect(pngWidth('logo-mark-384.png')).toBeGreaterThanOrEqual(288);
    expect(pngWidth('logo-mark-dark-384.png')).toBeGreaterThanOrEqual(288);
    expect(fs.existsSync(path.join(ROOT, 'public/circlecare-wordmark.png'))).toBe(false);
    expect(fs.existsSync(path.join(ROOT, 'public/circlecare-wordmark-dark.png'))).toBe(false);
  });
});

describe('BootScreen is wired as the only full-page boot state', () => {
  it('App.tsx uses it as the Suspense fallback', () => {
    const app = fs.readFileSync(path.join(ROOT, 'src/App.tsx'), 'utf8');
    expect(app).toContain('<Suspense fallback={<BootScreen />}>');
    expect(app).not.toContain('FullPageSpinner');
  });
});

/**
 * Boot can mount TWO instances back to back: AuthGuard's while the session bootstraps,
 * then the Suspense fallback while the first lazy page chunk loads. They must read as one
 * screen: the second does not fade the wordmark in again, restart the breath at scale 1,
 * or restart the 3 s status timer. Same rule as mobile's LoadingScreen.
 */
describe('BootScreen is continuous across instances', () => {
  const wordmark = () => screen.getByTestId('boot-wordmark');

  it('first mount: animations start from their beginning', () => {
    render(<BootScreen />);
    expect(wordmark().style.animationDelay).toBe('');
    expect(screen.getByTestId('boot-mark-wrap').style.animationDelay).toBe('');
  });

  it('a second mount carries the wordmark fade and the breath on from the first mount', () => {
    const first = render(<BootScreen />);
    act(() => {
      vi.advanceTimersByTime(700);
    });
    first.unmount();
    render(<BootScreen />);
    // 150 ms delay - 700 ms elapsed: a negative delay puts the 500 ms fade past its end.
    expect(wordmark().style.animationDelay).toBe('-550ms');
    expect(screen.getByTestId('boot-mark-wrap').style.animationDelay).toBe('-700ms');
  });

  it('the status line counts 3 s from the FIRST mount', () => {
    const first = render(<BootScreen />);
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    first.unmount();
    render(<BootScreen />);
    act(() => {
      vi.advanceTimersByTime(999);
    });
    expect(screen.queryByText('Loading...')).not.toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.getByText('Loading...')).toBeInTheDocument();
  });

  it('an instance mounted after the 3 s have passed shows the status line at once', () => {
    const first = render(<BootScreen />);
    act(() => {
      vi.advanceTimersByTime(BOOT_STATUS_DELAY_MS + 200);
    });
    first.unmount();
    render(<BootScreen />);
    expect(screen.getByText('Loading...')).toBeInTheDocument();
  });

  it('a LATER load (no boot screen for over a second) starts fresh', () => {
    const first = render(<BootScreen />);
    act(() => {
      vi.advanceTimersByTime(BOOT_STATUS_DELAY_MS + 200);
    });
    first.unmount();
    act(() => {
      vi.advanceTimersByTime(BOOT_SESSION_GAP_MS + 1);
    });
    render(<BootScreen />);
    expect(screen.queryByText('Loading...')).not.toBeInTheDocument();
    expect(wordmark().style.animationDelay).toBe('');
  });
});


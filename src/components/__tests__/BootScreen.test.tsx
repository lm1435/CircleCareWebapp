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
import { BootScreen, BOOT_STATUS_DELAY_MS } from '@/components/BootScreen';

const ROOT = path.join(__dirname, '../../..');

/** Pixel width from a PNG's IHDR chunk. */
function pngWidth(file: string): number {
  return fs.readFileSync(path.join(ROOT, 'public', file)).readUInt32BE(16);
}

beforeEach(() => {
  vi.useFakeTimers();
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

  it('names the wordmark "CircleCare" (never translated) and keeps the mark decorative', () => {
    render(<BootScreen />);
    // One light + one dark image each; globals.css shows exactly one by data-theme.
    const wordmarks = screen.getAllByAltText('CircleCare');
    expect(wordmarks.map((el) => el.getAttribute('src'))).toEqual([
      '/circlecare-wordmark.png',
      '/circlecare-wordmark-dark.png',
    ]);
    expect(wordmarks[0]).toHaveClass('cc-logo-mark-light');
    expect(wordmarks[1]).toHaveClass('cc-logo-mark-dark');
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
    expect(container.querySelectorAll('img')).toHaveLength(4);
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

  it('ships marks of at least 288px and a wordmark of at least 3x', () => {
    expect(pngWidth('logo-mark-384.png')).toBeGreaterThanOrEqual(288);
    expect(pngWidth('logo-mark-dark-384.png')).toBeGreaterThanOrEqual(288);
    expect(pngWidth('circlecare-wordmark.png')).toBeGreaterThanOrEqual(118 * 3);
    expect(pngWidth('circlecare-wordmark-dark.png')).toBeGreaterThanOrEqual(118 * 3);
  });
});

describe('BootScreen is wired as the only full-page boot state', () => {
  it('App.tsx uses it as the Suspense fallback', () => {
    const app = fs.readFileSync(path.join(ROOT, 'src/App.tsx'), 'utf8');
    expect(app).toContain('<Suspense fallback={<BootScreen />}>');
    expect(app).not.toContain('FullPageSpinner');
  });
});

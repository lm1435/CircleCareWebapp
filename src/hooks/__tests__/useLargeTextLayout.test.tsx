import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  measureLargeText,
  resetLargeTextReports,
  shouldReportLargeText,
  useLargeTextLayout,
} from '../useLargeTextLayout';

// Measured, not guessed: the root font size and the zoom ratio are read from
// the live document and window.

function setWindow(outer: number, inner: number): void {
  Object.defineProperty(window, 'outerWidth', { configurable: true, value: outer });
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: inner });
}

describe('measureLargeText', () => {
  afterEach(() => {
    document.documentElement.style.fontSize = '';
    setWindow(1024, 1024);
    resetLargeTextReports();
  });

  it('is off at the default size and zoom', () => {
    setWindow(1280, 1280);
    expect(measureLargeText()).toBe(false);
  });

  it('is on at 1.5x the root font (24px)', () => {
    document.documentElement.style.fontSize = '24px';
    expect(measureLargeText()).toBe(true);
  });

  it('is off just under it (22px)', () => {
    document.documentElement.style.fontSize = '22px';
    setWindow(1280, 1280);
    expect(measureLargeText()).toBe(false);
  });

  it('is on at 200% browser zoom (outer width is twice the CSS width)', () => {
    setWindow(1440, 720);
    expect(measureLargeText()).toBe(true);
  });

  it('is off at 125% / 150% zoom', () => {
    setWindow(1440, 1152);
    expect(measureLargeText()).toBe(false);
    setWindow(1440, 960);
    expect(measureLargeText()).toBe(false);
  });

  it('survives a window with no measurable width', () => {
    setWindow(0, 0);
    expect(measureLargeText()).toBe(false);
  });
});

describe('useLargeTextLayout', () => {
  afterEach(() => {
    document.documentElement.style.fontSize = '';
    setWindow(1024, 1024);
  });

  it('re-measures on resize (a zoom change fires one)', () => {
    setWindow(1280, 1280);
    const { result } = renderHook(() => useLargeTextLayout());
    expect(result.current).toBe(false);
    act(() => {
      setWindow(1280, 640);
      window.dispatchEvent(new Event('resize'));
    });
    expect(result.current).toBe(true);
    act(() => {
      setWindow(1280, 1280);
      window.dispatchEvent(new Event('resize'));
    });
    expect(result.current).toBe(false);
  });
});

describe('shouldReportLargeText', () => {
  afterEach(() => resetLargeTextReports());

  it('is true once per screen per session', () => {
    expect(shouldReportLargeText('today')).toBe(true);
    expect(shouldReportLargeText('today')).toBe(false);
    expect(shouldReportLargeText('add_menu')).toBe(true);
    expect(shouldReportLargeText('add_menu')).toBe(false);
  });
});

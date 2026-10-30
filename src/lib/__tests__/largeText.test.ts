import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { Analytics } from '../analytics';
import {
  LARGE_TEXT_ROOT_PX,
  chipColumns,
  isLargeTextRoot,
  resetLargeTextReports,
  useLargeTextLayoutEvent,
} from '../largeText';

describe('chipColumns / isLargeTextRoot', () => {
  it('a root font of 24px or more is large text', () => {
    expect(LARGE_TEXT_ROOT_PX).toBe(24);
    expect(isLargeTextRoot(16)).toBe(false);
    expect(isLargeTextRoot(23.9)).toBe(false);
    expect(isLargeTextRoot(24)).toBe(true);
    expect(isLargeTextRoot(32)).toBe(true);
  });

  it('large text is always ONE column, however wide the container', () => {
    expect(chipColumns(32, 1200, 4)).toBe(1);
    expect(chipColumns(24, 900, 4)).toBe(1);
  });

  it('normal text: 4 columns when wide, 2 when medium, 1 when very narrow', () => {
    expect(chipColumns(16, 590, 4)).toBe(4);
    expect(chipColumns(16, 312, 4)).toBe(2);
    expect(chipColumns(16, 240, 4)).toBe(1);
  });

  it('never exceeds the number of chips', () => {
    expect(chipColumns(16, 590, 3)).toBe(3);
    expect(chipColumns(16, 312, 1)).toBe(1);
  });
});

describe('large_text_layout event (once per screen per session)', () => {
  beforeEach(() => {
    resetLargeTextReports();
    vi.restoreAllMocks();
    document.documentElement.style.fontSize = '';
  });

  it('fires once with active=false at normal text size', () => {
    const spy = vi.spyOn(Analytics, 'largeTextLayout').mockImplementation(() => {});
    const { rerender } = renderHook(() => useLargeTextLayoutEvent('meds'));
    rerender();
    renderHook(() => useLargeTextLayoutEvent('meds'));
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith('meds', false);
  });

  it('reports active=true when the root font is enlarged (falsifies the flag)', () => {
    document.documentElement.style.fontSize = '32px';
    const spy = vi.spyOn(Analytics, 'largeTextLayout').mockImplementation(() => {});
    renderHook(() => useLargeTextLayoutEvent('med_form'));
    expect(spy).toHaveBeenCalledWith('med_form', true);
  });

  it('is per screen, and does nothing while disabled', () => {
    const spy = vi.spyOn(Analytics, 'largeTextLayout').mockImplementation(() => {});
    renderHook(() => useLargeTextLayoutEvent('appt_form', false));
    expect(spy).not.toHaveBeenCalled();
    renderHook(() => useLargeTextLayoutEvent('appt_form'));
    renderHook(() => useLargeTextLayoutEvent('meds'));
    expect(spy.mock.calls.map((c) => c[0])).toEqual(['appt_form', 'meds']);
  });
});

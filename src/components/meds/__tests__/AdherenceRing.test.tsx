// The one hand-drawn SVG allowed outside components/ui (spec §6.4), so the
// geometry has no component to lean on — it is asserted here instead.
//
// Trimmed 2026-11-08 (owner: "feels heavy"): a 44px box with a 4px stroke, so
// r = 20 and the circumference is 2π·20 = 125.663…; a half-filled ring is that
// split evenly between dash and gap. Getting the radius or the box wrong is
// invisible in a screenshot (the arc still draws) and wrong in exactly the way
// that matters: the arc would no longer be the number.

import { render, screen } from '@testing-library/react';
import { AdherenceRing, CHART_SIZE, CIRCUMFERENCE, RADIUS, STROKE_WIDTH } from '../AdherenceRing';

function dashArray(): number[] {
  const progress = screen.getByTestId('adherence-ring-progress');
  return (progress.getAttribute('stroke-dasharray') ?? '').split(' ').map(Number);
}

function renderRing(rate: number) {
  return render(<AdherenceRing rate={rate} />);
}

describe('AdherenceRing', () => {
  it('is a small 44px dial with a 4px stroke (r=20)', () => {
    expect(CHART_SIZE).toBe(44);
    expect(STROKE_WIDTH).toBe(4);
    expect(RADIUS).toBe(20);
    expect(CIRCUMFERENCE).toBeCloseTo(125.664, 3);
  });

  it('splits the stroke evenly at 50%', () => {
    renderRing(0.5);
    const [dash, gap] = dashArray();
    expect(dash).toBeCloseTo(62.83, 2);
    expect(gap).toBeCloseTo(62.83, 2);
  });

  it('draws nothing at 0 and a closed ring at 1', () => {
    const { unmount } = renderRing(0);
    expect(dashArray()[0]).toBe(0);
    unmount();

    renderRing(1);
    const [dash, gap] = dashArray();
    expect(dash).toBeCloseTo(CIRCUMFERENCE, 5);
    expect(gap).toBeCloseTo(0, 5);
  });

  // A rate outside 0–1 must not paint an arc longer than the circle:
  // `stroke-dasharray` simply wraps, so 110% would draw as 10%.
  it('clamps a rate the backend should never send', () => {
    const { unmount } = renderRing(1.1);
    expect(dashArray()[0]).toBeCloseTo(CIRCUMFERENCE, 5);
    unmount();

    renderRing(-0.4);
    expect(dashArray()[0]).toBe(0);
  });

  it('starts the arc at twelve o’clock', () => {
    renderRing(0.25);
    expect(screen.getByTestId('adherence-ring-progress')).toHaveAttribute(
      'transform',
      'rotate(-90 22 22)'
    );
  });

  it('paints progress in MOSS on the neutral hairline track', () => {
    renderRing(0.5);
    expect(screen.getByTestId('adherence-ring-progress')).toHaveAttribute('stroke', 'var(--color-moss)');
    expect(screen.getByTestId('adherence-ring-track')).toHaveAttribute('stroke', 'var(--color-line-2)');
  });

  // Decorative: the card's visible "57% taken" is the value, and its sr-only
  // sentence is what assistive tech reads. Nothing drawn inside the ring.
  it('is wholly hidden from assistive tech and has no text inside', () => {
    const { container } = renderRing(0.82);
    expect(container.firstElementChild).toHaveAttribute('aria-hidden', 'true');
    expect(container.textContent).toBe('');
    expect(screen.queryByText('30d')).toBeNull();
  });
});

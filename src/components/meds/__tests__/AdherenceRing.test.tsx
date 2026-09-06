// The one hand-drawn SVG allowed outside components/ui (spec §6.4), so the
// geometry has no component to lean on — it is asserted here instead.
//
// r = 39 (84px box less the 6px stroke, halved), so the circumference is
// 2π·39 = 245.044…; a half-filled ring is that split evenly between dash and
// gap. Getting the radius or the box wrong is invisible in a screenshot (the
// arc still draws) and wrong in exactly the way that matters: the arc would no
// longer be the number.

import { render, screen } from '@testing-library/react';
import { AdherenceRing, CIRCUMFERENCE, RADIUS } from '../AdherenceRing';

function dashArray(): number[] {
  const progress = screen.getByTestId('adherence-ring-progress');
  return (progress.getAttribute('stroke-dasharray') ?? '').split(' ').map(Number);
}

function renderRing(rate: number) {
  return render(<AdherenceRing rate={rate} periodLabel="30d" summary="82% over 30 days" />);
}

describe('AdherenceRing', () => {
  it('derives its circumference from r=39', () => {
    expect(RADIUS).toBe(39);
    expect(CIRCUMFERENCE).toBeCloseTo(245.044, 3);
  });

  it('splits the stroke evenly at 50%', () => {
    renderRing(0.5);
    const [dash, gap] = dashArray();
    expect(dash).toBeCloseTo(122.52, 2);
    expect(gap).toBeCloseTo(122.52, 2);
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
      'rotate(-90 42 42)'
    );
  });

  // The drawing says nothing to a screen reader — a bag of <circle> elements
  // is not a number — so the value reaches assistive tech as one sentence, and
  // the visible "30d" is a period label rather than the value.
  it('is hidden from assistive tech and carries an sr-only summary instead', () => {
    const { container } = renderRing(0.82);

    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    const summary = screen.getByText('82% over 30 days');
    expect(summary.className).toContain('sr-only');
    expect(screen.getByText('30d')).toBeInTheDocument();
  });
});

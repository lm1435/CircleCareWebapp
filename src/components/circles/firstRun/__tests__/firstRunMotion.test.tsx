import { render, screen } from '@testing-library/react';
import '@/i18n';
import { CircleEmblem } from '../CircleEmblem';
import { FlowProgress } from '../FlowProgress';

// First run v2 motion (motion.md): under prefers-reduced-motion every moment renders its END frame
// at once (no animation classes); with motion allowed the keyframe classes are applied.

function setReducedMotion(reduce: boolean): void {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: reduce && query.includes('prefers-reduced-motion: reduce'),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      onchange: null,
      dispatchEvent: () => false,
    }),
  });
}

afterEach(() => setReducedMotion(false));

describe('first run motion', () => {
  it('POSITIVE: with motion allowed the ring draws (cc-fr-ring) and the disc pops', () => {
    setReducedMotion(false);
    const { container } = render(<CircleEmblem initial="R" state="forming" />);
    expect(screen.getByTestId('circle-emblem-ring').getAttribute('class')).toContain('cc-fr-ring');
    expect(container.querySelector('.cc-fr-pop')).not.toBeNull();
  });

  it('NEGATIVE (reduced motion): no animation class anywhere; the ready ring is closed at once', () => {
    setReducedMotion(true);
    const { container } = render(<CircleEmblem initial="R" ownerInitial="M" state="ready" />);
    expect(screen.getByTestId('circle-emblem')).toHaveAttribute('data-reduced-motion', 'true');
    expect(container.querySelector('.cc-fr-ring, .cc-fr-pop, .cc-fr-rise')).toBeNull();
    expect((screen.getByTestId('circle-emblem-ring') as unknown as SVGElement).style.strokeDashoffset).toBe('0');
  });

  it('NEGATIVE: the ring never reports ready (closed) while the create is still forming', () => {
    render(<CircleEmblem initial="R" state="forming" />);
    expect(screen.getByTestId('circle-emblem-ring')).toHaveAttribute('data-closed', 'false');
    expect(screen.queryByTestId('circle-emblem-owner')).not.toBeInTheDocument();
    expect(screen.queryByTestId('circle-emblem-seat')).not.toBeInTheDocument();
  });

  it('POSITIVE: progress is ONE progressbar ("Step 2 of 4"), segments not focusable', () => {
    render(<FlowProgress current={2} />);
    const bar = screen.getByRole('progressbar', { name: 'Step 2 of 4' });
    expect(bar).toHaveAttribute('aria-valuenow', '2');
    expect(bar.querySelectorAll('[data-filled="true"]')).toHaveLength(2);
    expect(bar.querySelectorAll('[tabindex]')).toHaveLength(0);
  });
});

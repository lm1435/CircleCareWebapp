import { render } from '@testing-library/react';
import { Skeleton } from '../Skeleton';

describe('Skeleton', () => {
  it('is aria-hidden and keeps the bg-3 rounded base', () => {
    const { container } = render(<Skeleton />);
    const el = container.firstElementChild as HTMLElement;
    expect(el).toHaveAttribute('aria-hidden', 'true');
    expect(el.className).toContain('rounded-lg');
    expect(el.className).toContain('bg-bg-3');
  });

  it('applies the directional shimmer utility', () => {
    const { container } = render(<Skeleton />);
    // cc-shimmer owns the @keyframes sweep + reduced-motion fallback (globals.css).
    expect((container.firstElementChild as HTMLElement).className).toContain('cc-shimmer');
  });

  it('appends a caller className while preserving the base (existing API)', () => {
    const { container } = render(<Skeleton className="h-4 w-32" />);
    const cls = (container.firstElementChild as HTMLElement).className;
    expect(cls).toContain('h-4');
    expect(cls).toContain('w-32');
    expect(cls).toContain('bg-bg-3');
  });

  it('forwards arbitrary div props', () => {
    const { getByTestId } = render(<Skeleton data-testid="sk" />);
    expect(getByTestId('sk')).toBeInTheDocument();
  });
});

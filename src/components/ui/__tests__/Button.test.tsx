import { createRef } from 'react';
import { render, screen } from '@testing-library/react';
import { Button } from '../Button';

describe('Button', () => {
  it('defaults to the primary variant and type="button"', () => {
    render(<Button>Save</Button>);
    const btn = screen.getByRole('button', { name: 'Save' });
    expect(btn).toHaveAttribute('type', 'button');
    expect(btn.className).toContain('btn');
    expect(btn.className).toContain('btn-primary');
  });

  it('emits no size classes for the default md size (output unchanged)', () => {
    render(<Button>Save</Button>);
    // md is the .btn base — exactly "btn btn-primary", nothing more.
    expect(screen.getByRole('button', { name: 'Save' }).className).toBe('btn btn-primary');
  });

  it('preserves the existing className-append behavior for the default', () => {
    render(<Button className="w-full">Go</Button>);
    expect(screen.getByRole('button', { name: 'Go' }).className).toBe('btn btn-primary w-full');
  });

  it('renders ghost and terracotta variants', () => {
    const { rerender } = render(<Button variant="ghost">G</Button>);
    expect(screen.getByRole('button', { name: 'G' }).className).toContain('btn-ghost');
    rerender(<Button variant="terracotta">T</Button>);
    expect(screen.getByRole('button', { name: 'T' }).className).toContain('btn-terracotta');
  });

  it('adds dense sizing for sm (36px target, smaller type)', () => {
    render(<Button size="sm">S</Button>);
    const cls = screen.getByRole('button', { name: 'S' }).className;
    expect(cls).toContain('min-h-[36px]');
    expect(cls).toContain('text-xs');
  });

  it('adds a larger ≥44px touch target for lg', () => {
    render(<Button size="lg">L</Button>);
    const cls = screen.getByRole('button', { name: 'L' }).className;
    expect(cls).toContain('min-h-[52px]');
    expect(cls).toContain('text-base');
  });

  it('forwards the ref to the underlying button', () => {
    const ref = createRef<HTMLButtonElement>();
    render(<Button ref={ref}>R</Button>);
    expect(ref.current).toBeInstanceOf(HTMLButtonElement);
  });
});

import { render, screen } from '@testing-library/react';
import { Card } from '../Card';

describe('Card', () => {
  it('renders the default (outlined) surface identical to the prior look', () => {
    const { container } = render(<Card>body</Card>);
    // Byte-identical to the pre-variant component output.
    expect((container.firstElementChild as HTMLElement).className).toBe(
      'rounded-2xl border border-line bg-cream p-6'
    );
    expect(screen.getByText('body')).toBeInTheDocument();
  });

  it('preserves the existing className-append behavior for the default', () => {
    const { container } = render(<Card className="mt-4">x</Card>);
    expect((container.firstElementChild as HTMLElement).className).toBe(
      'rounded-2xl border border-line bg-cream p-6 mt-4'
    );
  });

  it('opts into a raised elevated card with a soft ink shadow + tighter radius', () => {
    const { container } = render(<Card variant="elevated">x</Card>);
    const cls = (container.firstElementChild as HTMLElement).className;
    expect(cls).toContain('rounded-[20px]');
    expect(cls).toContain('shadow-[');
    expect(cls).toContain('bg-cream');
  });

  it('renders a borderless flat surface', () => {
    const { container } = render(<Card variant="flat">x</Card>);
    const cls = (container.firstElementChild as HTMLElement).className;
    expect(cls).toContain('bg-cream');
    expect(cls).not.toContain('border-line');
  });

  it('forwards arbitrary div props', () => {
    render(<Card data-testid="card">x</Card>);
    expect(screen.getByTestId('card')).toBeInTheDocument();
  });
});

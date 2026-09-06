import { render, screen } from '@testing-library/react';
import { Icon } from '../Icon';
import { ICON_FILES, ICON_NAMES } from '../iconNames';

describe('Icon', () => {
  it('renders an svg child with width/height 20 by default (size="row")', () => {
    const { container } = render(<Icon name="home-outline" />);
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute('width')).toBe('20');
    expect(svg?.getAttribute('height')).toBe('20');
  });

  it('size="chrome" renders 24', () => {
    const { container } = render(<Icon name="home-outline" size="chrome" />);
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('width')).toBe('24');
    expect(svg?.getAttribute('height')).toBe('24');
  });

  it('size={13} renders 13', () => {
    const { container } = render(<Icon name="home-outline" size={13} />);
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('width')).toBe('13');
    expect(svg?.getAttribute('height')).toBe('13');
  });

  it('unlabelled: svg is aria-hidden and the span has no role', () => {
    const { container } = render(<Icon name="home-outline" />);
    const svg = container.querySelector('svg');
    const span = container.querySelector('span');
    expect(svg?.getAttribute('aria-hidden')).toBe('true');
    expect(span?.getAttribute('role')).toBeNull();
  });

  it('label="Add": span gets role="img" and aria-label, no aria-hidden on the svg', () => {
    render(<Icon name="add-outline" label="Add" />);
    const img = screen.getByRole('img', { name: 'Add' });
    expect(img.tagName).toBe('SPAN');
    const svg = img.querySelector('svg');
    expect(svg?.hasAttribute('aria-hidden')).toBe(false);
  });

  it('throws for an unknown icon name', () => {
    // @ts-expect-error — deliberately passing a name outside IconName for the test
    expect(() => render(<Icon name="not-a-real-icon" />)).toThrow('Unknown icon: not-a-real-icon');
  });

  it('applies className to the span', () => {
    const { container } = render(<Icon name="home-outline" className="text-moss" />);
    const span = container.querySelector('span');
    expect(span?.className).toContain('text-moss');
  });

  it('rendered svg contains fill="currentColor"', () => {
    const { container } = render(<Icon name="home-outline" />);
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('fill')).toBe('currentColor');
  });

  it('ICON_FILES has exactly the keys in ICON_NAMES (a name without a file would throw at render)', () => {
    expect(Object.keys(ICON_FILES).sort()).toEqual([...ICON_NAMES].sort());
    for (const name of ICON_NAMES) expect(ICON_FILES[name]).toContain('<svg');
  });
});

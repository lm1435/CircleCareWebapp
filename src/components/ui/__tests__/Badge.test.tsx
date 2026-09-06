import { render, screen } from '@testing-library/react';
import { Badge } from '../Badge';

describe('Badge', () => {
  it('renders sentence-case children with no uppercase transform', () => {
    render(<Badge>Owner</Badge>);
    const badge = screen.getByText('Owner');
    expect(badge.className).not.toContain('uppercase');
    expect(badge.className).not.toMatch(/tracking-/);
  });

  it('defaults to the `default` variant (hairline ground, ink-2 text) at size md', () => {
    render(<Badge>Caregiver</Badge>);
    const badge = screen.getByText('Caregiver');
    expect(badge.className).toContain('bg-line-2');
    expect(badge.className).toContain('text-ink-2');
    expect(badge.className).toContain('px-3');
    expect(badge.className).toContain('py-1');
    expect(badge.className).toContain('rounded-full');
  });

  it.each([
    ['primary', 'bg-moss-soft', 'text-moss-deep'],
    ['success', 'bg-moss-soft', 'text-moss-deep'],
    ['accent', 'bg-clay-line', 'text-clay-deep'],
    ['warning', 'bg-amber-soft', 'text-amber-deep'],
    ['error', 'bg-terracotta-soft', 'text-terracotta-deep'],
    ['coral', 'bg-coral-soft', 'text-coral-deep'],
    ['dusk', 'bg-dusk-soft', 'text-dusk-deep'],
  ] as const)('variant %s pairs %s with %s', (variant, bg, text) => {
    render(<Badge variant={variant}>Label</Badge>);
    const badge = screen.getByText('Label');
    expect(badge.className).toContain(bg);
    expect(badge.className).toContain(text);
  });

  it('size sm tightens the padding and keeps the 12px text', () => {
    render(
      <Badge size="sm" variant="primary">
        Owner
      </Badge>
    );
    const badge = screen.getByText('Owner');
    expect(badge.className).toContain('px-2');
    expect(badge.className).toContain('py-0.5');
    expect(badge.className).toContain('text-xs');
    expect(badge.className).not.toContain('px-3');
  });

  it('renders an optional leading icon at the meta (14px) tier', () => {
    const { container } = render(<Badge icon="lock-closed-outline">Read only</Badge>);
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('width')).toBe('14');
    expect(svg?.getAttribute('height')).toBe('14');
  });

  it('renders no icon element when `icon` is omitted', () => {
    const { container } = render(<Badge>Read only</Badge>);
    expect(container.querySelector('svg')).toBeNull();
  });
});

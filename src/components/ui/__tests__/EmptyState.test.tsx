import { render, screen } from '@testing-library/react';
import { EmptyState } from '../EmptyState';

describe('EmptyState', () => {
  it('renders the icon tile, title, and description', () => {
    render(
      <EmptyState
        icon={<svg data-testid="glyph" />}
        title="No documents yet"
        description="They will appear here."
      />
    );
    expect(screen.getByTestId('glyph')).toBeInTheDocument();
    expect(screen.getByText('No documents yet')).toBeInTheDocument();
    expect(screen.getByText('They will appear here.')).toBeInTheDocument();
  });

  it('omits the description when not provided', () => {
    render(<EmptyState icon={<svg />} title="Empty" />);
    expect(screen.getByText('Empty')).toBeInTheDocument();
    expect(screen.queryByText('They will appear here.')).not.toBeInTheDocument();
  });

  it('renders the title as a real h2 carrying the h3 type variant (spec §4.5)', () => {
    render(<EmptyState icon={<svg />} title="Empty" />);
    const heading = screen.getByRole('heading', { level: 2, name: 'Empty' });
    // An empty state IS the section's content while it shows; leaving it out of
    // the outline strands screen-reader users in an unlabelled region.
    expect(heading.tagName).toBe('H2');
    expect(heading.className).toContain('text-base');
    expect(heading.className).toContain('font-semibold');
  });

  it('renders the title as a real h1 when titleAs="h1", keeping the h3 type variant', () => {
    render(<EmptyState icon={<svg />} title="Welcome to Premium!" titleAs="h1" />);
    const heading = screen.getByRole('heading', { level: 1, name: 'Welcome to Premium!' });
    expect(heading.tagName).toBe('H1');
    // Visual size/weight is unchanged — only the tag moves.
    expect(heading.className).toContain('text-base');
    expect(heading.className).toContain('font-semibold');
    expect(screen.queryByRole('heading', { level: 2 })).not.toBeInTheDocument();
  });

  it('defaults titleAs to h2 (unchanged behavior)', () => {
    render(<EmptyState icon={<svg />} title="Empty" />);
    expect(screen.getByRole('heading', { level: 2, name: 'Empty' })).toBeInTheDocument();
  });

  it('renders the action slot from `actions`', () => {
    render(
      <EmptyState icon={<svg />} title="Empty" actions={<button>Download the app</button>} />
    );
    expect(screen.getByRole('button', { name: 'Download the app' })).toBeInTheDocument();
  });

  it('still renders the action slot from `children` (older call sites)', () => {
    render(
      <EmptyState icon={<svg />} title="Empty">
        <button>Download the app</button>
      </EmptyState>
    );
    expect(screen.getByRole('button', { name: 'Download the app' })).toBeInTheDocument();
  });

  it('omits the action wrapper entirely when there is no action', () => {
    const { container } = render(<EmptyState icon={<svg />} title="Empty" />);
    expect(container.querySelector('.mt-6')).toBeNull();
  });

  it('accepts an IconName and renders it at the chrome (24px) tier in the tone color', () => {
    const { container } = render(
      <EmptyState icon="document-text-outline" tone="clay" title="No documents yet" />
    );
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('width')).toBe('24');
    expect(svg?.getAttribute('height')).toBe('24');
    expect(svg?.parentElement?.className).toContain('text-clay');
  });

  it.each([
    ['moss', 'bg-moss-soft', 'text-moss'],
    ['clay', 'bg-clay-soft', 'text-clay'],
    ['dusk', 'bg-dusk-soft', 'text-dusk'],
    ['terracotta', 'bg-terracotta-soft', 'text-terracotta'],
    ['coral', 'bg-coral-soft', 'text-coral'],
    ['neutral', 'bg-bg-2', 'text-ink-2'],
  ] as const)('tone %s tints the tile %s with a %s glyph', (tone, tile, glyph) => {
    const { container } = render(
      <EmptyState icon="document-text-outline" tone={tone} title="Empty" />
    );
    const tileEl = container.querySelector('span[aria-hidden="true"]');
    expect(tileEl?.className).toContain(tile);
    expect(tileEl?.className).toContain('w-14');
    expect(tileEl?.className).toContain('h-14');
    // Circle, not the old squircle.
    expect(tileEl?.className).toContain('rounded-full');
    expect(tileEl?.querySelector('span')?.className).toContain(glyph);
  });

  it('defaults to the neutral tone', () => {
    const { container } = render(<EmptyState icon={<svg />} title="Empty" />);
    expect(container.querySelector('span[aria-hidden="true"]')?.className).toContain('bg-bg-2');
  });

  it('caps the description width and centers the block', () => {
    const { container } = render(
      <EmptyState icon={<svg />} title="Empty" description="Some supporting copy." />
    );
    expect(container.firstElementChild?.className).toContain('py-16');
    expect(container.firstElementChild?.className).toContain('px-8');
    expect(screen.getByText('Some supporting copy.').className).toContain('max-w-[280px]');
  });

  it('treats a non-IconName string icon as content, not a glyph lookup', () => {
    // Guards the `isIconName` narrowing: a stray string must never reach Icon,
    // which throws on an unknown name.
    expect(() => render(<EmptyState icon="not-an-icon" title="Empty" />)).not.toThrow();
    expect(screen.getByText('not-an-icon')).toBeInTheDocument();
  });
});

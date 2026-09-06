import { render, screen } from '@testing-library/react';
import '@/i18n';
import { StoreBadges } from '@/components/layout/StoreBadges';
import { APP_STORE_URL, PLAY_STORE_URL } from '@/lib/storeLinks';

describe('StoreBadges', () => {
  it('links both stores with the full accessible name', () => {
    render(<StoreBadges />);

    expect(screen.getByRole('link', { name: 'Download on the App Store' })).toHaveAttribute(
      'href',
      APP_STORE_URL
    );
    expect(screen.getByRole('link', { name: 'Get it on Google Play' })).toHaveAttribute(
      'href',
      PLAY_STORE_URL
    );
  });

  it('opens the stores in a new tab without leaking the opener', () => {
    render(<StoreBadges />);

    for (const link of screen.getAllByRole('link')) {
      expect(link).toHaveAttribute('target', '_blank');
      expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    }
  });

  it('wears the spec §4.5 badge shell: r16, hairline, 44 minimum, spring lift', () => {
    render(<StoreBadges />);

    for (const link of screen.getAllByRole('link')) {
      expect(link.className).toContain('rounded-lg');
      expect(link.className).toContain('border border-cream/15');
      expect(link.className).toContain('bg-ink');
      expect(link.className).toContain('min-h-[44px]');
      expect(link.className).toContain('duration-fast');
      expect(link.className).toContain('ease-spring');
    }
  });

  it('types the lead line with the mono variant, not a hand-set 10px', () => {
    render(<StoreBadges />);

    const lead = screen.getByText('Download on the');
    expect(lead.className).toContain('text-xs');
    expect(lead.className).not.toContain('text-[10px]');
    // `mono` paints ink-3, so the cream override has to be the `!` form to win.
    expect(lead.className).toContain('text-cream/80!');
  });

  it('sets the store name at the dense 16px step', () => {
    render(<StoreBadges />);

    expect(screen.getByText('App Store').className).toContain('text-md font-semibold');
    expect(screen.getByText('Google Play').className).toContain('text-md font-semibold');
  });

  it('layout="stack" gives each badge full width; layout="row" does not', () => {
    const { unmount } = render(<StoreBadges layout="stack" />);
    for (const link of screen.getAllByRole('link')) {
      expect(link.className).toContain('w-full');
    }
    unmount();

    render(<StoreBadges layout="row" />);
    for (const link of screen.getAllByRole('link')) {
      expect(link.className).not.toContain('w-full');
    }
  });

  it('the brand glyphs are decorative — the anchor label carries the name', () => {
    const { container } = render(<StoreBadges />);

    const svgs = container.querySelectorAll('svg');
    expect(svgs).toHaveLength(2);
    for (const svg of svgs) {
      expect(svg.getAttribute('aria-hidden')).toBe('true');
      expect(svg.getAttribute('focusable')).toBe('false');
    }
  });
});

import { render, screen } from '@testing-library/react';
import '@/i18n';
import { StorageBar } from '../StorageBar';

// Spec §6.6: hidden below 80% (footnote only), a visible bar from 80% (clay),
// terracotta + upgrade CTA at 100%+.
describe('StorageBar', () => {
  it('renders only the footnote below 80% usage', () => {
    const { container } = render(<StorageBar usedBytes={79} limitBytes={100} />);

    expect(screen.getByText('79 B of 100 B used')).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(container.querySelector('.bg-clay')).toBeNull();
    expect(container.querySelector('.bg-terracotta')).toBeNull();
  });

  it('renders the bar in clay at 80% usage', () => {
    const { container } = render(<StorageBar usedBytes={80} limitBytes={100} />);

    const track = screen.getByRole('progressbar');
    expect(track).toHaveAttribute('aria-valuenow', '80');
    expect(track).toHaveAttribute('aria-valuemin', '0');
    expect(track).toHaveAttribute('aria-valuemax', '100');
    expect(container.querySelector('.bg-clay')).toBeInTheDocument();
    expect(container.querySelector('.bg-terracotta')).toBeNull();
    expect(screen.getByText('80 B used')).toBeInTheDocument();
    expect(screen.getByText('20 B remaining')).toBeInTheDocument();
    // Not full yet — no message, no Upgrade button.
    expect(screen.queryByRole('button', { name: 'Upgrade' })).not.toBeInTheDocument();
  });

  it('renders terracotta, the full message, and Upgrade for owners at 100%', () => {
    const onUpgrade = vi.fn();
    const { container } = render(
      <StorageBar usedBytes={100} limitBytes={100} onUpgrade={onUpgrade} isOwner />
    );

    const track = screen.getByRole('progressbar');
    expect(track).toHaveAttribute('aria-valuenow', '100');
    expect(container.querySelector('.bg-terracotta')).toBeInTheDocument();
    expect(container.querySelector('.bg-clay')).toBeNull();
    expect(screen.getByText('Storage full. Upgrade for more space.')).toBeInTheDocument();

    const upgradeButton = screen.getByRole('button', { name: 'Upgrade' });
    upgradeButton.click();
    expect(onUpgrade).toHaveBeenCalledTimes(1);
  });

  it('hides the Upgrade button at 100% for non-owners', () => {
    render(<StorageBar usedBytes={100} limitBytes={100} isOwner={false} />);

    expect(screen.getByText('Storage full. Upgrade for more space.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Upgrade' })).not.toBeInTheDocument();
  });

  it('clamps the visual fill and aria-valuenow at 100 past full', () => {
    const { container } = render(<StorageBar usedBytes={150} limitBytes={100} />);

    const track = screen.getByRole('progressbar');
    expect(track).toHaveAttribute('aria-valuenow', '100');
    const fill = container.querySelector('.bg-terracotta') as HTMLElement | null;
    expect(fill).not.toBeNull();
    expect(fill?.style.width).toBe('100%');
  });
});

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

  // Storage is the circle OWNER's tier: a non-owner's own purchase adds no
  // space, so they are never told to "Upgrade" -- they are told who can.
  it('hides the Upgrade button at 100% for non-owners and names the owner who can upgrade', () => {
    render(<StorageBar usedBytes={100} limitBytes={100} isOwner={false} ownerName="Ana" />);

    expect(
      screen.getByText('Storage full. Only Ana, the circle owner, can upgrade for more space.')
    ).toBeInTheDocument();
    expect(screen.queryByText('Storage full. Upgrade for more space.')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Upgrade' })).not.toBeInTheDocument();
  });

  it('non-owner with no known owner name gets the nameless owner-only copy', () => {
    render(<StorageBar usedBytes={100} limitBytes={100} isOwner={false} />);

    expect(
      screen.getByText('Storage full. Only the circle owner can upgrade for more space.')
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Upgrade' })).not.toBeInTheDocument();
  });

  // A PREMIUM circle at its 1GB cap: there is no bigger plan, so nobody is
  // sold anything -- owner or not, the only remedy is deleting files.
  it.each([
    ['owner', true],
    ['non-owner', false],
  ])('premium circle at its cap (%s): no Upgrade, copy that does not sell', (_who, isOwner) => {
    render(
      <StorageBar
        usedBytes={100}
        limitBytes={100}
        isFreeTier={false}
        isOwner={isOwner}
        ownerName="Ana"
        onUpgrade={vi.fn()}
      />
    );

    expect(
      screen.getByText('Storage full. Delete files you no longer need to free up space.')
    ).toBeInTheDocument();
    expect(screen.queryByText(/upgrade/i)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Upgrade' })).not.toBeInTheDocument();
  });

  // Base terracotta is never text on the web (ADA rule); the deep token is
  // 7.29:1 on the page background (#fbf9f5), 7.67:1 on white.
  it('renders the full message in terracotta-deep, never base terracotta', () => {
    render(<StorageBar usedBytes={100} limitBytes={100} isOwner onUpgrade={vi.fn()} />);

    const message = screen.getByText('Storage full. Upgrade for more space.');
    expect(message.className).toContain('text-terracotta-deep');
    expect(message.className.split(/\s+/)).not.toContain('text-terracotta');
  });

  it('the owner keeps the unchanged copy even when an owner name is passed', () => {
    render(<StorageBar usedBytes={100} limitBytes={100} isOwner ownerName="Ana" onUpgrade={vi.fn()} />);

    expect(screen.getByText('Storage full. Upgrade for more space.')).toBeInTheDocument();
    expect(screen.queryByText(/circle owner/)).toBeNull();
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

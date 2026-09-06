import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '@/i18n';
import { SettingsRows } from '../SettingsRows';

function renderRows(isOwner: boolean): void {
  render(
    <MemoryRouter>
      <SettingsRows circleId="c1" isOwner={isOwner} />
    </MemoryRouter>
  );
}

describe('SettingsRows', () => {
  it('routes Edit circle and Members into this circle', () => {
    renderRows(true);
    expect(screen.getByRole('link', { name: /Edit circle/ })).toHaveAttribute(
      'href',
      '/circles/c1/settings'
    );
    expect(screen.getByRole('link', { name: /Members/ })).toHaveAttribute(
      'href',
      '/circles/c1/members'
    );
  });

  it('offers Delete circle to the owner, pointed at the danger zone', () => {
    renderRows(true);
    expect(screen.getByRole('link', { name: /Delete circle/ })).toHaveAttribute(
      'href',
      '/circles/c1/settings#danger'
    );
  });

  // The backend rejects a delete from anyone but the owner; the row is not
  // offered rather than offered-and-refused.
  it('hides Delete circle from non-owners', () => {
    renderRows(false);
    expect(screen.queryByRole('link', { name: /Delete circle/ })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Edit circle/ })).toBeInTheDocument();
  });

  it('heads the block with the "Manage" section title', () => {
    renderRows(true);
    expect(screen.getByRole('heading', { name: 'Manage' })).toBeInTheDocument();
  });
});

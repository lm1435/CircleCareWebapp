import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import '@/i18n';
import { Sidebar } from '@/components/layout/Sidebar';

function renderSidebar(initialPath = '/circles/c1/calendar'): void {
  render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path="/circles/:circleId/:section" element={<Sidebar />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('Sidebar', () => {
  it('renders all nav links scoped to the current circle', () => {
    renderSidebar();

    // Home points at the circle overview (index route, no section segment).
    expect(screen.getByRole('link', { name: 'Home' })).toHaveAttribute('href', '/circles/c1');
    expect(screen.getByRole('link', { name: 'Calendar' })).toHaveAttribute(
      'href',
      '/circles/c1/calendar'
    );
    expect(screen.getByRole('link', { name: 'Activity' })).toHaveAttribute(
      'href',
      '/circles/c1/activity'
    );
    expect(screen.getByRole('link', { name: 'Emergency Info' })).toHaveAttribute(
      'href',
      '/circles/c1/emergency'
    );
    expect(screen.getByRole('link', { name: 'Documents' })).toHaveAttribute(
      'href',
      '/circles/c1/documents'
    );
    expect(screen.getByRole('link', { name: 'Members' })).toHaveAttribute(
      'href',
      '/circles/c1/members'
    );
  });

  it('marks only the current section link as active', () => {
    renderSidebar('/circles/c1/calendar');

    expect(screen.getByRole('link', { name: 'Calendar' })).toHaveAttribute(
      'aria-current',
      'page'
    );
    expect(screen.getByRole('link', { name: 'Activity' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('link', { name: 'Members' })).not.toHaveAttribute('aria-current');
  });

  it('groups Emergency and Documents under a Health label', () => {
    renderSidebar();

    expect(screen.getByText('Health')).toBeInTheDocument();
    const healthList = screen.getByRole('list', { name: 'Health' });
    expect(healthList).toContainElement(screen.getByRole('link', { name: 'Emergency Info' }));
    expect(healthList).toContainElement(screen.getByRole('link', { name: 'Documents' }));
  });

  it('no longer renders an inline Today\'s Meds widget (it lives on the Home overview)', () => {
    renderSidebar();
    expect(screen.queryByTestId('todays-meds')).not.toBeInTheDocument();
  });

  it('renders the download-app CTA with store links', () => {
    renderSidebar();

    expect(screen.getByText('Get the full experience.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Download on the App Store' })).toHaveAttribute(
      'href',
      'https://apps.apple.com/app/id6757629684'
    );
    expect(screen.getByRole('link', { name: 'Get it on Google Play' })).toHaveAttribute(
      'href',
      'https://play.google.com/store/apps/details?id=com.circlecare.circlecare'
    );
  });
});

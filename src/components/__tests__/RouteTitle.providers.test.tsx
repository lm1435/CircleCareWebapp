import { render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { HelmetProvider } from 'react-helmet-async';
import '@/i18n';
import { RouteTitle } from '../RouteTitle';

// Every route needs its own document title (WCAG 2.4.2): a doctor's Visits & notes
// page is /circles/:id/providers/:providerId.
describe('RouteTitle: Visits & notes', () => {
  it('titles /circles/:id/providers/:providerId', async () => {
    render(
      <HelmetProvider>
        <MemoryRouter initialEntries={['/circles/c1/providers/p1']}>
          <RouteTitle />
        </MemoryRouter>
      </HelmetProvider>
    );
    await waitFor(() => expect(document.title).toBe('Visits & notes · CircleCare'));
  });
});

describe('RouteTitle: one circle\'s notifications', () => {
  it('titles /circles/:id/notifications', async () => {
    render(
      <HelmetProvider>
        <MemoryRouter initialEntries={['/circles/c1/notifications']}>
          <RouteTitle />
        </MemoryRouter>
      </HelmetProvider>
    );
    await waitFor(() => expect(document.title).toBe('Notifications · CircleCare'));
  });
});

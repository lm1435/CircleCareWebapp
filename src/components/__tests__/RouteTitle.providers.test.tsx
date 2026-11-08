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

// The profile page IS Settings (four grouped lists, approved design 6): its tab reads
// "Settings", on the list and on every section page it opens.
describe('RouteTitle: Settings', () => {
  it.each(['/profile', '/profile/notifications'])('titles %s "Settings"', async (path) => {
    render(
      <HelmetProvider>
        <MemoryRouter initialEntries={[path]}>
          <RouteTitle />
        </MemoryRouter>
      </HelmetProvider>
    );
    await waitFor(() => expect(document.title).toBe('Settings · CircleCare'));
  });
});

import { render, screen, waitFor } from '@testing-library/react';
import { HelmetProvider } from 'react-helmet-async';
import { MemoryRouter } from 'react-router-dom';
import '@/i18n';
import NotFoundPage from '@/pages/NotFoundPage';

// The 404 page replaces the old silent wildcard redirect to /circles: unknown
// URLs now explain themselves and offer a single way home.

function renderPage() {
  render(
    <HelmetProvider>
      <MemoryRouter initialEntries={['/definitely/not/a/route']}>
        <NotFoundPage />
      </MemoryRouter>
    </HelmetProvider>
  );
}

describe('NotFoundPage', () => {
  it('renders the not-found heading and reassurance body', () => {
    renderPage();

    expect(screen.getByRole('heading', { name: "We couldn't find that page" })).toBeInTheDocument();
    expect(
      screen.getByText(
        'The link may be old or mistyped. Your circles are still right where you left them.'
      )
    ).toBeInTheDocument();
  });

  it('links home to /circles', () => {
    renderPage();

    expect(screen.getByRole('link', { name: 'Go to my circles' })).toHaveAttribute(
      'href',
      '/circles'
    );
  });

  it('sets a descriptive document title', async () => {
    renderPage();

    await waitFor(() => expect(document.title).toBe('Page not found · CircleCare'));
  });
});

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HelmetProvider } from 'react-helmet-async';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import i18n from '@/i18n';
import HelpPage from '@/pages/HelpPage';
import HelpArticlePage from '@/pages/HelpArticlePage';
import HelpCategoryPage from '@/pages/HelpCategoryPage';
import { HELP_FIXTURE } from '@/help/__tests__/fixture';

// In-app help center (docs/plans/in-app-help.md): hub (search / Popular /
// categories), article (video / steps / body / related / contact) and the
// analytics each fires. Content comes from a fixture in the plan's shape.

vi.mock('@/help/content', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/help/content')>()),
  getBundledHelpContent: () => HELP_FIXTURE,
}));

const mocks = vi.hoisted(() => ({
  helpItemExpanded: vi.fn(),
  helpCenterOpened: vi.fn(),
  helpArticleViewed: vi.fn(),
  helpSearchUsed: vi.fn(),
  helpVideoStarted: vi.fn(),
  helpVideoCompleted: vi.fn(),
  helpVideoFailed: vi.fn(),
}));
vi.mock('@/lib/analytics', () => ({ Analytics: mocks }));

function renderApp(initial: string | { pathname: string; state?: unknown }): void {
  render(
    <HelmetProvider>
      <MemoryRouter initialEntries={[initial]}>
        <Routes>
          <Route path="/help" element={<HelpPage />} />
          <Route path="/help/c/:category" element={<HelpCategoryPage />} />
          <Route path="/help/:slug" element={<HelpArticlePage />} />
        </Routes>
      </MemoryRouter>
    </HelmetProvider>
  );
}

beforeEach(async () => {
  vi.clearAllMocks();
  await i18n.changeLanguage('en');
});

describe('Help hub', () => {
  it('shows search, Popular (titles only), Browse rows and the contact card', () => {
    renderApp('/help');
    expect(screen.getByRole('searchbox', { name: 'Search help' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Popular' })).toBeInTheDocument();
    const popular = screen.getByRole('list', { name: 'Popular' });
    expect(popular.querySelectorAll('li')).toHaveLength(2);
    expect(within(popular).queryByText('Send an invite by email.')).toBeNull();

    expect(screen.getByRole('heading', { level: 2, name: 'Browse' })).toBeInTheDocument();
    const browse = screen.getByRole('list', { name: 'Browse' });
    const rows = within(browse).getAllByRole('link');
    expect(rows.map((r) => r.getAttribute('aria-label'))).toEqual([
      'Getting started, 1 article',
      'Daily care, 1 article',
    ]);
    expect(rows[0]).toHaveAttribute('href', '/help/c/getting-started');
    expect(rows[1]).toHaveAttribute('href', '/help/c/care');
    expect(within(rows[0]).getByText('1 article')).toBeInTheDocument();
    expect(within(rows[0]).queryByText('Send an invite by email.')).toBeNull();
    expect(within(browse).queryByText('Empty')).toBeNull();
    // Article rows of a category are not on the home any more.
    expect(screen.queryByRole('list', { name: 'Daily care' })).toBeNull();

    expect(screen.getByTestId('help-contact-card')).toBeInTheDocument();
    // With bundled content the legacy FAQ is gone (Browse replaces it, as on mobile),
    // and the contact card is not doubled.
    expect(screen.queryByRole('button', { name: 'Getting started' })).toBeNull();
    expect(screen.getAllByRole('link', { name: 'Email support' })).toHaveLength(1);
  });

  it('caps Popular at the first 3 slugs', () => {
    renderApp('/help');
    expect(screen.getByRole('list', { name: 'Popular' }).querySelectorAll('li').length).toBeLessThanOrEqual(3);
  });

  it('search replaces Popular and Browse and shows title plus a truncated summary', async () => {
    const user = userEvent.setup();
    renderApp('/help');
    await user.type(screen.getByRole('searchbox', { name: 'Search help' }), 'invite');
    expect(screen.queryByRole('heading', { name: 'Popular' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Browse' })).toBeNull();
    const results = screen.getByRole('list', { name: 'Results' });
    const summary = within(results).getByText('Send an invite by email.');
    expect(summary).toHaveClass('truncate');
  });

  it('opens a category from Browse and an article from the category with source hub', async () => {
    const user = userEvent.setup();
    renderApp('/help');
    await user.click(screen.getByRole('link', { name: 'Daily care, 1 article' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Daily care' })).toBeInTheDocument();
    await user.click(screen.getByRole('link', { name: 'Add a medication' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Add a medication' })).toBeInTheDocument();
    expect(mocks.helpArticleViewed).toHaveBeenCalledWith({
      slug: 'add-a-medication',
      source: 'hub',
      locale: 'en',
    });
  });

  it('fires help_center_opened with the entry point from router state (default profile)', () => {
    renderApp('/help');
    expect(mocks.helpCenterOpened).toHaveBeenCalledWith('profile');
  });

  it.each(['login', 'signup', 'home_card'])('passes the %s entry point', (source) => {
    renderApp({ pathname: '/help', state: { helpSource: source } });
    expect(mocks.helpCenterOpened).toHaveBeenCalledWith(source);
    expect(mocks.helpCenterOpened).toHaveBeenCalledTimes(1);
  });

  it('searches accent-insensitively in Spanish, announces the count, and never sends the query', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      await i18n.changeLanguage('es');
      renderApp('/help');
      const box = screen.getByRole('searchbox', { name: 'Buscar en la ayuda' });
      fireEvent.change(box, { target: { value: 'medicacion' } });
      expect(screen.getByRole('status')).toHaveTextContent('Resultados: 1');
      expect(screen.getByRole('link', { name: /Agregar un medicamento/ })).toHaveAttribute(
        'href',
        '/help/add-a-medication'
      );
      expect(screen.queryByRole('heading', { name: 'Populares' })).toBeNull();
      expect(mocks.helpSearchUsed).not.toHaveBeenCalled();
      await act(async () => {
        vi.advanceTimersByTime(900);
      });
      expect(mocks.helpSearchUsed).toHaveBeenCalledTimes(1);
      expect(mocks.helpSearchUsed).toHaveBeenCalledWith('1-3');
      expect(JSON.stringify(mocks.helpSearchUsed.mock.calls)).not.toContain('medicacion');
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows a no-results message (bucket 0) and clears the search', async () => {
    const user = userEvent.setup();
    renderApp('/help');
    await user.type(screen.getByRole('searchbox', { name: 'Search help' }), 'zzzz');
    expect(screen.getByRole('status')).toHaveTextContent('No articles match "zzzz".');
    await user.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(screen.getByRole('heading', { level: 2, name: 'Popular' })).toBeInTheDocument();
  });

  it('opens an article from the hub with source hub', async () => {
    const user = userEvent.setup();
    renderApp('/help');
    await user.click(
      within(screen.getByRole('list', { name: 'Popular' })).getByRole('link', { name: /Invite family/ })
    );
    expect(await screen.findByRole('heading', { level: 1, name: 'Invite family' })).toBeInTheDocument();
    expect(mocks.helpArticleViewed).toHaveBeenCalledWith({
      slug: 'invite-family',
      source: 'hub',
      locale: 'en',
    });
  });
});

describe('Help category', () => {
  it('shows only that category, titles only, in order, then the contact card', async () => {
    renderApp('/help/c/care');
    expect(screen.getByRole('heading', { level: 1, name: 'Daily care' })).toBeInTheDocument();
    const list = screen.getByRole('list', { name: 'Daily care' });
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(1);
    expect(items[0]).toHaveTextContent('Add a medication');
    expect(within(list).queryByText('Add a medicine and its reminder times.')).toBeNull();
    expect(screen.queryByText('Invite family')).toBeNull();
    expect(screen.queryByRole('searchbox')).toBeNull();
    expect(screen.getByTestId('help-contact-card')).toBeInTheDocument();
    // Helmet writes document.title asynchronously.
    await waitFor(() => expect(document.title).toBe('Daily care · CircleCare'));
    expect(screen.getByRole('link', { name: 'All help articles' })).toHaveAttribute('href', '/help');
    expect(within(list).getByRole('link')).toHaveAttribute('href', '/help/add-a-medication');
  });

  it('renders the Spanish label and plural counts in es', async () => {
    await i18n.changeLanguage('es');
    renderApp('/help');
    expect(screen.getByRole('link', { name: 'Cuidado diario, 1 artículo' })).toHaveAttribute(
      'href',
      '/help/c/care'
    );
  });

  it('an unknown or empty category shows the not-found state with a way back', () => {
    renderApp('/help/c/empty');
    expect(
      screen.getByRole('heading', { level: 1, name: 'We could not find that article' })
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'All help articles' })).toHaveAttribute('href', '/help');
  });
});

describe('Help article', () => {
  it('renders title, summary, video, steps, body, related and contact', () => {
    renderApp('/help/add-a-medication');
    expect(screen.getByRole('heading', { level: 1, name: 'Add a medication' })).toBeInTheDocument();
    expect(screen.getByText('Add a medicine and its reminder times.')).toBeInTheDocument();

    const video = screen.getByTestId('help-video') as HTMLVideoElement;
    expect(video.tagName).toBe('VIDEO');
    expect(video.getAttribute('src')).toBe(
      'https://test-project.supabase.co/storage/v1/object/public/help-videos/add-a-medication-en.mp4'
    );
    expect(video.getAttribute('poster')).toBe(
      'https://test-project.supabase.co/storage/v1/object/public/help-videos/add-a-medication-en.jpg'
    );
    expect(video.muted).toBe(true);
    expect(video.autoplay).toBe(true);
    expect(video.controls).toBe(true);
    expect(video.loop).toBe(false);
    expect(video.getAttribute('playsinline')).not.toBeNull();
    expect(video.getAttribute('preload')).toBe('metadata');
    expect(video).toHaveAccessibleName('Video: Add a medication');

    expect(screen.getByRole('heading', { level: 2, name: 'Steps' })).toBeInTheDocument();
    expect(screen.getByText('Open Medications.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Good to know' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'our site' })).toHaveAttribute('target', '_blank');

    const related = screen.getByRole('list', { name: 'Related articles' });
    expect(related.querySelectorAll('li')).toHaveLength(1);
    expect(
      screen.getByRole('heading', { level: 2, name: 'Still need help? Contact us' })
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Email support' })).toHaveAttribute(
      'href',
      'mailto:support@circlecare.app'
    );
    expect(document.title).toBeDefined();
  });

  it('uses the Spanish article and video file in es', async () => {
    await i18n.changeLanguage('es');
    renderApp('/help/add-a-medication');
    expect(screen.getByRole('heading', { level: 1, name: 'Agregar un medicamento' })).toBeInTheDocument();
    expect(screen.getByTestId('help-video').getAttribute('src')).toMatch(/add-a-medication-es\.mp4$/);
    expect(mocks.helpArticleViewed).toHaveBeenCalledWith({
      slug: 'add-a-medication',
      source: 'hub',
      locale: 'es',
    });
  });

  it('has no video element when the article has none', () => {
    renderApp('/help/invite-family');
    expect(screen.queryByTestId('help-video')).toBeNull();
    expect(screen.getByRole('list', { name: 'Related articles' })).toBeInTheDocument();
  });

  it('fires started once, completed on end, and shows the poster + line on failure', () => {
    renderApp('/help/add-a-medication');
    const video = screen.getByTestId('help-video');
    fireEvent(video, new Event('playing'));
    fireEvent(video, new Event('playing'));
    expect(mocks.helpVideoStarted).toHaveBeenCalledTimes(1);
    expect(mocks.helpVideoStarted).toHaveBeenCalledWith('add-a-medication');
    fireEvent(video, new Event('ended'));
    expect(mocks.helpVideoCompleted).toHaveBeenCalledWith('add-a-medication');

    fireEvent(video, new Event('error'));
    expect(mocks.helpVideoFailed).toHaveBeenCalledWith('add-a-medication');
    expect(screen.queryByTestId('help-video')).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent('Video unavailable right now');
    // The text article still works.
    expect(screen.getByRole('heading', { level: 2, name: 'Steps' })).toBeInTheDocument();
  });

  it('a contextual entry for an unknown article fires no events', () => {
    renderApp({ pathname: '/help/vitals-missing', state: { helpSource: 'contextual' } });
    expect(mocks.helpArticleViewed).not.toHaveBeenCalled();
    expect(mocks.helpCenterOpened).not.toHaveBeenCalled();
  });

  it('contextual entry on a real article', () => {
    renderApp({ pathname: '/help/invite-family', state: { helpSource: 'contextual' } });
    expect(mocks.helpCenterOpened).toHaveBeenCalledWith('contextual');
    expect(mocks.helpArticleViewed).toHaveBeenCalledWith({
      slug: 'invite-family',
      source: 'contextual',
      locale: 'en',
    });
  });

  it('related and in-body links navigate in-app with source related', async () => {
    const user = userEvent.setup();
    renderApp('/help/add-a-medication');
    await user.click(screen.getByRole('link', { name: 'Invite family' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Invite family' })).toBeInTheDocument();
    expect(mocks.helpArticleViewed).toHaveBeenLastCalledWith({
      slug: 'invite-family',
      source: 'related',
      locale: 'en',
    });
  });

  it('an unknown slug shows a not-found state with a way back and fires no view event', () => {
    renderApp('/help/not-a-thing');
    expect(
      screen.getByRole('heading', { level: 1, name: 'We could not find that article' })
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'All help articles' })).toHaveAttribute('href', '/help');
    expect(mocks.helpArticleViewed).not.toHaveBeenCalled();
  });
});

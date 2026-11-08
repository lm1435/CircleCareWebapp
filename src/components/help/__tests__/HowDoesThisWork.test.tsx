import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HelmetProvider } from 'react-helmet-async';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import i18n from '@/i18n';
import { HowDoesThisWork } from '@/components/help/HowDoesThisWork';
import HelpArticlePage from '@/pages/HelpArticlePage';
import { HELP_FIXTURE } from '@/help/__tests__/fixture';

const mocks = vi.hoisted(() => ({
  helpCenterOpened: vi.fn(),
  helpArticleViewed: vi.fn(),
  helpItemExpanded: vi.fn(),
  helpSearchUsed: vi.fn(),
  helpVideoStarted: vi.fn(),
  helpVideoCompleted: vi.fn(),
  helpVideoFailed: vi.fn(),
}));
vi.mock('@/lib/analytics', () => ({ Analytics: mocks }));

vi.mock('@/help/content', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/help/content')>()),
  getBundledHelpContent: () => HELP_FIXTURE,
}));

describe('HowDoesThisWork', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await i18n.changeLanguage('en');
  });

  // Mobile parity (owner 2026-11-08): the moss accent with the help-circle glyph, never coral.
  it('is the moss link with the help glyph', () => {
    render(
      <MemoryRouter>
        <HowDoesThisWork slug="invite-family" />
      </MemoryRouter>
    );
    const link = screen.getByRole('link', { name: 'How does this work?' });
    expect(link.className).toContain('text-moss');
    expect(link.className).not.toContain('coral');
    expect(link.querySelector('svg, [aria-hidden="true"]')).not.toBeNull();
  });

  // The existing analytics: opening the article from the link counts help_center_opened with
  // source "contextual" (fired by the article page on arrival).
  it('opening it fires help_center_opened { source: contextual }', async () => {
    const user = userEvent.setup();
    render(
      <HelmetProvider>
        <MemoryRouter initialEntries={['/']}>
          <Routes>
            <Route path="/" element={<HowDoesThisWork slug="invite-family" />} />
            <Route path="/help/:slug" element={<HelpArticlePage />} />
          </Routes>
        </MemoryRouter>
      </HelmetProvider>
    );
    expect(mocks.helpCenterOpened).not.toHaveBeenCalled();
    await user.click(screen.getByRole('link', { name: 'How does this work?' }));
    expect(mocks.helpCenterOpened).toHaveBeenCalledWith('contextual');
    expect(mocks.helpCenterOpened).toHaveBeenCalledTimes(1);
  });

  it('links to the article', () => {
    render(
      <MemoryRouter>
        <HowDoesThisWork slug="invite-family" />
      </MemoryRouter>
    );
    const link = screen.getByRole('link', { name: 'How does this work?' });
    expect(link).toHaveAttribute('href', '/help/invite-family');
  });

  it('is translated', async () => {
    await i18n.changeLanguage('es');
    render(
      <MemoryRouter>
        <HowDoesThisWork slug="invite-family" />
      </MemoryRouter>
    );
    expect(screen.getByRole('link', { name: '¿Cómo funciona?' })).toBeInTheDocument();
  });

  it('renders nothing when the article is not in the bundled content', () => {
    const { container } = render(
      <MemoryRouter>
        <HowDoesThisWork slug="nope" />
      </MemoryRouter>
    );
    expect(container).toBeEmptyDOMElement();
  });
});

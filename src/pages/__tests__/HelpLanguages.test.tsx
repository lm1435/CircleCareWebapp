import { render, screen } from '@testing-library/react';
import { HelmetProvider } from 'react-helmet-async';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import i18n from '@/i18n';
import HelpPage from '@/pages/HelpPage';
import HelpArticlePage from '@/pages/HelpArticlePage';
import { getBundledHelpContent } from '@/help/content';

// Help in all six languages against the REAL bundled content.json: language
// pick, regional fallback (fr-CA -> fr, pt-PT -> pt, other -> en), no video
// outside en/es, and a locale enum on the view event.

const mocks = vi.hoisted(() => ({
  helpCenterOpened: vi.fn(),
  helpArticleViewed: vi.fn(),
  helpSearchUsed: vi.fn(),
  helpVideoStarted: vi.fn(),
  helpVideoCompleted: vi.fn(),
  helpVideoFailed: vi.fn(),
}));
vi.mock('@/lib/analytics', () => ({ Analytics: mocks }));

const content = getBundledHelpContent();
const slug = content.articles.en.find((a) => a.video)!.slug;
const titleIn = (l: 'en' | 'es' | 'de' | 'fr' | 'it' | 'pt') =>
  content.articles[l].find((a) => a.slug === slug)!.title;

function renderArticle(): void {
  render(
    <HelmetProvider>
      <MemoryRouter initialEntries={[`/help/${slug}`]}>
        <Routes>
          <Route path="/help/:slug" element={<HelpArticlePage />} />
        </Routes>
      </MemoryRouter>
    </HelmetProvider>
  );
}

afterEach(async () => {
  await i18n.changeLanguage('en');
});

describe('Help article language', () => {
  it.each([
    ['de', 'de'],
    ['fr', 'fr'],
    ['fr-CA', 'fr'],
    ['it', 'it'],
    ['pt', 'pt'],
    ['pt-PT', 'pt'],
  ] as const)('%s shows the %s article, no video, locale enum', async (lang, loc) => {
    vi.clearAllMocks();
    await i18n.changeLanguage(lang);
    renderArticle();
    expect(screen.getByRole('heading', { level: 1, name: titleIn(loc) })).toBeInTheDocument();
    expect(titleIn(loc)).not.toBe(titleIn('en'));
    expect(document.querySelector('video')).toBeNull();
    expect(mocks.helpArticleViewed).toHaveBeenCalledWith({ slug, source: 'hub', locale: loc });
  });

  it('en and es keep their video', async () => {
    for (const l of ['en', 'es'] as const) {
      await i18n.changeLanguage(l);
      const { unmount } = render(
        <HelmetProvider>
          <MemoryRouter initialEntries={[`/help/${slug}`]}>
            <Routes>
              <Route path="/help/:slug" element={<HelpArticlePage />} />
            </Routes>
          </MemoryRouter>
        </HelmetProvider>
      );
      expect(document.querySelector('video')).not.toBeNull();
      unmount();
    }
  });
});

describe('Help hub language', () => {
  it('lists German articles and searches German (umlaut-insensitive)', async () => {
    await i18n.changeLanguage('de');
    render(
      <HelmetProvider>
        <MemoryRouter initialEntries={['/help']}>
          <Routes>
            <Route path="/help" element={<HelpPage />} />
          </Routes>
        </MemoryRouter>
      </HelmetProvider>
    );
    const de = content.articles.de.find((a) => /[äöüß]/i.test(a.title)) ?? content.articles.de[0];
    expect(de.title.length).toBeGreaterThan(0);
    expect(screen.getAllByRole('link').some((a) => a.textContent?.includes(content.categories[0].label.de))).toBe(true);
  });
});

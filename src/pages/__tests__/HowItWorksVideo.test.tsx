import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import i18n from '@/i18n';
import HowItWorksPage from '@/pages/HowItWorksPage';
import { Analytics } from '@/lib/analytics';
import { apiClient } from '@/lib/api';
import { env } from '@/lib/env';
import { previewVideoStorageBase } from '@/lib/previewVideo';

// 1.4.3 "See how it works" video on /how-it-works (mobile parity with
// PreviewScreenVideo.test.tsx; mock docs/mocks-143/preview-video): the FIXED
// 16:9 file of the app language (no app config), muted/looping/inline/poster,
// pause/play, no autoplay under prefers-reduced-motion, carousel on a load error.

const BASE = `${previewVideoStorageBase(env.VITE_SUPABASE_URL)}/storage/v1/object/public/help-videos`;

let reduceMotion = false;
const play = vi.fn(() => Promise.resolve());
const pause = vi.fn();

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/how-it-works']}>
        <Routes>
          <Route path="/how-it-works" element={<HowItWorksPage />} />
          <Route path="/signup" element={<p>signup page</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

const video = () => screen.getByTestId('preview-video').querySelector('video') as HTMLVideoElement;

beforeEach(async () => {
  vi.clearAllMocks();
  reduceMotion = false;
  await i18n.changeLanguage('es');
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (q: string) =>
      ({
        matches: q.includes('prefers-reduced-motion') ? reduceMotion : false,
        media: q,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        onchange: null,
        dispatchEvent: vi.fn(),
      }) as unknown as MediaQueryList,
  });
  Object.defineProperty(HTMLMediaElement.prototype, 'play', { configurable: true, value: play });
  Object.defineProperty(HTMLMediaElement.prototype, 'pause', { configurable: true, value: pause });
  vi.spyOn(Analytics, 'previewVideoStarted');
  vi.spyOn(Analytics, 'previewVideoCompleted');
  vi.spyOn(Analytics, 'previewVideoFailed');
  vi.spyOn(Analytics, 'previewGetStartedTapped');
});

describe('HowItWorksPage video', () => {
  it('P: the fixed app-language 16:9 file, muted / looping / inline with its poster, autoplayed', () => {
    renderPage();
    const v = video();
    expect(v.getAttribute('src')).toBe(`${BASE}/preview-demo-es-16x9.mp4`);
    expect(v.getAttribute('poster')).toBe(`${BASE}/preview-demo-es-16x9.jpg`);
    expect(v.muted).toBe(true);
    expect(v.loop).toBe(true);
    expect(v.hasAttribute('playsinline')).toBe(true);
    expect(play).toHaveBeenCalled();
    expect(screen.getByRole('heading', { level: 1, name: 'Mira CircleCare en acción' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Siguiente' })).toBeNull();
  });

  it('P: started / completed fire once with language + platform; Get started -> step 1', async () => {
    renderPage();
    const v = video();
    Object.defineProperty(v, 'duration', { configurable: true, value: 55 });
    fireEvent.play(v);
    fireEvent.pause(v);
    fireEvent.play(v);
    Object.defineProperty(v, 'currentTime', { configurable: true, writable: true, value: 54.8 });
    fireEvent.timeUpdate(v);
    fireEvent.timeUpdate(v);
    expect(Analytics.previewVideoStarted).toHaveBeenCalledTimes(1);
    expect(Analytics.previewVideoStarted).toHaveBeenCalledWith('es', 'web');
    expect(Analytics.previewVideoCompleted).toHaveBeenCalledTimes(1);
    expect(Analytics.previewVideoCompleted).toHaveBeenCalledWith('es', 'web');
    await userEvent.click(screen.getByRole('button', { name: 'Comenzar' }));
    expect(Analytics.previewGetStartedTapped).toHaveBeenCalledWith(1);
    expect(screen.getByText('signup page')).toBeInTheDocument();
  });

  it('P: the pause / play control (WCAG 2.2.2)', async () => {
    renderPage();
    fireEvent.play(video());
    await userEvent.click(screen.getByRole('button', { name: 'Pausar video' }));
    expect(pause).toHaveBeenCalled();
    fireEvent.pause(video());
    play.mockClear();
    await userEvent.click(screen.getByRole('button', { name: 'Reproducir video' }));
    expect(play).toHaveBeenCalledTimes(1);
  });

  it('N: prefers-reduced-motion never autoplays: poster + Play, nothing preloaded', async () => {
    reduceMotion = true;
    renderPage();
    expect(play).not.toHaveBeenCalled();
    expect(video().getAttribute('poster')).toBe(`${BASE}/preview-demo-es-16x9.jpg`);
    expect(video().getAttribute('preload')).toBe('none');
    await userEvent.click(screen.getByRole('button', { name: 'Reproducir video' }));
    expect(play).toHaveBeenCalledTimes(1);
  });

  it('N: a source that fails to load falls back to the carousel and records it', () => {
    renderPage();
    act(() => {
      fireEvent.error(video());
    });
    expect(screen.queryByTestId('preview-video')).toBeNull();
    expect(screen.getByRole('button', { name: 'Siguiente' })).toBeInTheDocument();
    expect(Analytics.previewVideoFailed).toHaveBeenCalledWith('es', 'web');
    expect(Analytics.previewVideoStarted).not.toHaveBeenCalled();
  });

  it.each([
    ['es', 'es'],
    ['en', 'en'],
    ['ja', 'en'],
  ])('P: app language %s -> preview-demo-%s-16x9 (unknown -> en), language enum on events', async (lang, file) => {
    await i18n.changeLanguage(lang);
    renderPage();
    expect(video().getAttribute('src')).toBe(`${BASE}/preview-demo-${file}-16x9.mp4`);
    expect(video().getAttribute('poster')).toBe(`${BASE}/preview-demo-${file}-16x9.jpg`);
    fireEvent.play(video());
    expect(Analytics.previewVideoStarted).toHaveBeenCalledWith(file, 'web');
  });

  it.each(['fr', 'fr-CA', 'de', 'it', 'pt', 'pt-PT'])(
    'N: app language %s has no uploaded video yet -> the carousel, no player, no preview_video_failed',
    async (lang) => {
      await i18n.changeLanguage(lang);
      renderPage();
      expect(screen.queryByTestId('preview-video')).toBeNull();
      expect(document.querySelector('video')).toBeNull();
      expect(Analytics.previewVideoFailed).not.toHaveBeenCalled();
      expect(Analytics.previewVideoStarted).not.toHaveBeenCalled();
    }
  );

  it('N: a build with a local http storage base shows the carousel, no player source, no video events (mobile 630d46cb)', () => {
    const original = env.VITE_SUPABASE_URL;
    (env as { VITE_SUPABASE_URL?: string }).VITE_SUPABASE_URL = 'http://127.0.0.1:55321';
    try {
      renderPage();
      expect(screen.queryByTestId('preview-video')).toBeNull();
      expect(document.querySelector('video')).toBeNull();
      expect(screen.getByRole('button', { name: 'Siguiente' })).toBeInTheDocument();
      expect(Analytics.previewVideoFailed).not.toHaveBeenCalled();
      expect(Analytics.previewVideoStarted).not.toHaveBeenCalled();
    } finally {
      (env as { VITE_SUPABASE_URL?: string }).VITE_SUPABASE_URL = original;
    }
  });

  it('N: never an http: URL, and no app-config request for the video', () => {
    renderPage();
    expect(video().getAttribute('src')).toMatch(/^https:\/\//);
    expect(video().getAttribute('poster')).toMatch(/^https:\/\//);
    expect(apiClient.get).not.toHaveBeenCalled();
    expect(screen.queryByTestId('preview-loading')).toBeNull();
  });

  it('N: analytics carry the language enum and platform only, never the URL', () => {
    renderPage();
    const v = video();
    Object.defineProperty(v, 'duration', { configurable: true, value: 55 });
    fireEvent.play(v);
    Object.defineProperty(v, 'currentTime', { configurable: true, writable: true, value: 54.8 });
    fireEvent.timeUpdate(v);
    fireEvent.error(v);
    const calls = [
      ...vi.mocked(Analytics.previewVideoStarted).mock.calls,
      ...vi.mocked(Analytics.previewVideoCompleted).mock.calls,
      ...vi.mocked(Analytics.previewVideoFailed).mock.calls,
    ];
    expect(calls).toHaveLength(3);
    for (const args of calls) {
      expect(args).toEqual(['es', 'web']);
      expect(JSON.stringify(args)).not.toMatch(/https?:|supabase|help-videos|\.mp4/);
    }
  });
});

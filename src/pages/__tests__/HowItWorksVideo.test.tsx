import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import i18n from '@/i18n';
import HowItWorksPage from '@/pages/HowItWorksPage';
import { Analytics } from '@/lib/analytics';
import { queryKeys } from '@/lib/queryKeys';
import { apiClient } from '@/lib/api';

// 1.4.3 "See how it works" video on /how-it-works (mobile parity with
// PreviewScreenVideo.test.tsx; mock docs/mocks-143/preview-video): the 16:9 cut
// of the app-language key, muted/looping/inline/poster, pause/play, no autoplay
// under prefers-reduced-motion, carousel on a load error or with no key.

const BASE = 'https://x.supabase.co/storage/v1/object/public/help-videos';

let reduceMotion = false;
const play = vi.fn(() => Promise.resolve());
const pause = vi.fn();

function renderWith(config: Record<string, string> | undefined) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  if (config) queryClient.setQueryData(queryKeys.appConfig, config);
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

const CONFIG = {
  preview_video_url: `${BASE}/preview-demo-en-4x5.mp4`,
  preview_video_url_es: `${BASE}/preview-demo-es-4x5.mp4`,
};

describe('HowItWorksPage video', () => {
  it('P: the app-language 16:9 cut, muted / looping / inline with its poster, autoplayed', () => {
    renderWith(CONFIG);
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
    renderWith(CONFIG);
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
    renderWith(CONFIG);
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
    renderWith(CONFIG);
    expect(play).not.toHaveBeenCalled();
    expect(video().getAttribute('poster')).toBe(`${BASE}/preview-demo-es-16x9.jpg`);
    expect(video().getAttribute('preload')).toBe('none');
    await userEvent.click(screen.getByRole('button', { name: 'Reproducir video' }));
    expect(play).toHaveBeenCalledTimes(1);
  });

  it('N: a source that fails to load falls back to the carousel and records it', () => {
    renderWith(CONFIG);
    act(() => {
      fireEvent.error(video());
    });
    expect(screen.queryByTestId('preview-video')).toBeNull();
    expect(screen.getByRole('button', { name: 'Siguiente' })).toBeInTheDocument();
    expect(Analytics.previewVideoFailed).toHaveBeenCalledWith('es', 'web');
    expect(Analytics.previewVideoStarted).not.toHaveBeenCalled();
  });

  it('P: no key for the language -> the legacy key ("default")', () => {
    renderWith({ preview_video_url: `${BASE}/preview-demo-en-4x5.mp4` });
    expect(video().getAttribute('src')).toBe(`${BASE}/preview-demo-en-16x9.mp4`);
    fireEvent.play(video());
    expect(Analytics.previewVideoStarted).toHaveBeenCalledWith('default', 'web');
  });

  it('N: no usable key -> the carousel (an English-only key never reaches a Spanish reader)', () => {
    renderWith({ preview_video_url_en: `${BASE}/preview-demo-en-4x5.mp4` });
    expect(screen.queryByTestId('preview-video')).toBeNull();
    expect(screen.getByRole('button', { name: 'Siguiente' })).toBeInTheDocument();
  });

  it('N: while the config loads, neither the carousel nor a video flashes; an API failure -> carousel', async () => {
    vi.mocked(apiClient.get).mockRejectedValueOnce(new Error('offline')).mockRejectedValueOnce(new Error('offline'));
    renderWith(undefined);
    expect(screen.getByTestId('preview-loading')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Siguiente' })).toBeNull();
    expect(await screen.findByRole('button', { name: 'Siguiente' }, { timeout: 4000 })).toBeInTheDocument();
    expect(screen.queryByTestId('preview-video')).toBeNull();
  });
});

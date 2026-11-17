import { resolvePreviewVideo, isDirectVideoUrl } from '@/lib/previewVideo';

// 1.4.3 "See how it works" video source: app language -> base language -> legacy
// preview_video_url -> null (carousel). Mirrors mobile src/__tests__/utils/previewVideo.test.ts.
const BASE = 'https://x.supabase.co/storage/v1/object/public/help-videos';
const en = `${BASE}/preview-demo-en-4x5.mp4`;
const es = `${BASE}/preview-demo-es-4x5.mp4`;

describe('resolvePreviewVideo', () => {
  it('P: the app language key wins, with its poster', () => {
    expect(resolvePreviewVideo({ preview_video_url: en, preview_video_url_es: es }, 'es', '4x5')).toEqual({
      src: es,
      poster: `${BASE}/preview-demo-es-4x5.jpg`,
      language: 'es',
    });
  });

  it('P: a regional variant with no cut of its own uses its base language', () => {
    expect(resolvePreviewVideo({ preview_video_url_fr: `${BASE}/preview-demo-fr-4x5.mp4` }, 'fr-CA', '4x5')?.language).toBe('fr');
    expect(
      resolvePreviewVideo(
        { preview_video_url_pt: `${BASE}/p-pt-4x5.mp4`, 'preview_video_url_pt-PT': `${BASE}/p-ptpt-4x5.mp4` },
        'pt-PT',
        '4x5'
      )?.language
    ).toBe('pt-PT');
  });

  it('P: no per-language key -> the legacy key (language "default")', () => {
    expect(resolvePreviewVideo({ preview_video_url: en }, 'de', '4x5')).toMatchObject({ src: en, language: 'default' });
  });

  it('N: a Spanish reader never gets the English per-language cut', () => {
    expect(resolvePreviewVideo({ preview_video_url_en: en }, 'es', '4x5')).toBeNull();
  });

  it('N: blank, non-https and page (YouTube) URLs are skipped, then null', () => {
    expect(
      resolvePreviewVideo(
        {
          preview_video_url_es: '   ',
          preview_video_url: 'https://www.youtube.com/watch?v=abc',
        },
        'es',
        '4x5'
      )
    ).toBeNull();
    expect(resolvePreviewVideo({ preview_video_url: 'http://insecure.example/v.mp4' }, 'en', '4x5')).toBeNull();
    expect(resolvePreviewVideo(null, 'en', '4x5')).toBeNull();
    expect(resolvePreviewVideo({}, 'en', '4x5')).toBeNull();
  });

  it('P: the web cut swaps -4x5 for -16x9, poster follows', () => {
    expect(resolvePreviewVideo({ preview_video_url_en: en }, 'en', '16x9')).toEqual({
      src: `${BASE}/preview-demo-en-16x9.mp4`,
      poster: `${BASE}/preview-demo-en-16x9.jpg`,
      language: 'en',
    });
  });

  it('N: a URL without the -4x5 convention is used as-is; an HLS stream has no poster', () => {
    expect(resolvePreviewVideo({ preview_video_url: `${BASE}/demo.mp4` }, 'en', '16x9')?.src).toBe(`${BASE}/demo.mp4`);
    expect(resolvePreviewVideo({ preview_video_url: `${BASE}/demo.m3u8` }, 'en', '4x5')?.poster).toBeNull();
  });

  it('isDirectVideoUrl: https video files only', () => {
    expect(isDirectVideoUrl(en)).toBe(true);
    expect(isDirectVideoUrl('https://vimeo.com/123')).toBe(false);
    expect(isDirectVideoUrl('not a url')).toBe(false);
  });
});

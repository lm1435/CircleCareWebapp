import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { previewVideoSource, previewVideoStorageBase } from '@/lib/previewVideo';

// 1.4.3 "See how it works" video: a FIXED address per app language (no app
// config). Mirrors mobile src/__tests__/utils/previewVideo.test.ts.
const HOST = 'https://x.supabase.co';
const DIR = `${HOST}/storage/v1/object/public/help-videos`;
const LANGS = ['en', 'es', 'fr', 'fr-CA', 'de', 'it', 'pt', 'pt-PT'] as const;

describe('previewVideoSource', () => {
  it.each(LANGS)('P: %s -> its own 16:9 file and poster', (lang) => {
    expect(previewVideoSource(lang, '16x9', HOST)).toEqual({
      src: `${DIR}/preview-demo-${lang}-16x9.mp4`,
      poster: `${DIR}/preview-demo-${lang}-16x9.jpg`,
      language: lang,
    });
  });

  it('P: the cut is part of the name (4x5 on the phone, 16x9 on the web)', () => {
    expect(previewVideoSource('es', '4x5', HOST)?.src).toBe(`${DIR}/preview-demo-es-4x5.mp4`);
  });

  it('P: regional tags resolve as i18n does (es-MX -> es, pt_PT -> pt-PT, fr-ca -> fr-CA)', () => {
    expect(previewVideoSource('es-MX', '16x9', HOST)?.language).toBe('es');
    expect(previewVideoSource('pt_PT', '16x9', HOST)?.language).toBe('pt-PT');
    expect(previewVideoSource('fr-ca', '16x9', HOST)?.src).toBe(`${DIR}/preview-demo-fr-CA-16x9.mp4`);
  });

  it.each(['ja', 'zz-ZZ', '', null, undefined])('P: unknown language %p -> en', (lang) => {
    expect(previewVideoSource(lang, '16x9', HOST)).toEqual({
      src: `${DIR}/preview-demo-en-16x9.mp4`,
      poster: `${DIR}/preview-demo-en-16x9.jpg`,
      language: 'en',
    });
  });

  it('P: the configured https base is used (trailing slash trimmed)', () => {
    expect(previewVideoStorageBase(`${HOST}/`)).toBe(HOST);
  });

  it.each(['http://127.0.0.1:55321', 'http://x.supabase.co', 'not a url', '', '   ', null])(
    'N: base %p (not https) -> NO video (null), so the page shows the carousel; never an http URL',
    (base) => {
      expect(previewVideoStorageBase(base)).toBeNull();
      expect(previewVideoSource('en', '16x9', base)).toBeNull();
    }
  );

  it('N: no Supabase host is hard-coded in the source (mobile parity, 630d46cb)', () => {
    const text = readFileSync(resolve(process.cwd(), 'src/lib/previewVideo.ts'), 'utf8');
    expect(text).not.toMatch(/supabase\.co|prdfxaljwlsiqsqworzy/);
  });

  it('N: the default base is the build env (no argument -> still https, never app config)', () => {
    expect(previewVideoSource('de', '16x9')?.src).toMatch(/^https:\/\/.+\/help-videos\/preview-demo-de-16x9\.mp4$/);
  });

  it('N: no app-config read anywhere for the video (source scan)', () => {
    for (const file of ['src/lib/previewVideo.ts', 'src/pages/HowItWorksPage.tsx']) {
      const text = readFileSync(resolve(process.cwd(), file), 'utf8');
      expect(text).not.toMatch(/preview_video_url|useAppConfig|app-config|getAppConfig/);
    }
  });
});

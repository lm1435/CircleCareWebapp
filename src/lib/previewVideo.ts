import { baseLocale, normalizeLocale, type SupportedLanguage } from '@/i18n/locales';

/**
 * "See how it works" preview video (1.4.3). The backend serves one URL per app
 * language as app config `preview_video_url_<lang>` (en, es, de, fr, fr-CA, it,
 * pt, pt-PT; a key is ABSENT until the owner sets it) plus the legacy
 * `preview_video_url` that 1.4.2 apps read.
 *
 * Order: the app language's key -> its base language's key (a regional variant
 * like fr-CA / pt-PT with no cut of its own) -> the legacy key -> null (the
 * caller shows today's carousel). Never English for a Spanish reader unless the
 * owner pointed the legacy key there.
 *
 * The configured URL is the phone cut (`...-4x5.mp4`). The web shows the 16:9
 * cut by the upload convention `...-16x9.mp4` next to it; the poster is the same
 * path with `.jpg` (help-videos/preview-demo-{lang}-{4x5,16x9}.{mp4,jpg}). A
 * missing derived file just fails to load, and the caller falls back.
 * Mirrors mobile/src/utils/previewVideo.ts (same order, same derivation).
 */

export type PreviewVideoCut = '4x5' | '16x9';
/** Analytics enum: which key won ('default' = the legacy key). */
export type PreviewVideoLanguage = SupportedLanguage | 'default';

export interface PreviewVideoSource {
  src: string;
  poster: string | null;
  language: PreviewVideoLanguage;
}

/** The app-config payload (any object; only the preview keys are read). */
type PreviewVideoConfig = object | null | undefined;

const VIDEO_EXT = /\.(mp4|mov|m3u8|webm)$/i;

/** A direct, https video file (not a YouTube / Vimeo page that needs a browser). */
export function isDirectVideoUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && VIDEO_EXT.test(parsed.pathname);
  } catch {
    return false;
  }
}

function withCut(url: string, cut: PreviewVideoCut): string {
  if (cut === '4x5') return url;
  return url.replace(/-4x5(\.(?:mp4|mov|m3u8|webm))(\?|#|$)/i, '-16x9$1$2');
}

function posterFor(url: string): string | null {
  const replaced = url.replace(/\.(mp4|mov|webm)(\?|#|$)/i, '.jpg$2');
  return replaced === url ? null : replaced;
}

export function resolvePreviewVideo(
  config: PreviewVideoConfig,
  language: string | null | undefined,
  cut: PreviewVideoCut,
): PreviewVideoSource | null {
  if (!config) return null;
  const lang = normalizeLocale(language);
  const base = baseLocale(lang);
  const candidates: [string, PreviewVideoLanguage][] = [[`preview_video_url_${lang}`, lang]];
  if (base !== lang) candidates.push([`preview_video_url_${base}`, base]);
  candidates.push(['preview_video_url', 'default']);
  for (const [key, which] of candidates) {
    const raw = (config as Record<string, unknown>)[key];
    if (typeof raw !== 'string') continue;
    const url = raw.trim();
    if (!url || !isDirectVideoUrl(url)) continue;
    const src = withCut(url, cut);
    return { src, poster: posterFor(src), language: which };
  }
  return null;
}

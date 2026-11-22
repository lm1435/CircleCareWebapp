import { env } from '@/lib/env';
import { normalizeLocale, type SupportedLanguage } from '@/i18n/locales';

/**
 * "See how it works" preview video (1.4.3): a FIXED address per app language,
 * no app config, no settings. Every supported language returns its address, uploaded or not: uploading a language's file makes it live with no
 * app update. A file that is not there yet falls back to the carousel in the caller; replacing a video = overwriting
 * the file in the public `help-videos` bucket.
 *
 *   {SUPABASE_URL}/storage/v1/object/public/help-videos/preview-demo-{lang}-{cut}.mp4
 *   poster: the same name with `.jpg`
 *
 * `lang` is the app's resolved UI language exactly as i18n uses it (en, es, fr,
 * fr-CA, de, it, pt, pt-PT); anything else maps to en. The web shows the 16:9
 * cut, the phone the 4:5 cut. A file that fails to load (network) hands over to
 * the carousel in the caller.
 *
 * The base is VITE_SUPABASE_URL when it is https (production builds). A local
 * http Supabase (dev / e2e) gets NO video (null): the caller shows the carousel.
 * The address is never http, and no Supabase host is hard-coded here (a
 * production fallback put the production host into every test bundle).
 * Mirrors mobile/src/utils/previewVideo.ts (630d46cb).
 */

export type PreviewVideoCut = '4x5' | '16x9';

export interface PreviewVideoSource {
  src: string;
  poster: string;
  /** Analytics enum: the language of the file. Never put the URL in analytics. */
  language: SupportedLanguage;
}

/**
 * DOCUMENTATION + analytics only, never a gate: the languages whose file is known to be uploaded to `help-videos`.
 * previewVideoSource returns an address for every language. A load failure in any other language is probably a file
 * not uploaded yet (callers fall back to the carousel and skip preview_video_failed, see previewVideoMayBeMissing).
 */
export const PREVIEW_VIDEO_LANGUAGES: readonly SupportedLanguage[] = ['en', 'es', 'fr', 'fr-CA', 'de', 'it', 'pt', 'pt-PT'];
// All 8 files (4x5 and 16x9, mp4 + jpg) verified live in production storage on 2026-11-21.

const BUCKET_PATH = '/storage/v1/object/public/help-videos/';

/** The configured https storage base (trailing slash trimmed), or null: no video. */
export function previewVideoStorageBase(configured: string | null | undefined): string | null {
  const raw = (configured ?? '').trim().replace(/\/+$/, '');
  try {
    if (raw && new URL(raw).protocol === 'https:') return raw;
  } catch {
    // not a URL: no video
  }
  return null;
}

/** The fixed preview-video file for the app language and cut; null only when the build has no https storage base. */
export function previewVideoSource(
  language: string | null | undefined,
  cut: PreviewVideoCut,
  base: string | null | undefined = env.VITE_SUPABASE_URL
): PreviewVideoSource | null {
  const storage = previewVideoStorageBase(base);
  if (!storage) return null;
  const lang = normalizeLocale(language);
  const name = `${storage}${BUCKET_PATH}preview-demo-${lang}-${cut}`;
  return { src: `${name}.mp4`, poster: `${name}.jpg`, language: lang };
}

/** True when a load failure before any frame is most likely a file not uploaded yet (a language not in PREVIEW_VIDEO_LANGUAGES): do not report it. */
export function previewVideoMayBeMissing(language: string): boolean {
  return !(PREVIEW_VIDEO_LANGUAGES as readonly string[]).includes(language);
}

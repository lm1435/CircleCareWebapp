import { env } from '@/lib/env';
import { normalizeLocale, type SupportedLanguage } from '@/i18n/locales';

/**
 * "See how it works" preview video (1.4.3): a FIXED address per app language,
 * no app config, no settings. Every language has a file; replacing a video =
 * overwriting the file in the public `help-videos` bucket.
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

/** The fixed preview-video file for the app language and cut; null when the build has no https storage base. */
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

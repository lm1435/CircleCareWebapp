import { env } from '@/lib/env';

/** `${SUPABASE_URL}/storage/v1/object/public/help-videos/<file>` */
export function helpMediaUrl(file: string): string {
  const base = env.VITE_SUPABASE_URL.replace(/\/+$/, '');
  return `${base}/storage/v1/object/public/help-videos/${encodeURIComponent(file)}`;
}

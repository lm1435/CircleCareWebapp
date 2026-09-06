import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { APP_STORE_URL, PLAY_STORE_URL } from '@/lib/storeLinks';
import { Text } from '@/components/ui';

// Proper App Store / Google Play badges (mirrors the look of the official
// download badges: black pill, brand glyph, small lead line + large store
// name). Replaces the generic outlined text buttons. The accessible name
// stays the full store string via aria-label so screen readers and tests read
// "Download on the App Store" / "Get it on Google Play".

export function AppleGlyph({
  className = 'h-6 w-6 shrink-0',
}: {
  className?: string;
}): ReactElement {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 384 512"
      className={className}
      fill="currentColor"
    >
      <path d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C63.3 141.2 4 184.8 4 273.5q0 39.3 14.4 81.2c12.8 36.7 59 126.7 107.2 125.2 25.2-.6 43-17.9 75.8-17.9 31.8 0 48.3 17.9 76.4 17.9 48.6-.7 90.4-82.5 102.6-119.3-65.2-30.7-61.7-90-61.7-91.9zm-56.6-164.2c27.3-32.4 24.8-61.9 24-72.5-24.1 1.4-52 16.4-67.9 34.9-17.5 19.8-27.8 44.3-25.6 71.9 26.1 2 49.9-11.4 69.5-34.3z" />
    </svg>
  );
}

export function GooglePlayGlyph({
  className = 'h-6 w-6 shrink-0',
}: {
  className?: string;
}): ReactElement {
  return (
    <svg aria-hidden="true" focusable="false" viewBox="0 0 512 512" className={className}>
      <path
        fill="#00D3FF"
        d="M47 0C34 6.8 25.3 19.2 25.3 35.3v441.3c0 16.1 8.7 28.5 21.7 35.3l256.6-256L47 0z"
      />
      <path fill="#00F076" d="M325.3 234.3 104.6 13l280.8 161.2-60.1 60.1z" />
      <path
        fill="#FFCE00"
        d="M472.2 225.6l-58.9-34.1-65.7 64.5 65.7 64.5 60.1-34.1c18-14.3 18-46.5-1.2-60.8z"
      />
      <path fill="#FF3A44" d="M104.6 499l280.8-161.2-60.1-60.1L104.6 499z" />
    </svg>
  );
}

export interface StoreBadgesProps {
  /** stack — full-width column (sidebar card); row — inline pair. */
  layout?: 'stack' | 'row';
  className?: string;
}

export function StoreBadges({ layout = 'stack', className = '' }: StoreBadgesProps): ReactElement {
  const { t } = useTranslation('common');

  // Spec §4.5 shape: r16, hairline on ink, 44 minimum target, spring lift.
  const badgeClass =
    'flex min-h-[44px] items-center gap-2.5 rounded-lg border border-cream/15 bg-ink px-3.5 py-2 text-cream no-underline transition-transform duration-fast ease-spring hover:-translate-y-0.5 active:scale-[0.97] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink';

  return (
    <div
      className={`flex ${layout === 'row' ? 'flex-row flex-wrap' : 'flex-col'} gap-2.5 ${className}`}
    >
      <a
        href={APP_STORE_URL}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={t('downloadApp.appStore')}
        className={`${badgeClass} ${layout === 'stack' ? 'w-full' : ''}`}
      >
        <AppleGlyph />
        <span className="flex flex-col items-start leading-none">
          {/* `text-cream/80!` — `mono` paints ink-3 and a second `text-*` in the
              same attribute does not win on specificity; source order decides
              (see Eyebrow.tsx). The `!` is the deterministic override. */}
          <Text variant="mono" as="span" className="text-cream/80!">
            {t('downloadApp.appStoreLead')}
          </Text>
          <span className="mt-0.5 text-md font-semibold tracking-tight">
            {t('downloadApp.appStoreName')}
          </span>
        </span>
      </a>
      <a
        href={PLAY_STORE_URL}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={t('downloadApp.googlePlay')}
        className={`${badgeClass} ${layout === 'stack' ? 'w-full' : ''}`}
      >
        <GooglePlayGlyph />
        <span className="flex flex-col items-start leading-none">
          <Text variant="mono" as="span" className="uppercase text-cream/80!">
            {t('downloadApp.playLead')}
          </Text>
          <span className="mt-0.5 text-md font-semibold tracking-tight">
            {t('downloadApp.playName')}
          </span>
        </span>
      </a>
    </div>
  );
}

import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * Banner shown when the current user's membership is view-only for a circle
 * (freemium caregiver cap — `view_only` from GET /circles). Plan Task 37.
 * Copy matches mobile's ViewOnlyBanner (`viewOnly.banner` / `bannerShort`).
 *
 * GET /circles does not return the owner's name, so callers without it get
 * the short copy (same as mobile's ViewOnlyBanner, which uses bannerShort).
 */
export interface ViewOnlyBannerProps {
  /** Circle owner's display name — enables the "Contact [owner]" long copy. */
  ownerName?: string;
  className?: string;
}

function EyeIcon(): ReactElement {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width={16}
      height={16}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0"
    >
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

export function ViewOnlyBanner({ ownerName, className }: ViewOnlyBannerProps): ReactElement {
  const { t } = useTranslation('freemium');
  const base = 'flex items-center gap-2 rounded-xl border border-line bg-bg-2 px-3 py-2 text-sm text-ink-2';

  return (
    <div role="status" className={className ? `${base} ${className}` : base}>
      <EyeIcon />
      <p className="m-0">
        {ownerName ? t('viewOnly.banner', { ownerName }) : t('viewOnly.bannerShort')}
      </p>
    </div>
  );
}

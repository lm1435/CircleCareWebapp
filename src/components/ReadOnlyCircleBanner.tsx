import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * Banner shown when a circle is read-only (`read_only` from GET /circles —
 * owner on free tier with 2+ circles and this one not selected on downgrade).
 * Plan Task 38. Owner copy matches mobile's `readOnlyBannerTitle`; member copy
 * per plan ("You can view but not edit this circle."). No purchase flow on
 * web — re-subscribing happens in the app.
 */
export interface ReadOnlyCircleBannerProps {
  /** True when the current user owns the circle (circle.role === 'owner'). */
  isOwner: boolean;
  className?: string;
}

function LockIcon(): ReactElement {
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
      <rect x="3" y="11" width="18" height="11" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

export function ReadOnlyCircleBanner({ isOwner, className }: ReadOnlyCircleBannerProps): ReactElement {
  const { t } = useTranslation('freemium');
  const base = 'flex items-center gap-2 rounded-xl border border-line bg-bg-2 px-3 py-2 text-sm text-ink-2';

  return (
    <div role="status" className={className ? `${base} ${className}` : base}>
      <LockIcon />
      <p className="m-0">{isOwner ? t('readOnly.ownerBanner') : t('readOnly.memberBanner')}</p>
    </div>
  );
}

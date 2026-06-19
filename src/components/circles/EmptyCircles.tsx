import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, EmptyState } from '@/components/ui';
import { CirclesIcon } from '@/components/ui/emptyStateIcons';

// Placeholder store URLs — same as Sidebar / AppDownloadBanner until the real
// listing URLs exist.
const APP_STORE_URL = 'https://apps.apple.com/';
const PLAY_STORE_URL = 'https://play.google.com/';

/**
 * Empty state for the circle picker (plan edge case: user has no circles).
 * Icon tile + heading + body + store download CTA, mirroring mobile's rich
 * empty states.
 */
export function EmptyCircles(): ReactElement {
  const { t } = useTranslation('members');

  return (
    <Card className="mx-auto mt-8 max-w-lg p-8">
      <EmptyState
        tone="moss"
        icon={<CirclesIcon />}
        title={t('picker.empty.title')}
        description={t('picker.empty.body')}
      >
        <div className="flex flex-wrap items-center justify-center gap-3">
          <a
            href={APP_STORE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-primary"
          >
            {t('common:downloadApp.appStore')}
          </a>
          <a
            href={PLAY_STORE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-ghost"
          >
            {t('common:downloadApp.googlePlay')}
          </a>
        </div>
      </EmptyState>
    </Card>
  );
}

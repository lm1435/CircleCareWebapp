import type { ReactElement, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, EmptyState } from '@/components/ui';
import { EmergencyIcon } from '@/components/ui/emptyStateIcons';

export interface EmergencySectionProps {
  /** Anchor id used by the in-page nav (e.g. "doctors"). */
  id: string;
  title: string;
  children: ReactNode;
}

/**
 * Page section with an h2 + anchor target. `scroll-mt` keeps the heading
 * visible below the sticky in-page nav when jumped to.
 */
export function EmergencySection({ id, title, children }: EmergencySectionProps): ReactElement {
  return (
    <section id={id} aria-labelledby={`${id}-heading`} className="scroll-mt-28">
      {/* Matches the accordion section-header treatment so always-visible
          sections (Code Status) and collapsible ones read with one consistent
          section-title style. */}
      <h2 id={`${id}-heading`} className="m-0 mb-3 text-lg font-semibold text-ink">
        {title}
      </h2>
      <div className="grid gap-4">{children}</div>
    </section>
  );
}

export interface EmptySectionProps {
  /** e.g. "No doctors added yet" */
  message: string;
  /**
   * Optional action slot (e.g. an "Add doctor" button when the user can edit).
   * When provided, it replaces the download-app CTA. Hidden in print.
   */
  action?: ReactNode;
}

/**
 * Graceful per-section empty state: plain statement (also useful on the
 * printed page — "none listed" is information too). When the requester can
 * edit, an `action` (Add button) is shown; otherwise the app CTA. Both are
 * hidden in print.
 */
export function EmptySection({ message, action }: EmptySectionProps): ReactElement {
  const { t } = useTranslation('emergency');

  return (
    <Card className="print-card border-dashed">
      {/* Single message node so it stays findable + prints ("none listed" is
          information too). The icon tile is decorative; the action/CTA is
          hidden in print. */}
      <EmptyState
        tone="terracotta"
        icon={<span className="no-print">{<EmergencyIcon />}</span>}
        title={message}
      >
        {action ? (
          <div className="no-print">{action}</div>
        ) : (
          <p className="no-print m-0 text-sm text-ink-3">
            {t('downloadToEdit')}{' '}
            <a
              href="https://circlecare.app"
              className="font-medium text-terracotta-deep underline underline-offset-2 hover:text-ink"
            >
              {t('downloadCta')}
            </a>
          </p>
        )}
      </EmptyState>
    </Card>
  );
}

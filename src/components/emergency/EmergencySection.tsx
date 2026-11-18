import { Fragment, type ReactElement, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Card, EmptyState, Icon, Text } from '@/components/ui';

export interface EmergencySectionProps {
  /** Anchor id used by the in-page nav (e.g. "doctors"). */
  id: string;
  title: string;
  children: ReactNode;
  /** Extra classes on the outer `<section>` (e.g. print break-avoidance). */
  className?: string;
}

/**
 * Page section with an h2 + anchor target. `scroll-mt` keeps the heading
 * visible below the sticky in-page nav when jumped to.
 */
export function EmergencySection({
  id,
  title,
  children,
  className,
}: EmergencySectionProps): ReactElement {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-heading`}
      className={['scroll-mt-28', className].filter(Boolean).join(' ')}
    >
      {/* Matches the accordion section-header treatment so always-visible
          sections and collapsible ones read with one consistent
          section-title style. */}
      <Text variant="h2" as="h2" id={`${id}-heading`} className="mb-3">
        {title}
      </Text>
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
    <Card padding="lg" className="print-card border-dashed">
      {/* Single message node so it stays findable + prints ("none listed" is
          information too). */}
      <EmptyState tone="terracotta" icon="medical-outline" title={message}>
        {action ? (
          <div className="no-print">{action}</div>
        ) : (
          <p className="no-print m-0 text-sm text-ink-3">
            {t('downloadToEdit')}{' '}
            <a
              href="https://circlecare.app"
              className="font-medium text-moss-deep underline underline-offset-2 hover:text-ink"
            >
              {t('downloadCta')}
            </a>
          </p>
        )}
      </EmptyState>
    </Card>
  );
}

export interface EmergencyListSectionProps<T> {
  /** Section id (in-page nav anchor). */
  id: string;
  title: string;
  items: T[];
  renderItem: (item: T, index: number) => ReactNode;
  /** Whether the requester can add/edit/delete — gates the Add button. */
  canEdit: boolean;
  onAdd: () => void;
  addLabel: string;
  /** Empty-state message (e.g. "No doctors added yet"). */
  emptyMessage: string;
}

/**
 * One Emergency Info list section (doctors/contacts/insurance), ALWAYS OPEN as on mobile
 * (1.4.3: the web-only collapsible accordions are gone): heading + either the mapped `items`
 * (with a trailing Add button when `canEdit`) or `EmptySection` (whose own Add button replaces
 * the download-app CTA when `canEdit`). `T` stays generic so each caller supplies its own item
 * shape and `renderItem` (a DoctorCard, ContactCard or InsuranceCard).
 */
export function EmergencyListSection<T>({
  id,
  title,
  items,
  renderItem,
  canEdit,
  onAdd,
  addLabel,
  emptyMessage,
}: EmergencyListSectionProps<T>): ReactElement {
  const addButton = (
    <Button
      variant="secondary"
      size="sm"
      leftIcon={<Icon name="add-outline" size="row" />}
      onClick={onAdd}
      offlineKind="change"
    >
      {addLabel}
    </Button>
  );

  return (
    <EmergencySection id={id} title={title}>
      {items.length > 0 ? (
        <>
          {items.map((item, index) => (
            <Fragment key={index}>{renderItem(item, index)}</Fragment>
          ))}
          {canEdit && <div className="no-print">{addButton}</div>}
        </>
      ) : (
        <EmptySection message={emptyMessage} action={canEdit ? addButton : undefined} />
      )}
    </EmergencySection>
  );
}

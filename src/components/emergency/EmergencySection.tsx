import { Fragment, type ReactElement, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Accordion, Button, Card, EmptyState, Icon, Text } from '@/components/ui';

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
          sections (Code Status) and collapsible ones read with one consistent
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

export interface EmergencyAccordionSectionProps<T> {
  /** Accordion id (in-page nav anchor + accordion-group key). */
  id: string;
  title: string;
  /** Controlled accordion open state (see `useAccordionGroup`). */
  open: boolean;
  onToggle: (id: string) => void;
  /** Header meta count (e.g. number of doctors). Hidden when 0. */
  count: number;
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
 * One collapsible Emergency Info section (doctors/contacts/insurance):
 * `Accordion` header + either the mapped `items` (with a trailing Add button
 * when `canEdit`) or `EmptySection` (whose own Add button replaces the
 * download-app CTA when `canEdit`).
 *
 * Extracted from three near-identical ~90-line blocks that used to live
 * inline in EmergencyInfoPage — wrapper, count meta, mapped cards, add
 * Button, EmptySection with its own add Button — differing only in which
 * card component and which callbacks they used. `T` stays generic so each
 * caller supplies its own item shape and its own `renderItem` (a DoctorCard,
 * ContactCard, or InsuranceCard invocation); this component owns only the
 * shared shell.
 */
export function EmergencyAccordionSection<T>({
  id,
  title,
  open,
  onToggle,
  count,
  items,
  renderItem,
  canEdit,
  onAdd,
  addLabel,
  emptyMessage,
}: EmergencyAccordionSectionProps<T>): ReactElement {
  const addButton = (
    <Button
      variant="secondary"
      size="sm"
      leftIcon={<Icon name="add-outline" size="row" />}
      onClick={onAdd}
    >
      {addLabel}
    </Button>
  );

  return (
    <Accordion
      id={id}
      title={title}
      open={open}
      onToggle={onToggle}
      meta={count > 0 ? count : undefined}
    >
      {count > 0 ? (
        <>
          {items.map((item, index) => (
            <Fragment key={index}>{renderItem(item, index)}</Fragment>
          ))}
          {canEdit && <div className="no-print">{addButton}</div>}
        </>
      ) : (
        <EmptySection message={emptyMessage} action={canEdit ? addButton : undefined} />
      )}
    </Accordion>
  );
}

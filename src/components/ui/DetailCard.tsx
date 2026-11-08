import type { ReactElement, ReactNode } from 'react';
import { Avatar } from './Avatar';
import { Card } from './Card';
import { Eyebrow } from './Eyebrow';

/**
 * The approved detail layout's pieces (owner design pass 2026-11-08), lifted from
 * `ShiftDetailModal` (a380e81) so the shift, medication and event details are drawn by ONE set of
 * styles: one outlined card, uppercase small labels, no per-row icons, short facts in two columns.
 *
 *   <DetailCard>
 *     <DetailSection><DetailField label="When">…</DetailField></DetailSection>
 *     <DetailSection columns={2}>
 *       <DetailField label="Refill">…</DetailField>
 *       <DetailField label="Assigned to">…</DetailField>
 *     </DetailSection>
 *   </DetailCard>
 *
 * Every section is its OWN `<dl>`: a `<dl>` may only hold `<div>` groups of `<dt>`/`<dd>` (axe
 * `definition-list`), never a nested grid div. Sections are separated by the weak hairline
 * (`--color-line-2`, mobile's `CC.hair`); `first:` keeps conditional sections from leaving a stray
 * rule on top.
 */
export function DetailCard({
  children,
  className,
  'data-testid': testId,
}: {
  children: ReactNode;
  className?: string;
  'data-testid'?: string;
}): ReactElement {
  return (
    <Card
      variant="outlined"
      padding="none"
      className={['px-4', className].filter(Boolean).join(' ')}
      data-testid={testId}
    >
      {children}
    </Card>
  );
}

export function DetailSection({
  columns = 1,
  children,
  'data-testid': testId,
}: {
  /** 2 = the short facts side by side (WHEN | REPEATS, REFILL | ASSIGNED TO). */
  columns?: 1 | 2;
  children: ReactNode;
  'data-testid'?: string;
}): ReactElement {
  return (
    <dl
      data-testid={testId}
      className={`m-0 border-t border-line-2 py-3.5 first:border-t-0 ${
        columns === 2 ? 'grid grid-cols-2 gap-4' : 'flex flex-col gap-4'
      }`}
    >
      {children}
    </dl>
  );
}

/**
 * One fact: an uppercase small label over its value. `children` is the value (a `<dd>` is drawn
 * for it); `extra` adds more `<dd>`s under it (a second time zone, a rotation line).
 */
export function DetailField({
  label,
  children,
  extra,
  valueTestId,
  valueClassName,
}: {
  label: string;
  children: ReactNode;
  extra?: ReactNode;
  valueTestId?: string;
  /** Long free text (instructions, details) reads at regular weight and keeps its line breaks. */
  valueClassName?: string;
}): ReactElement {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <Eyebrow as="dt" className="m-0">
        {label}
      </Eyebrow>
      <dd
        data-testid={valueTestId}
        className={`m-0 break-words text-base text-ink ${valueClassName ?? 'font-medium'}`}
      >
        {children}
      </dd>
      {extra}
    </div>
  );
}

/**
 * The person chip by a detail's title (avatar + first name), as on the shift detail. Static text,
 * not a control: `spokenPrefix` ("Assigned to") is read before the name so the chip is not an
 * unexplained name. A long name truncates; the chip wraps under a title that leaves no room
 * (the header row is `flex-wrap`).
 */
export function PersonChip({
  name,
  spokenPrefix,
  avatar = true,
  'data-testid': testId,
}: {
  name: string;
  spokenPrefix: string;
  /** False for a chip that names no single person ("Unassigned", "Night · Open shift"). */
  avatar?: boolean;
  'data-testid'?: string;
}): ReactElement {
  return (
    <p
      data-testid={testId}
      className={`m-0 inline-flex max-w-full items-center gap-1.5 rounded-full border border-moss-line bg-moss-soft py-0.5 text-sm font-semibold text-ink ${
        avatar ? 'pl-0.5 pr-3' : 'px-3 py-1'
      }`}
    >
      {avatar && (
        <span aria-hidden="true" className="inline-flex shrink-0">
          <Avatar name={name} size="xs" />
        </span>
      )}
      <span className="sr-only">{`${spokenPrefix}, `}</span>
      <span data-testid={testId ? `${testId}-name` : undefined} className="min-w-0 truncate">
        {name}
      </span>
    </p>
  );
}

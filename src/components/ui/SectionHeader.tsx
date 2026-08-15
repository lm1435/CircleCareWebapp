import { type ReactElement, type ReactNode } from 'react';
import { Link } from 'react-router-dom';

export interface SectionHeaderProps {
  title: string;
  /** Ties the heading to its section via aria-labelledby. */
  id?: string;
  /** Convenience trailing "view all" link. */
  to?: string;
  linkLabel?: string;
  /** Any other trailing content, when `to`/`linkLabel` do not fit. */
  action?: ReactNode;
}

/**
 * The one section header for the overview cards.
 *
 * Mirrors mobile's components/ui/SectionHeader. This was a local `CardHeader`
 * inside OverviewPage while TodaysMeds drew its own `<h2>` with a `px-1` offset,
 * so one card's heading sat 4px off from its neighbours'. Both now render this.
 */
export function SectionHeader({
  title,
  id,
  to,
  linkLabel,
  action,
}: SectionHeaderProps): ReactElement {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <h2 id={id} className="section-title m-0">
        {title}
      </h2>
      {action ??
        (to && linkLabel ? (
          <Link
            to={to}
            className="shrink-0 text-sm font-medium text-terracotta-deep underline-offset-4 hover:underline"
          >
            {linkLabel}
          </Link>
        ) : null)}
    </div>
  );
}

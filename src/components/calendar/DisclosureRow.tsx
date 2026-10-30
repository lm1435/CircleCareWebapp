import { useId, type ReactElement, type ReactNode } from 'react';
import { Icon } from '@/components/ui';

// A collapsed row that expands in place ("More details", "Doctor  Add", ...).
// The panel stays MOUNTED while collapsed (`hidden`), so field state, ids and
// error focus keep working; the parent opens it when a hidden field errors.

export interface DisclosureRowProps {
  id: string;
  title: string;
  /** Right-hand text while collapsed: "Add", a short value, or a hint line. */
  summary?: string;
  open: boolean;
  onToggle: (next: boolean) => void;
  children: ReactNode;
}

export function DisclosureRow({
  id,
  title,
  summary,
  open,
  onToggle,
  children,
}: DisclosureRowProps): ReactElement {
  const panelId = `${id}-panel`;
  const titleId = useId();
  return (
    <div className="border-b border-line-2 last:border-b-0">
      <button
        id={id}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => onToggle(!open)}
        className="flex min-h-[54px] w-full cursor-pointer items-center justify-between gap-3 border-0 bg-transparent px-0 py-2 text-left text-base text-ink"
      >
        <span id={titleId} className="font-medium">
          {title}
        </span>
        <span className="flex min-w-0 items-center gap-1 text-sm font-semibold text-moss-deep">
          {!open && summary ? <span className="truncate">{summary}</span> : null}
          <Icon name={open ? 'chevron-down' : 'chevron-forward'} size="inline" />
        </span>
      </button>
      <div id={panelId} role="group" aria-labelledby={titleId} hidden={!open} className="pb-4">
        <div className="flex flex-col gap-4">{children}</div>
      </div>
    </div>
  );
}

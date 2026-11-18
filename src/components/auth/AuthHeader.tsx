import type { ReactElement, ReactNode } from 'react';
import { Text } from '@/components/ui';

export interface AuthHeaderProps {
  title: string;
  /** Node, not string — ResetPassword bolds the email inside its lede. */
  subtitle?: ReactNode;
  /** Gives the title an id and makes it programmatically focusable (a step change moves focus here). */
  headingId?: string;
}

/** Screen title + lede shared by every signed-out screen. */
export function AuthHeader({ title, subtitle, headingId }: AuthHeaderProps): ReactElement {
  return (
    <div className="mb-7">
      {headingId ? (
        <Text variant="pageTitle" id={headingId} tabIndex={-1} className="outline-none">
          {title}
        </Text>
      ) : (
        <Text variant="pageTitle">{title}</Text>
      )}
      {subtitle ? (
        <Text variant="body" className="mt-3 text-ink-2!">
          {subtitle}
        </Text>
      ) : null}
    </div>
  );
}

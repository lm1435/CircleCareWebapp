import type { ReactElement, ReactNode } from 'react';
import { Text } from '@/components/ui';

export interface AuthHeaderProps {
  title: string;
  /** Node, not string — ResetPassword bolds the email inside its lede. */
  subtitle?: ReactNode;
}

/** Screen title + lede shared by every signed-out screen. */
export function AuthHeader({ title, subtitle }: AuthHeaderProps): ReactElement {
  return (
    <div className="mb-7">
      <Text variant="authTitle">{title}</Text>
      {subtitle ? (
        <Text variant="body" className="mt-3 text-ink-2!">
          {subtitle}
        </Text>
      ) : null}
    </div>
  );
}

import type { ReactElement, ReactNode } from 'react';
import { Icon, Text, type IconName } from '@/components/ui';

export interface TerminalStateProps {
  icon: IconName;
  title: string;
  body?: ReactNode;
  /** Action buttons/links rendered below the body. */
  children?: ReactNode;
}

/**
 * Shared "end of the road" screen for the signed-out flow: a badge icon, a
 * heading, an optional body, and a stack of actions. Mirrors mobile's
 * success/error icon-badge screens (forgot-password sent, reset success,
 * reset with no email, OAuth callback error/cancelled, invite dead-ends, 404).
 *
 * The heading renders as an `<h1>` — every one of these screens is a single,
 * self-contained view, so its title is the page's one heading.
 */
export function TerminalState({ icon, title, body, children }: TerminalStateProps): ReactElement {
  return (
    <div className="flex flex-col items-center text-center">
      <div
        // card-shell-ok: decorative icon badge, not a card
        className="mb-6 inline-flex h-[88px] w-[88px] items-center justify-center rounded-full border border-line-2 bg-bg-2"
      >
        <Icon name={icon} size={36} className="text-ink" />
      </div>
      <Text variant="h2" as="h1">
        {title}
      </Text>
      {body ? (
        <Text variant="body" className="mt-3 text-ink-2!">
          {body}
        </Text>
      ) : null}
      {children ? <div className="mt-7 flex w-full flex-col gap-3">{children}</div> : null}
    </div>
  );
}

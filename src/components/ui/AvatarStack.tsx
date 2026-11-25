import type { ReactElement } from 'react';
import { Avatar } from './Avatar';

export interface AvatarStackPerson {
  id: string;
  name: string;
  colorKey?: string | null;
}

export interface AvatarStackProps {
  people: AvatarStackPerson[];
  /** "+N" chip after the last avatar. Hidden at 0. */
  more?: number;
  /** Avatar diameter in px: 28 (Today's Care team row, the default) or 32 (the empty-state Example card;
   *  overlap 10px, like mobile's AvatarStack). */
  size?: 28 | 32;
  testId?: string;
  moreTestId?: string;
  className?: string;
}

/**
 * Overlapping avatars, each in a 2px cream ring (the card surface) so the overlap reads as a cut. Extracted
 * from Today's Care team row (its rendered output is unchanged); mobile twin: `AvatarStack`. Purely visual
 * and `aria-hidden`: the parent names the people.
 */
export function AvatarStack({
  people,
  more = 0,
  size = 28,
  testId,
  moreTestId,
  className,
}: AvatarStackProps): ReactElement {
  const large = size === 32;
  const overlap = large ? '-ml-2.5' : '-ml-2';
  return (
    <span
      className={`flex shrink-0 items-center${className ? ` ${className}` : ''}`}
      aria-hidden="true"
      data-testid={testId}
    >
      {people.map((p, i) => (
        <span key={p.id} className={i === 0 ? '' : overlap}>
          <Avatar size="xs" bordered name={p.name} colorKey={p.colorKey} className={large ? 'h-8 w-8' : undefined} />
        </span>
      ))}
      {more > 0 ? (
        // card-shell-ok: the "+N" avatar chip, a word-sized label.
        <span
          className={`${overlap} inline-flex ${large ? 'h-8 min-w-8' : 'h-7 min-w-7'} items-center justify-center rounded-full border-2 border-cream bg-bg-2 px-1 text-xs font-medium text-ink-2`}
          data-testid={moreTestId}
        >
          {`+${more}`}
        </span>
      ) : null}
    </span>
  );
}

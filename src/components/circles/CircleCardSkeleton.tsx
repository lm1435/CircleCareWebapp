import type { ReactElement } from 'react';
import { Card, Skeleton } from '@/components/ui';

/** Loading placeholder matching the CircleCard shell — same padding (12) and
 *  hairline border, so the layout doesn't shift once the real cards land. */
export function CircleCardSkeleton(): ReactElement {
  return (
    <li className="list-none">
      <Card variant="elevated" padding="none" className="border-[1.5px] border-line-2">
        <div className="flex items-center gap-3 p-3">
          <Skeleton className="h-12 w-12 shrink-0 rounded-full" />
          <div className="min-w-0 flex-1">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="mt-2 h-3 w-40" />
          </div>
        </div>
      </Card>
    </li>
  );
}

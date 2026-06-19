import type { ReactElement } from 'react';
import { Skeleton } from '@/components/ui';

/** Loading placeholder matching the CircleCard layout. */
export function CircleCardSkeleton(): ReactElement {
  return (
    <li className="list-none">
      <div className="h-full rounded-2xl border border-line bg-cream p-6">
        <div className="flex items-start gap-4">
          <Skeleton className="h-16 w-16 shrink-0 rounded-full" />
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-3">
              <Skeleton className="h-6 w-32" />
              <Skeleton className="h-6 w-20 rounded-full" />
            </div>
            <Skeleton className="mt-3 h-4 w-40" />
            <Skeleton className="mt-2 h-4 w-24" />
          </div>
        </div>
      </div>
    </li>
  );
}

import type { ReactElement } from 'react';
import { Text } from '@/components/ui';

export interface AuthDividerProps {
  label: string;
}

/** Hairline rule with a small uppercase label — "or continue with". */
export function AuthDivider({ label }: AuthDividerProps): ReactElement {
  return (
    <div className="my-7 flex items-center gap-4" aria-hidden="true">
      <span className="h-px flex-1 bg-line-2" />
      <Text variant="eyebrow" className="tracking-[1.5px]">
        {label}
      </Text>
      <span className="h-px flex-1 bg-line-2" />
    </div>
  );
}

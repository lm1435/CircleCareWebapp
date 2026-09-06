import type { ReactElement, ReactNode } from 'react';
import { Text } from '@/components/ui';

export interface Field {
  label: string;
  value: ReactNode;
}

export interface FieldListProps {
  fields: Field[];
}

/**
 * Label/value pairs as a definition list (dl/dt/dd) — semantic for screen
 * readers and unambiguous on the printed page. `dt` uses the shared `mono`
 * label treatment; `dd` renders at 16/500 (spec §6.6) — this is
 * life-critical information read under stress.
 */
export function FieldList({ fields }: FieldListProps): ReactElement {
  return (
    <dl className="m-0 grid gap-4">
      {fields.map((field) => (
        <div key={field.label}>
          <Text variant="mono" as="dt" className="mb-0.5">
            {field.label}
          </Text>
          <dd className="m-0 text-md font-medium text-ink">{field.value}</dd>
        </div>
      ))}
    </dl>
  );
}

import type { ReactElement, ReactNode } from 'react';

export interface Field {
  label: string;
  value: ReactNode;
}

export interface FieldListProps {
  fields: Field[];
}

/**
 * Label/value pairs as a definition list (dl/dt/dd) — semantic for screen
 * readers and unambiguous on the printed page. Generous type size: this is
 * life-critical information read under stress.
 */
export function FieldList({ fields }: FieldListProps): ReactElement {
  return (
    <dl className="m-0 grid gap-4">
      {fields.map((field) => (
        <div key={field.label}>
          <dt className="mono mb-0.5">{field.label}</dt>
          <dd className="m-0 text-sm leading-relaxed text-ink">{field.value}</dd>
        </div>
      ))}
    </dl>
  );
}

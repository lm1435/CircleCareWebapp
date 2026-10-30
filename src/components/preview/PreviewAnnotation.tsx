import type { ReactElement } from 'react';

export interface PreviewAnnotationProps {
  text: string;
  className?: string;
}

/**
 * A walkthrough callout: a small moss dot and one sentence of secondary text.
 * Mirrors mobile's `components/preview/PreviewAnnotation.tsx`. The dot is
 * decorative; the text is never coloured (ink-2 on paper keeps AA).
 */
export function PreviewAnnotation({ text, className }: PreviewAnnotationProps): ReactElement {
  return (
    <p className={`m-0 flex items-center gap-2 py-1 text-sm font-medium text-ink-2 ${className ?? ''}`}>
      <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-moss" />
      <span className="flex-1">{text}</span>
    </p>
  );
}

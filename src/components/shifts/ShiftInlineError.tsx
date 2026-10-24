import type { ReactElement } from 'react';

/** The retryable-failure line a shift dialog keeps open with (network / server failure). */
export function ShiftInlineError({
  message,
  testId = 'shift-inline-error',
}: {
  message: string;
  testId?: string;
}): ReactElement | null {
  if (!message) return null;
  return (
    <p
      role="alert"
      data-testid={testId}
      className="m-0 rounded-xl bg-terracotta/10 px-4 py-3 text-sm text-terracotta-deep"
    >
      {message}
    </p>
  );
}

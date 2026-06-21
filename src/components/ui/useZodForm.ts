import { useCallback, useState } from 'react';
import type { z } from 'zod';

/** Field errors keyed by the top-level field name (first path segment). */
export type FieldErrors = Record<string, string>;

/**
 * Validate `values` against a Zod schema and collapse the result into a flat
 * `{ fieldName: message }` map (keyed by the first path segment, first error
 * wins). On success, returns the parsed/typed data.
 *
 * Pure + framework-agnostic so it can be unit-tested without React.
 */
export function validateWithZod<Schema extends z.ZodType>(
  schema: Schema,
  values: unknown
):
  | { success: true; data: z.infer<Schema>; errors: null }
  | { success: false; data: null; errors: FieldErrors } {
  const result = schema.safeParse(values);
  if (result.success) {
    return { success: true, data: result.data, errors: null };
  }

  const errors: FieldErrors = {};
  for (const issue of result.error.issues) {
    const key = issue.path.length > 0 ? String(issue.path[0]) : '_form';
    // First error per field wins (matches typical validate-on-submit UX).
    if (!(key in errors)) {
      errors[key] = issue.message;
    }
  }
  return { success: false, data: null, errors };
}

/**
 * Moves keyboard focus to the first errored field. Looks up the element by
 * `id` (the field id consuming forms pass to the primitives). Falls back to
 * any `[aria-invalid="true"]` if no id match is found.
 */
export function focusFirstError(errors: FieldErrors, order?: string[]): void {
  if (typeof document === 'undefined') return;
  const keys = order ?? Object.keys(errors);
  for (const key of keys) {
    if (!errors[key]) continue;
    const el = document.getElementById(key);
    if (el && typeof (el as HTMLElement).focus === 'function') {
      (el as HTMLElement).focus();
      return;
    }
  }
  const fallback = document.querySelector<HTMLElement>('[aria-invalid="true"]');
  fallback?.focus();
}

export interface UseZodFormResult<Values> {
  /** Current field errors (empty until a failed submit). */
  errors: FieldErrors;
  /**
   * Validate-on-submit. Runs the schema; on success clears errors and calls
   * `onValid` with typed data. On failure, stores field errors and moves focus
   * to the first error (by field id). Returns whether validation passed.
   */
  submit: (values: unknown, onValid: (data: Values) => void) => boolean;
  /** Clear a single field's error (e.g. on change). */
  clearError: (field: string) => void;
  /** Clear all errors. */
  reset: () => void;
}

const EMPTY_ERRORS: FieldErrors = {};

/**
 * Minimal validate-on-submit form helper. Field ids must match the schema's
 * top-level keys for focus-to-first-error to work (the primitives' `id` prop).
 *
 * @param fieldOrder optional explicit field order for focus-to-first-error
 *   (defaults to error insertion order).
 */
export function useZodForm<Schema extends z.ZodType>(
  schema: Schema,
  fieldOrder?: string[]
): UseZodFormResult<z.infer<Schema>> {
  const [errors, setErrors] = useState<FieldErrors>(EMPTY_ERRORS);

  const submit = useCallback(
    (values: unknown, onValid: (data: z.infer<Schema>) => void): boolean => {
      const result = validateWithZod(schema, values);
      if (result.success) {
        setErrors(EMPTY_ERRORS);
        onValid(result.data);
        return true;
      }
      setErrors(result.errors);
      focusFirstError(result.errors, fieldOrder);
      return false;
    },
    [schema, fieldOrder]
  );

  const clearError = useCallback((field: string) => {
    setErrors((prev) => {
      if (!(field in prev)) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });
  }, []);

  const reset = useCallback(() => setErrors(EMPTY_ERRORS), []);

  return { errors, submit, clearError, reset };
}

// Mirrors mobile/src/constants/config.ts responsibilities for the web app.

export const API_TIMEOUT = 30_000; // 30s — same as mobile

export const IS_DEV = import.meta.env.DEV;

/**
 * Dev-only logging helpers. Production builds stay silent — never log
 * tokens, response bodies, emails, or full error objects.
 */
export function devLog(...args: unknown[]): void {
  if (IS_DEV) console.log(...args);
}

export function devWarn(...args: unknown[]): void {
  if (IS_DEV) console.warn(...args);
}

export function devError(...args: unknown[]): void {
  if (IS_DEV) console.error(...args);
}

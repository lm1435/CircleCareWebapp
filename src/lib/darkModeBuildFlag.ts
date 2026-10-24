/**
 * DARK MODE BUILD FLAG (read by vite.config.ts, which publishes the result as
 * `import.meta.env.VITE_DARK_MODE` for src/lib/themeCore.ts and as the
 * `<meta name="cc-dark-mode">` token for public/theme-init.js).
 *
 * ON for every build, `vite build` (production) included: dark mode ships in 1.3.0
 * together with mobile (owner decision 2026-10-24). The default lives here in
 * committed code, so it never depends on a gitignored .env file.
 *
 * KILL SWITCH: `VITE_DARK_MODE=false` (shell or .env.production) forces it OFF for
 * that build: forced light, stored preference ignored, no Settings selector. Any
 * other value, or unset, means ON.
 *
 * Pure and dependency-free so vite.config.ts can import it and vitest can pin it.
 */
export function isDarkModeBuild(value: string | undefined): boolean {
  return value !== 'false';
}

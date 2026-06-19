import type { ReactElement } from 'react';

export interface OAuthButtonsProps {
  onApple: () => void;
  onGoogle: () => void;
  appleLabel: string;
  googleLabel: string;
  disabled?: boolean;
}

/** Apple logo glyph — single-color, painted with `currentColor` (cream on ink). */
function AppleGlyph(): ReactElement {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M16.365 1.43c0 1.14-.417 2.205-1.114 2.99-.85.96-2.225 1.7-3.36 1.61-.137-1.13.42-2.32 1.07-3.06.74-.85 2.04-1.5 3.13-1.54.06.07.07.13.07.06 0-.02.004-.04.004-.06zm3.795 16.94c-.55 1.27-.81 1.83-1.52 2.95-.99 1.56-2.39 3.51-4.13 3.52-1.54.02-1.94-1.01-4.03-1-2.09.01-2.53 1.02-4.07.99-1.74-.02-3.06-1.78-4.05-3.34C-.99 18.06-1.5 13.18.84 10.59c1.13-1.27 2.91-2.07 4.46-2.07 1.58 0 2.57 1.01 3.87 1.01 1.26 0 2.03-1.01 3.86-1.01 1.39 0 2.86.76 3.91 2.06-3.43 1.88-2.87 6.78.22 7.83z" />
    </svg>
  );
}

/** Google "G" glyph — the four brand colors are intentionally specified. */
function GoogleGlyph(): ReactElement {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M23.52 12.27c0-.82-.07-1.6-.21-2.36H12v4.47h6.47a5.53 5.53 0 0 1-2.4 3.63v3.02h3.88c2.27-2.09 3.57-5.17 3.57-8.76z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.96-1.08 7.95-2.91l-3.88-3.02c-1.08.72-2.45 1.16-4.07 1.16-3.13 0-5.78-2.11-6.73-4.96H1.27v3.12A12 12 0 0 0 12 24z"
      />
      <path
        fill="#FBBC05"
        d="M5.27 14.27a7.2 7.2 0 0 1 0-4.54V6.61H1.27a12 12 0 0 0 0 10.78l4-3.12z"
      />
      <path
        fill="#EA4335"
        d="M12 4.77c1.76 0 3.35.61 4.6 1.8l3.44-3.44A11.96 11.96 0 0 0 12 0 12 12 0 0 0 1.27 6.61l4 3.12C6.22 6.88 8.87 4.77 12 4.77z"
      />
    </svg>
  );
}

/**
 * Provider sign-in buttons mirroring mobile's LoginScreen treatment:
 * - Apple: dark ink background, cream text + Apple glyph
 * - Google: bordered/outline surface, multicolor Google "G"
 * Both are real <button>s with accessible names (the visible label), keyboard
 * focusable, and gated by `disabled`. The OAuth broker logic stays in the page.
 */
export function OAuthButtons({
  onApple,
  onGoogle,
  appleLabel,
  googleLabel,
  disabled = false,
}: OAuthButtonsProps): ReactElement {
  const base =
    'flex w-full items-center justify-center gap-2.5 rounded-pill px-5 py-3.5 text-sm font-medium transition-all disabled:cursor-not-allowed disabled:opacity-50';

  return (
    <div className="flex flex-col gap-3">
      <button
        type="button"
        disabled={disabled}
        onClick={onApple}
        className={`${base} border border-ink bg-ink text-cream not-disabled:hover:-translate-y-px`}
      >
        <AppleGlyph />
        {appleLabel}
      </button>
      <button
        type="button"
        disabled={disabled}
        onClick={onGoogle}
        className={`${base} border border-line bg-cream text-ink not-disabled:hover:border-ink`}
      >
        <GoogleGlyph />
        {googleLabel}
      </button>
    </div>
  );
}

import type { ReactElement } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { legalUrl } from '@/lib/legalLinks';
import { Icon, Text } from '@/components/ui';

export interface OAuthButtonsProps {
  onApple: () => void;
  onGoogle: () => void;
  appleLabel: string;
  googleLabel: string;
  disabled?: boolean;
}

/** Google "G" glyph — the four brand colors are intentionally specified. This
 * one hand-drawn SVG is allowlisted (spec §6.1): it is a brand mark, not a
 * substitute for the icon system. */
function GoogleGlyph(): ReactElement {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
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
 * - Apple: dark ink background, cream text + Apple glyph (spec §6.1)
 * - Google: bordered/outline surface, multicolor Google "G"
 * Both are real <button>s with accessible names (the visible label), keyboard
 * focusable, and gated by `disabled`. The OAuth broker logic stays in the page.
 *
 * Renders the shared legal caption below the buttons — Login and Signup both
 * show it (spec §6.1), copy from mobile's `login.socialLegal`.
 */
export function OAuthButtons({
  onApple,
  onGoogle,
  appleLabel,
  googleLabel,
  disabled = false,
}: OAuthButtonsProps): ReactElement {
  const { i18n } = useTranslation('auth');

  return (
    <div className="flex flex-col gap-3">
      <button
        type="button"
        disabled={disabled}
        onClick={onApple}
        className="inline-flex min-h-[52px] w-full items-center justify-center gap-2.5 rounded-lg bg-ink text-md font-semibold text-cream transition-transform duration-fast ease-spring active:scale-[0.97] disabled:opacity-50"
      >
        <Icon name="logo-apple" size="row" />
        {appleLabel}
      </button>
      <button
        type="button"
        disabled={disabled}
        onClick={onGoogle}
        // card-shell-ok: brand button, not a card
        className="inline-flex min-h-[52px] w-full items-center justify-center gap-2.5 rounded-lg border-[1.5px] border-line bg-cream text-md font-semibold text-ink transition-transform duration-fast ease-spring active:scale-[0.97] disabled:opacity-50"
      >
        <GoogleGlyph />
        {googleLabel}
      </button>

      <Text variant="caption" className="mt-3 text-center text-ink-3!">
        {/* These links sit under 44px, but WCAG 2.5.8 exempts an inline link
            within a run of text (Target Size (Minimum), "Exception: ...The
            target is in a sentence or block of text") — enlarging just these
            two words would mean reflowing the whole caption around them. */}
        <Trans
          i18nKey="socialLegal"
          ns="auth"
          components={{
            terms: (
              <a
                className="text-terracotta-deep underline"
                href={legalUrl('terms', i18n.language)}
                target="_blank"
                rel="noreferrer"
              />
            ),
            privacy: (
              <a
                className="text-terracotta-deep underline"
                href={legalUrl('privacy', i18n.language)}
                target="_blank"
                rel="noreferrer"
              />
            ),
          }}
        />
      </Text>
    </div>
  );
}

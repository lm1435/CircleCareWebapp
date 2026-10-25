import { useEffect, useRef, useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import i18n from '@/i18n';
import { Button } from '@/components/ui';
import { useTranslateDetection } from '@/hooks/useTranslateDetection';
import { useUpdateProfile } from '@/hooks/useProfile';
import { Analytics } from '@/lib/analytics';
import { LOCALE_LABELS, type SupportedLanguage } from '@/i18n/locales';

export const TRANSLATE_PROMPT_DISMISSED_KEY = 'cc_translate_prompt_dismissed';

function readDismissed(): boolean {
  try {
    return window.localStorage.getItem(TRANSLATE_PROMPT_DISMISSED_KEY) !== null;
  } catch {
    return false;
  }
}

function writeDismissed(): void {
  try {
    window.localStorage.setItem(TRANSLATE_PROMPT_DISMISSED_KEY, '1');
  } catch {
    // Storage blocked: the dismissal still holds for this page's lifetime.
  }
}

/**
 * One-time, dismissible, NON-modal strip offered when the browser's
 * auto-translate is active: "CircleCare is available in <language>", in the
 * translate target language. Accept persists the language on the PROFILE (the
 * same `useUpdateProfile` mutation as the Profile picker); nothing about the
 * language is written to JS-readable storage — only the dismissal flag.
 * Web-only (mobile has no browser translate).
 */
export function TranslateLanguageBanner(): ReactElement {
  const { suggested } = useTranslateDetection();
  const [dismissed, setDismissed] = useState<boolean>(readDismissed);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const shownFor = useRef<string | null>(null);

  const candidate = suggested && !dismissed ? suggested : null;
  const ready =
    candidate !== null &&
    (loadedFor === candidate || i18n.hasResourceBundle(candidate, 'common'));

  useEffect(() => {
    if (!candidate) return;
    let cancelled = false;
    void Promise.resolve(i18n.loadLanguages(candidate))
      .then(() => {
        if (!cancelled) setLoadedFor(candidate);
      })
      .catch(() => {
        // Load failed: stay hidden rather than show copy in the wrong language.
      });
    return () => {
      cancelled = true;
    };
  }, [candidate]);

  const visible = candidate !== null && ready;

  useEffect(() => {
    if (visible && candidate && shownFor.current !== candidate) {
      shownFor.current = candidate;
      Analytics.translatePromptShown(candidate);
    }
  }, [visible, candidate]);

  const dismiss = (): void => {
    if (!candidate) return;
    Analytics.translatePromptResolved('dismissed', candidate);
    writeDismissed();
    setDismissed(true);
  };

  // Always-mounted status region (like OfflineBanner): the arrival is announced.
  // The strip — and with it useUpdateProfile's QueryClient/Toast requirements —
  // mounts ONLY while there is something to offer, so the layout never pays for
  // (or depends on) those providers on the overwhelmingly common untranslated path.
  return (
    <div role="status" data-testid="translate-banner-region">
      {visible && candidate && <TranslateBannerStrip candidate={candidate} onDismiss={dismiss} />}
    </div>
  );
}

function TranslateBannerStrip({
  candidate,
  onDismiss,
}: {
  candidate: SupportedLanguage;
  onDismiss: () => void;
}): ReactElement {
  const { t } = useTranslation('common');
  const updateProfile = useUpdateProfile();

  const accept = (): void => {
    updateProfile.mutate(
      { language: candidate },
      {
        onSuccess: () => {
          // Mirrors ProfilePage.handleLanguage.
          Analytics.languageChanged(candidate);
          Analytics.translatePromptResolved('accepted', candidate);
        },
      }
    );
  };

  return (
    <div
      data-testid="translate-banner"
      lang={candidate}
      className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-line bg-dusk-soft px-4 py-2 sm:px-6 animate-[fade-in_200ms_ease-out] motion-reduce:animate-none"
    >
      <p className="min-w-0 text-sm leading-snug text-ink">
        {t('translateBanner.message', { lng: candidate, language: LOCALE_LABELS[candidate] })}
      </p>
      <div className="flex items-center gap-2">
        <Button
          variant="primary"
          size="sm"
          loading={updateProfile.isPending}
          onClick={accept}
          className="focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          {t('translateBanner.accept', { lng: candidate, language: LOCALE_LABELS[candidate] })}
        </Button>
        <Button variant="ghost" size="sm" onClick={onDismiss}>
          {t('translateBanner.dismiss', { lng: candidate })}
        </Button>
      </div>
    </div>
  );
}

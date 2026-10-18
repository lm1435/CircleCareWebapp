import { useEffect, useRef, useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon, Sheet, SheetRowPressable, Text } from '@/components/ui';
import { Analytics } from '@/lib/analytics';

/** Per-browser "I want dark mode" vote (fake-door demand test). Holds no PHI. */
export const DARK_MODE_INTEREST_KEY = 'cc.darkModeInterest.v1';

function readVoted(): boolean {
  try {
    return localStorage.getItem(DARK_MODE_INTEREST_KEY) === '1';
  } catch {
    return false;
  }
}

function writeVoted(): void {
  try {
    localStorage.setItem(DARK_MODE_INTEREST_KEY, '1');
  } catch {
    // Storage unavailable: the vote still shows for this page view.
  }
}

function systemPrefersDark(): boolean {
  try {
    return typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-color-scheme: dark)').matches
      : false;
  } catch {
    return false;
  }
}

/**
 * Profile > Appearance: one "Dark mode / Coming soon" row. Dark mode does not
 * exist yet; a tap records interest (analytics + localStorage) and nothing
 * else. Mirrors mobile ProfileScreen's Appearance section.
 */
export function DarkModeInterestRow(): ReactElement {
  const { t } = useTranslation('profile');
  const [voted, setVoted] = useState<boolean>(readVoted);
  const shownRef = useRef(false);

  useEffect(() => {
    if (shownRef.current) return;
    shownRef.current = true;
    Analytics.darkModeInterestShown({ system_dark: systemPrefersDark() });
  }, []);

  const handleClick = (): void => {
    if (voted) return;
    setVoted(true);
    writeVoted();
    Analytics.darkModeInterestTapped({ system_dark: systemPrefersDark() });
  };

  return (
    <div className="mt-6">
      <Text variant="h3" as="h2">
        {t('appearance.title')}
      </Text>
      <Sheet padding="none" className="mt-3">
        <SheetRowPressable
          onClick={handleClick}
          aria-pressed={voted}
          aria-label={voted ? t('appearance.a11yRequested') : t('appearance.a11yComingSoon')}
          data-testid="dark-mode-interest-row"
          className="min-h-[52px]"
        >
          <Icon name="moon-outline" size="row" className="text-ink-2" />
          <Text variant="body" as="span" className="flex-1">
            {t('appearance.darkMode')}
          </Text>
          <Text variant="caption" as="span">
            {voted ? t('appearance.requested') : t('appearance.comingSoon')}
          </Text>
          <Icon
            name={voted ? 'checkmark' : 'chevron-forward'}
            size="row"
            className="text-ink-2"
          />
        </SheetRowPressable>
      </Sheet>
      <div aria-live="polite" data-testid="dark-mode-interest-hint">
        <Text variant="caption" className="mt-2">
          {voted ? t('appearance.thanks') : t('appearance.hint')}
        </Text>
      </div>
    </div>
  );
}

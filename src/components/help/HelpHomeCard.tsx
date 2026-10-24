import { useState, type ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Icon, Sheet, Text } from '@/components/ui';
import { addDays } from '@/components/calendar/dateMath';
import { useEventsPresence } from '@/hooks/useCalendarEvents';
import { scopedKey } from '@/lib/storageScope';
import { useAuthStore } from '@/store/authStore';
import { getDateInTimezone } from '@/utils/timezone';
import { useHelp } from '@/help/useHelp';

const DISMISS_BASE_KEY = 'help_home_card_dismissed';

function readDismissed(): boolean {
  try {
    return window.localStorage.getItem(scopedKey(DISMISS_BASE_KEY)) === 'true';
  } catch {
    return false;
  }
}

function writeDismissed(): void {
  try {
    window.localStorage.setItem(scopedKey(DISMISS_BASE_KEY), 'true');
  } catch {
    // Storage unavailable: dismissal lasts for this page view only.
  }
}

export interface HelpHomeCardProps {
  circleId: string;
  /** The care recipient's IANA zone (the presence window is dated in it). */
  timezone: string;
}

/**
 * Home card for a circle with no activity yet: "New here? Watch how it works"
 * -> help home. "No activity" is the same read the get-started checklist uses
 * (no medication, appointment or task anywhere in the ~30 days back / ~180
 * ahead presence window), so it is a cache hit and disappears the moment the
 * circle has data. Dismissible; dismissal is per signed-in user in
 * localStorage (read and written inside try/catch).
 */
export function HelpHomeCard({ circleId, timezone }: HelpHomeCardProps): ReactElement | null {
  const { t } = useTranslation('help');
  const { articles } = useHelp();
  const userId = useAuthStore((s) => s.user?.id);
  const [dismissedFor, setDismissedFor] = useState<string | null>(null);

  const today = getDateInTimezone(timezone);
  const presence = useEventsPresence(circleId, addDays(today, -30), addDays(today, 180));

  if (articles.length === 0) return null;
  if (dismissedFor === (userId ?? 'anon') || readDismissed()) return null;
  // Only an answered, empty read counts: unknown/failed shows nothing.
  const data = presence.data;
  if (!presence.isSuccess || !data) return null;
  if (data.medication || data.appointment || data.task) return null;

  return (
    <Sheet role="region" aria-label={t('center.homeCardTitle')} padding="md" className="relative">
      <button
        type="button"
        onClick={() => {
          writeDismissed();
          setDismissedFor(userId ?? 'anon');
        }}
        aria-label={t('center.dismiss')}
        className="absolute top-2 right-2 inline-flex h-11 w-11 items-center justify-center rounded-full text-ink-3 transition-colors duration-fast hover:bg-bg-2 hover:text-ink"
      >
        <Icon name="close-outline" size="row" />
      </button>
      <div className="pr-10">
        <Text variant="h3" as="h2">
          {t('center.homeCardTitle')}
        </Text>
        <Link
          to="/help"
          state={{ helpSource: 'home_card' }}
          className="mt-1 inline-flex min-h-[44px] items-center text-sm font-medium text-coral-deep underline underline-offset-4"
        >
          {t('center.homeCardCta')}
        </Link>
      </div>
    </Sheet>
  );
}

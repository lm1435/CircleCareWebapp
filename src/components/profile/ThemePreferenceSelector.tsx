import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { SegmentedControl, Text } from '@/components/ui';
import {
  isDarkModeEnabled,
  isThemePreference,
  useThemeStore,
} from '@/lib/theme';

/**
 * Profile > Appearance: System / Light / Dark. System (the default) follows the
 * device live. The choice is per device (localStorage, lib/theme.ts), so the
 * hint says so. Renders nothing while the dark-mode build flag is off. Mirrors
 * mobile ProfileScreen's Appearance section.
 */
export function ThemePreferenceSelector(): ReactElement | null {
  const { t } = useTranslation('profile');
  const preference = useThemeStore((s) => s.preference);
  const setPreference = useThemeStore((s) => s.setPreference);

  if (!isDarkModeEnabled()) return null;

  return (
    <div className="mt-6" data-testid="theme-preference">
      <Text variant="h3" as="h2">
        {t('appearance.title')}
      </Text>
      <SegmentedControl
        className="mt-3"
        label={t('appearance.themeLabel')}
        value={preference}
        options={[
          { value: 'system', label: t('appearance.themeSystem') },
          { value: 'light', label: t('appearance.themeLight') },
          { value: 'dark', label: t('appearance.themeDark') },
        ]}
        onChange={(value) => {
          if (isThemePreference(value)) setPreference(value);
        }}
      />
      <Text variant="caption" className="mt-2">
        {t('appearance.hint')}
      </Text>
    </div>
  );
}

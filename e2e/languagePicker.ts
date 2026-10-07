import type { Page } from '@playwright/test';
import { expect } from './fixtures';

/**
 * The Settings language picker after the 1.2.2 flip: all eight registry locales, in
 * picker order, each named in its OWN language (endonym) whatever the UI language,
 * with the active one checked. Shared by every i18n-<code> spec.
 */
export const PICKER_LABELS = [
  'English',
  'Español',
  'Français',
  'Français (Canada)',
  'Deutsch',
  'Italiano',
  'Português (Brasil)',
  'Português (Portugal)',
] as const;

export async function expectLanguagePicker(
  page: Page,
  groupName: string,
  active: (typeof PICKER_LABELS)[number]
): Promise<void> {
  const group = page.getByRole('radiogroup', { name: groupName });
  await expect(group).toBeVisible({ timeout: 20_000 });
  const radios = group.getByRole('radio');
  await expect(radios).toHaveCount(PICKER_LABELS.length);
  for (const [i, label] of PICKER_LABELS.entries()) {
    await expect(radios.nth(i)).toHaveAccessibleName(label);
  }
  await expect(group.getByRole('radio', { name: active, exact: true })).toBeChecked();
}

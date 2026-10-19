import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@/i18n';
import i18n from '@/i18n';

const { themePreferenceChanged, registerThemeProperties } = vi.hoisted(() => ({
  themePreferenceChanged: vi.fn(),
  registerThemeProperties: vi.fn(),
}));
vi.mock('@/lib/analytics', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/analytics')>();
  return {
    ...actual,
    Analytics: { ...actual.Analytics, themePreferenceChanged, registerThemeProperties },
  };
});

import { ThemePreferenceSelector } from '@/components/profile/ThemePreferenceSelector';
import { useThemeStore } from '@/lib/theme';

beforeEach(async () => {
  localStorage.clear();
  vi.clearAllMocks();
  document.documentElement.removeAttribute('data-theme');
  act(() => useThemeStore.setState({ preference: 'system', systemDark: false, effective: 'light' }));
  await i18n.changeLanguage('en');
});
afterEach(() => vi.unstubAllEnvs());

describe('ThemePreferenceSelector', () => {
  it('offers System / Light / Dark with System selected by default and a hint', () => {
    render(<ThemePreferenceSelector />);
    expect(screen.getByRole('heading', { name: 'Appearance' })).toBeInTheDocument();
    const tabs = screen.getAllByRole('tab').map((t) => t.textContent);
    expect(tabs).toEqual(['System', 'Light', 'Dark']);
    expect(screen.getByRole('tab', { name: 'System' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tablist', { name: 'Theme' })).toBeInTheDocument();
    expect(screen.getByText(/System follows your device/)).toBeInTheDocument();
  });

  it('choosing Dark sets data-theme, persists it and fires the analytics event', async () => {
    const user = userEvent.setup();
    render(<ThemePreferenceSelector />);
    await user.click(screen.getByRole('tab', { name: 'Dark' }));
    expect(screen.getByRole('tab', { name: 'Dark' })).toHaveAttribute('aria-selected', 'true');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(localStorage.getItem('cc.themePreference.v1')).toBe('dark');
    expect(themePreferenceChanged).toHaveBeenCalledWith({
      theme: 'dark',
      previous: 'system',
      system_dark: false,
      effective: 'dark',
    });
  });

  it('reflects a stored preference', () => {
    act(() => useThemeStore.setState({ preference: 'light', effective: 'light' }));
    render(<ThemePreferenceSelector />);
    expect(screen.getByRole('tab', { name: 'Light' })).toHaveAttribute('aria-selected', 'true');
  });

  it.each([
    ['es', ['Sistema', 'Claro', 'Oscuro']],
    ['fr', ['Système', 'Clair', 'Sombre']],
    ['it', ['Sistema', 'Chiaro', 'Scuro']],
    ['pt', ['Sistema', 'Claro', 'Escuro']],
    ['de', ['System', 'Hell', 'Dunkel']],
  ])('is translated in %s (not English)', async (lng, labels) => {
    await act(async () => {
      await i18n.changeLanguage(lng);
    });
    render(<ThemePreferenceSelector />);
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(labels);
    expect(screen.queryByText(/System follows/)).not.toBeInTheDocument();
  });

  it('renders nothing while the dark-mode build flag is off', () => {
    vi.stubEnv('VITE_DARK_MODE', 'false');
    const { container } = render(<ThemePreferenceSelector />);
    expect(container).toBeEmptyDOMElement();
  });
});

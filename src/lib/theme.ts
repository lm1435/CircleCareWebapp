import { create } from 'zustand';
import { Analytics } from '@/lib/analytics';
import {
  THEME_STORAGE_KEY,
  applyTheme,
  isDarkModeEnabled,
  readStoredThemePreference,
  resolveEffectiveTheme,
  systemPrefersDark,
  writeStoredThemePreference,
  type EffectiveTheme,
  type ThemePreference,
} from '@/lib/themeCore';

export {
  DEFAULT_THEME_PREFERENCE,
  THEME_PREFERENCES,
  THEME_STORAGE_KEY,
  isDarkModeEnabled,
  isThemePreference,
  type EffectiveTheme,
  type ThemePreference,
} from '@/lib/themeCore';

/**
 * Theme preference store (client state, per device, no backend). See
 * lib/themeCore.ts for the model and the build flag.
 */
interface ThemeState {
  preference: ThemePreference;
  systemDark: boolean;
  effective: EffectiveTheme;
  setPreference: (next: ThemePreference) => void;
}

function snapshot(preference: ThemePreference, systemDark: boolean) {
  return { preference, systemDark, effective: resolveEffectiveTheme(preference, systemDark) };
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  ...snapshot(readStoredThemePreference(), systemPrefersDark()),
  setPreference: (next) => {
    if (!isDarkModeEnabled()) return;
    const { preference: previous, systemDark } = get();
    writeStoredThemePreference(next);
    const state = snapshot(next, systemDark);
    set(state);
    applyTheme(state.effective, state.preference);
    if (next !== previous) {
      Analytics.themePreferenceChanged({
        theme: next,
        previous,
        system_dark: systemDark,
        effective: state.effective,
      });
    }
    Analytics.registerThemeProperties({
      theme: state.effective,
      theme_preference: state.preference,
    });
  },
}));

/**
 * Hydrate from storage + the device, paint, and keep following both: the
 * `prefers-color-scheme` media query (System follows the device LIVE, including
 * scheduled sunset switches) and the `storage` event (another tab changed the
 * preference). Returns the cleanup. Call once, from main.tsx.
 */
export function initTheme(): () => void {
  const sync = (): void => {
    const state = snapshot(readStoredThemePreference(), systemPrefersDark());
    useThemeStore.setState(state);
    applyTheme(state.effective, state.preference);
  };
  sync();
  Analytics.registerThemeProperties({
    theme: useThemeStore.getState().effective,
    theme_preference: useThemeStore.getState().preference,
  });

  const cleanups: Array<() => void> = [];

  try {
    if (typeof window.matchMedia === 'function') {
      const query = window.matchMedia('(prefers-color-scheme: dark)');
      const onChange = (): void => {
        const { preference } = useThemeStore.getState();
        const state = snapshot(preference, systemPrefersDark());
        useThemeStore.setState(state);
        applyTheme(state.effective, state.preference);
        if (preference === 'system') {
          Analytics.registerThemeProperties({
            theme: state.effective,
            theme_preference: state.preference,
          });
        }
      };
      if (typeof query.addEventListener === 'function') {
        query.addEventListener('change', onChange);
        cleanups.push(() => query.removeEventListener('change', onChange));
      } else if (typeof query.addListener === 'function') {
        query.addListener(onChange);
        cleanups.push(() => query.removeListener(onChange));
      }
    }
  } catch {
    // Without matchMedia the theme simply stays at its boot value.
  }

  const onStorage = (event: StorageEvent): void => {
    if (event.key === THEME_STORAGE_KEY || event.key === null) sync();
  };
  window.addEventListener('storage', onStorage);
  cleanups.push(() => window.removeEventListener('storage', onStorage));

  return () => cleanups.forEach((fn) => fn());
}

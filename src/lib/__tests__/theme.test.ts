import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const themePreferenceChanged = vi.fn();
const registerThemeProperties = vi.fn();
vi.mock('@/lib/analytics', () => ({
  Analytics: { themePreferenceChanged, registerThemeProperties },
}));

type Listener = () => void;
let systemDark = false;
const listeners = new Set<Listener>();
function installMatchMedia(): void {
  window.matchMedia = ((query: string) => ({
    get matches() {
      return query.includes('dark') ? systemDark : false;
    },
    media: query,
    addEventListener: (_: string, cb: Listener) => listeners.add(cb),
    removeEventListener: (_: string, cb: Listener) => listeners.delete(cb),
  })) as unknown as typeof window.matchMedia;
}
/** The device flips scheme (e.g. sunset): update the query and notify listeners. */
function flipDevice(dark: boolean): void {
  systemDark = dark;
  listeners.forEach((cb) => cb());
}

async function load() {
  vi.resetModules();
  return import('@/lib/theme');
}
const dataTheme = (): string | null => document.documentElement.getAttribute('data-theme');

beforeEach(() => {
  localStorage.clear();
  systemDark = false;
  listeners.clear();
  installMatchMedia();
  document.head.innerHTML = `<meta name="color-scheme" content="light" />`;
  document.documentElement.removeAttribute('data-theme');
  vi.clearAllMocks();
});
afterEach(() => {
  vi.unstubAllEnvs();
  // @ts-expect-error jsdom has no matchMedia by default
  delete window.matchMedia;
});

describe('theme store', () => {
  it('hydrates to System and paints the device scheme', async () => {
    systemDark = true;
    const { initTheme, useThemeStore } = await load();
    initTheme();
    expect(useThemeStore.getState()).toMatchObject({
      preference: 'system',
      systemDark: true,
      effective: 'dark',
    });
    expect(dataTheme()).toBe('dark');
  });

  it('hydrates a stored preference', async () => {
    localStorage.setItem('cc.themePreference.v1', 'light');
    systemDark = true;
    const { initTheme, useThemeStore } = await load();
    initTheme();
    expect(useThemeStore.getState().preference).toBe('light');
    expect(dataTheme()).toBe('light');
  });

  it('setPreference persists, repaints and survives a reload', async () => {
    const first = await load();
    first.initTheme();
    first.useThemeStore.getState().setPreference('dark');
    expect(localStorage.getItem('cc.themePreference.v1')).toBe('dark');
    expect(dataTheme()).toBe('dark');

    document.documentElement.removeAttribute('data-theme');
    const second = await load();
    second.initTheme();
    expect(second.useThemeStore.getState().preference).toBe('dark');
    expect(dataTheme()).toBe('dark');
  });

  it('System follows the device LIVE; an explicit choice does not', async () => {
    const { initTheme, useThemeStore } = await load();
    const stop = initTheme();
    expect(dataTheme()).toBe('light');

    flipDevice(true);
    expect(dataTheme()).toBe('dark');
    expect(useThemeStore.getState().effective).toBe('dark');
    flipDevice(false);
    expect(dataTheme()).toBe('light');

    useThemeStore.getState().setPreference('light');
    flipDevice(true);
    expect(dataTheme()).toBe('light');
    expect(useThemeStore.getState().systemDark).toBe(true);

    stop();
    expect(listeners.size).toBe(0);
  });

  it('follows a preference written by another tab (storage event)', async () => {
    const { initTheme } = await load();
    initTheme();
    localStorage.setItem('cc.themePreference.v1', 'dark');
    window.dispatchEvent(new StorageEvent('storage', { key: 'cc.themePreference.v1' }));
    expect(dataTheme()).toBe('dark');
  });

  it('keeps working when storage throws', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const { initTheme, useThemeStore } = await load();
    initTheme();
    expect(() => useThemeStore.getState().setPreference('dark')).not.toThrow();
    expect(dataTheme()).toBe('dark');
    vi.restoreAllMocks();
  });
});

describe('theme analytics', () => {
  it('fires theme_preference_changed with enums + a boolean, then re-registers super properties', async () => {
    systemDark = true;
    const { initTheme, useThemeStore } = await load();
    initTheme();
    registerThemeProperties.mockClear();

    useThemeStore.getState().setPreference('light');

    expect(themePreferenceChanged).toHaveBeenCalledTimes(1);
    expect(themePreferenceChanged).toHaveBeenCalledWith({
      theme: 'light',
      previous: 'system',
      system_dark: true,
      effective: 'light',
    });
    expect(registerThemeProperties).toHaveBeenLastCalledWith({
      theme: 'light',
      theme_preference: 'light',
    });
  });

  it('reports effective dark when System resolves dark', async () => {
    const { initTheme, useThemeStore } = await load();
    initTheme();
    useThemeStore.getState().setPreference('dark');
    useThemeStore.getState().setPreference('system');
    systemDark = true;
    flipDevice(true);
    expect(themePreferenceChanged).toHaveBeenLastCalledWith({
      theme: 'system',
      previous: 'dark',
      system_dark: false,
      effective: 'light',
    });
    expect(registerThemeProperties).toHaveBeenLastCalledWith({
      theme: 'dark',
      theme_preference: 'system',
    });
  });

  it('does not fire the event when the same preference is picked again', async () => {
    const { initTheme, useThemeStore } = await load();
    initTheme();
    useThemeStore.getState().setPreference('system');
    expect(themePreferenceChanged).not.toHaveBeenCalled();
  });

  it('registers the theme super properties on load', async () => {
    localStorage.setItem('cc.themePreference.v1', 'dark');
    const { initTheme } = await load();
    initTheme();
    expect(registerThemeProperties).toHaveBeenCalledWith({
      theme: 'dark',
      theme_preference: 'dark',
    });
  });

  it('properties are enums/booleans only (no free text)', async () => {
    const { initTheme, useThemeStore } = await load();
    initTheme();
    useThemeStore.getState().setPreference('dark');
    const props = themePreferenceChanged.mock.calls[0]![0] as Record<string, unknown>;
    expect(Object.keys(props).sort()).toEqual(['effective', 'previous', 'system_dark', 'theme']);
    for (const [k, v] of Object.entries(props)) {
      if (k === 'system_dark') expect(typeof v).toBe('boolean');
      else expect(['system', 'light', 'dark']).toContain(v);
    }
  });
});

describe('build flag off', () => {
  it('forces light, ignores setPreference and stays silent', async () => {
    vi.stubEnv('VITE_DARK_MODE', 'false');
    localStorage.setItem('cc.themePreference.v1', 'dark');
    systemDark = true;
    const { initTheme, useThemeStore } = await load();
    initTheme();
    expect(dataTheme()).toBe('light');
    useThemeStore.getState().setPreference('dark');
    expect(dataTheme()).toBe('light');
    expect(localStorage.getItem('cc.themePreference.v1')).toBe('dark'); // untouched, not rewritten
    expect(themePreferenceChanged).not.toHaveBeenCalled();
  });
});

import { act, renderHook } from '@testing-library/react';
import i18n from '@/i18n';
import { mapTranslateTarget, useTranslateDetection } from '@/hooks/useTranslateDetection';

const root = document.documentElement;

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

async function simulateTranslate(lang: string): Promise<void> {
  root.classList.add('translated-ltr');
  root.lang = lang;
  await flush();
}

beforeEach(async () => {
  root.classList.remove('translated-ltr', 'translated-rtl');
  await i18n.changeLanguage('en');
  root.lang = 'en';
});

afterEach(() => {
  root.classList.remove('translated-ltr', 'translated-rtl');
});

describe('mapTranslateTarget', () => {
  it('maps regional tags to shipped locales and rejects unshipped ones', () => {
    expect(mapTranslateTarget('es-419')).toBe('es');
    expect(mapTranslateTarget('es-MX')).toBe('es');
    expect(mapTranslateTarget('pt-BR')).toBe('pt');
    expect(mapTranslateTarget('pt-PT')).toBe('pt-PT');
    expect(mapTranslateTarget('zh')).toBeNull();
    expect(mapTranslateTarget('')).toBeNull();
  });
});

describe('useTranslateDetection', () => {
  it('suggests es when translate is active with target es and the UI is en', async () => {
    const { result } = renderHook(() => useTranslateDetection());
    expect(result.current.suggested).toBeNull();
    await simulateTranslate('es');
    expect(result.current.suggested).toBe('es');
  });

  it('detects an already-translated page on mount', () => {
    root.classList.add('translated-rtl');
    root.lang = 'es-419';
    const { result } = renderHook(() => useTranslateDetection());
    expect(result.current.suggested).toBe('es');
  });

  it("ignores the app's own lang writes (no translated-* class)", async () => {
    const { result } = renderHook(() => useTranslateDetection());
    root.lang = 'es';
    await flush();
    expect(result.current.suggested).toBeNull();
  });

  it('ignores an unsupported translate target', async () => {
    const { result } = renderHook(() => useTranslateDetection());
    await simulateTranslate('zh');
    expect(result.current.suggested).toBeNull();
  });

  it('ignores a target whose base equals the UI base language', async () => {
    const { result } = renderHook(() => useTranslateDetection());
    await simulateTranslate('en-GB');
    expect(result.current.suggested).toBeNull();
  });

  it('clears the suggestion after the UI switches to the target', async () => {
    const { result } = renderHook(() => useTranslateDetection());
    await simulateTranslate('es');
    expect(result.current.suggested).toBe('es');
    await act(async () => {
      await i18n.changeLanguage('es');
    });
    expect(result.current.suggested).toBeNull();
  });

  it('disconnects the observer on unmount', () => {
    const disconnect = vi.spyOn(MutationObserver.prototype, 'disconnect');
    const { unmount } = renderHook(() => useTranslateDetection());
    unmount();
    expect(disconnect).toHaveBeenCalled();
    disconnect.mockRestore();
  });
});

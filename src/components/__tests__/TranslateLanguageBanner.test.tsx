import { act, render, screen, fireEvent } from '@testing-library/react';
import type { Mock } from 'vitest';
import i18n from '@/i18n';
import { TranslateLanguageBanner } from '@/components/TranslateLanguageBanner';

const mutate = vi.fn();
let isPending = false;
vi.mock('@/hooks/useProfile', () => ({
  useUpdateProfile: () => ({ mutate, isPending }),
}));

const analytics = vi.hoisted(() => ({
  translatePromptShown: vi.fn(),
  translatePromptResolved: vi.fn(),
  languageChanged: vi.fn(),
}));
vi.mock('@/lib/analytics', () => ({ Analytics: analytics }));

const root = document.documentElement;
const FLAG = 'cc_translate_prompt_dismissed';

async function translateTo(lang: string): Promise<void> {
  await act(async () => {
    root.classList.add('translated-ltr');
    root.lang = lang;
  });
  await act(async () => {
    await Promise.resolve();
  });
}

beforeEach(async () => {
  vi.clearAllMocks();
  isPending = false;
  window.localStorage.clear();
  root.classList.remove('translated-ltr', 'translated-rtl');
  await i18n.changeLanguage('en');
  root.lang = 'en';
});

afterEach(() => {
  root.classList.remove('translated-ltr', 'translated-rtl');
  vi.restoreAllMocks();
});

describe('TranslateLanguageBanner', () => {
  it('renders nothing (but the status region) when translate is not active', () => {
    render(<TranslateLanguageBanner />);
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
    expect(analytics.translatePromptShown).not.toHaveBeenCalled();
  });

  it('shows Spanish copy and fires translate_prompt_shown exactly once', async () => {
    render(<TranslateLanguageBanner />);
    await translateTo('es');
    expect(screen.getByText('CircleCare está disponible en Español')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cambiar a Español' })).toBeInTheDocument();
    await translateTo('es-419');
    expect(analytics.translatePromptShown).toHaveBeenCalledTimes(1);
    expect(analytics.translatePromptShown).toHaveBeenCalledWith('es');
  });

  it('accept calls the profile mutation with { language: es } and fires analytics on success', async () => {
    render(<TranslateLanguageBanner />);
    await translateTo('es');
    fireEvent.click(screen.getByRole('button', { name: 'Cambiar a Español' }));
    expect(mutate).toHaveBeenCalledTimes(1);
    const [vars, opts] = (mutate as Mock).mock.calls[0] as [
      { language: string },
      { onSuccess: () => void },
    ];
    expect(vars).toEqual({ language: 'es' });
    expect(analytics.translatePromptResolved).not.toHaveBeenCalled();
    opts.onSuccess();
    expect(analytics.languageChanged).toHaveBeenCalledWith('es');
    expect(analytics.translatePromptResolved).toHaveBeenCalledWith('accepted', 'es');
    expect(window.localStorage.getItem(FLAG)).toBeNull();
  });

  it('banner unmounts once the UI language switches to the target', async () => {
    render(<TranslateLanguageBanner />);
    await translateTo('es');
    await act(async () => {
      await i18n.changeLanguage('es');
    });
    expect(screen.queryByTestId('translate-banner')).toBeNull();
  });

  it('dismiss hides, sets the flag and fires resolved dismissed', async () => {
    render(<TranslateLanguageBanner />);
    await translateTo('es');
    fireEvent.click(screen.getByRole('button', { name: 'Ahora no' }));
    expect(screen.queryByTestId('translate-banner')).toBeNull();
    expect(window.localStorage.getItem(FLAG)).not.toBeNull();
    expect(analytics.translatePromptResolved).toHaveBeenCalledWith('dismissed', 'es');
  });

  it('never renders when the dismissal flag is already set', async () => {
    window.localStorage.setItem(FLAG, '1');
    render(<TranslateLanguageBanner />);
    await translateTo('es');
    expect(screen.queryByTestId('translate-banner')).toBeNull();
    expect(analytics.translatePromptShown).not.toHaveBeenCalled();
  });

  it('does not crash when storage throws', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    render(<TranslateLanguageBanner />);
    await translateTo('es');
    expect(screen.getByTestId('translate-banner')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Ahora no' }));
    expect(screen.queryByTestId('translate-banner')).toBeNull();
  });
});

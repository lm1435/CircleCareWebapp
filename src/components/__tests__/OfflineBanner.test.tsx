import { act, render, screen } from '@testing-library/react';
import { onlineManager } from '@tanstack/react-query';
import '@/i18n';
import { OfflineBanner } from '@/components/OfflineBanner';

// The offline banner (owner decision 2026-10-14): slim, calm, non-blocking,
// announced once. Mobile twin: mobile/src/components/OfflineBanner.tsx.

afterEach(() => onlineManager.setOnline(true));

describe('OfflineBanner', () => {
  it('online: renders nothing visible, but its status region is already mounted', () => {
    render(<OfflineBanner />);
    expect(screen.queryByTestId('offline-banner')).toBeNull();
    // Mounted BEFORE the content arrives, so the arrival is what is announced.
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });

  it('offline: shows the two lines inside the status region; reconnect hides it', () => {
    render(<OfflineBanner />);
    const region = screen.getByRole('status');

    act(() => onlineManager.setOnline(false));
    const banner = screen.getByTestId('offline-banner');
    expect(region).toContainElement(banner);
    expect(banner).toHaveTextContent("You're offline");
    expect(banner).toHaveTextContent('Showing saved info. Connect to make changes.');
    // Reduced motion: the fade is switched off by the motion-reduce variant.
    expect(banner.className).toContain('motion-reduce:animate-none');
    // Not a dialog, not an alert: it never takes focus or interrupts.
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();

    act(() => onlineManager.setOnline(true));
    expect(screen.queryByTestId('offline-banner')).toBeNull();
    expect(screen.getByRole('status')).toBe(region);
  });

  it('Spanish: the same mobile wording', async () => {
    const i18n = (await import('@/i18n')).default;
    await act(async () => {
      await i18n.changeLanguage('es');
    });
    try {
      render(<OfflineBanner />);
      act(() => onlineManager.setOnline(false));
      expect(screen.getByTestId('offline-banner')).toHaveTextContent('Sin conexión');
      expect(screen.getByTestId('offline-banner')).toHaveTextContent(
        'Mostrando información guardada. Conéctate para hacer cambios.'
      );
    } finally {
      await act(async () => {
        await i18n.changeLanguage('en');
      });
    }
  });
});

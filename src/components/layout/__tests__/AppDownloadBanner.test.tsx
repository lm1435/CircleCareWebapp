import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@/i18n';
import {
  AppDownloadBanner,
  resetAppDownloadBannerDismissal,
} from '@/components/layout/AppDownloadBanner';

function setUserAgent(ua: string): void {
  Object.defineProperty(window.navigator, 'userAgent', { value: ua, configurable: true });
}

describe('AppDownloadBanner', () => {
  beforeEach(() => {
    resetAppDownloadBannerDismissal();
  });

  afterEach(() => {
    // Remove the own-property override so the jsdom prototype getter returns.
    Reflect.deleteProperty(window.navigator, 'userAgent');
  });

  it('renders the prominent banner with both store buttons on desktop', () => {
    render(<AppDownloadBanner />);

    const region = screen.getByRole('region', { name: 'Get the app' });
    expect(region).toHaveAttribute('data-variant', 'prominent');
    expect(screen.getByText('CircleCare is better in the app.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Download on the App Store' })).toHaveAttribute(
      'href',
      'https://apps.apple.com/app/id6757629684'
    );
    expect(screen.getByRole('link', { name: 'Get it on Google Play' })).toHaveAttribute(
      'href',
      'https://play.google.com/store/apps/details?id=com.circlecare.circlecare'
    );
  });

  it('dismiss hides the banner from the accessibility tree', async () => {
    const user = userEvent.setup();
    render(<AppDownloadBanner />);

    await user.click(screen.getByRole('button', { name: 'Dismiss app download banner' }));

    expect(screen.queryByRole('region')).not.toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('stays dismissed for the rest of the session (in-memory, not storage)', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<AppDownloadBanner />);

    await user.click(screen.getByRole('button', { name: 'Dismiss app download banner' }));
    unmount();

    render(<AppDownloadBanner />);
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
  });

  it('renders a single deep-linked store CTA on iOS', () => {
    setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15');
    render(<AppDownloadBanner />);

    const region = screen.getByRole('region', { name: 'Get the app' });
    expect(region).toHaveAttribute('data-variant', 'prominent');
    expect(screen.getByRole('link', { name: 'Get the app' })).toHaveAttribute(
      'href',
      'https://apps.apple.com/app/id6757629684'
    );
  });

  it('points the smart-banner CTA at the Play Store on Android', () => {
    setUserAgent('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36');
    render(<AppDownloadBanner />);

    expect(screen.getByRole('link', { name: 'Get the app' })).toHaveAttribute(
      'href',
      'https://play.google.com/store/apps/details?id=com.circlecare.circlecare'
    );
  });
});

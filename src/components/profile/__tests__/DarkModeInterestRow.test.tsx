import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@/i18n';
import { DarkModeInterestRow, DARK_MODE_INTEREST_KEY } from '../DarkModeInterestRow';
import { Analytics } from '@/lib/analytics';

describe('DarkModeInterestRow', () => {
  let shown: ReturnType<typeof vi.spyOn>;
  let tapped: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    localStorage.clear();
    shown = vi.spyOn(Analytics, 'darkModeInterestShown').mockImplementation(() => {});
    tapped = vi.spyOn(Analytics, 'darkModeInterestTapped').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('renders the coming-soon state and fires shown once on mount', () => {
    render(<DarkModeInterestRow />);
    const row = screen.getByTestId('dark-mode-interest-row');
    expect(row.tagName).toBe('BUTTON');
    expect(row).toHaveAccessibleName('Dark mode, coming soon');
    expect(row).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByText('Coming soon')).toBeInTheDocument();
    expect(screen.getByText(/Want dark mode\? Tap to let us know/)).toBeInTheDocument();
    expect(shown).toHaveBeenCalledTimes(1);
    expect(shown).toHaveBeenCalledWith({ system_dark: expect.any(Boolean) });
    expect(tapped).not.toHaveBeenCalled();
  });

  it('first click fires tapped once, shows Requested and persists; second click does not fire', async () => {
    const user = userEvent.setup();
    render(<DarkModeInterestRow />);
    const row = screen.getByTestId('dark-mode-interest-row');
    await user.click(row);
    expect(tapped).toHaveBeenCalledTimes(1);
    expect(tapped).toHaveBeenCalledWith({ system_dark: expect.any(Boolean) });
    expect(screen.getByText('Requested')).toBeInTheDocument();
    expect(screen.getByText("Thanks. We've noted your vote.")).toBeInTheDocument();
    expect(row).toHaveAttribute('aria-pressed', 'true');
    expect(row).toHaveAccessibleName('Dark mode, requested');
    expect(localStorage.getItem(DARK_MODE_INTEREST_KEY)).toBe('1');
    await user.click(row);
    expect(tapped).toHaveBeenCalledTimes(1);
  });

  it('hydrates the voted state from localStorage', async () => {
    localStorage.setItem(DARK_MODE_INTEREST_KEY, '1');
    const user = userEvent.setup();
    render(<DarkModeInterestRow />);
    expect(screen.getByText('Requested')).toBeInTheDocument();
    await user.click(screen.getByTestId('dark-mode-interest-row'));
    expect(tapped).not.toHaveBeenCalled();
  });

  it('hint is a polite live region', () => {
    render(<DarkModeInterestRow />);
    expect(screen.getByTestId('dark-mode-interest-hint')).toHaveAttribute('aria-live', 'polite');
  });
});

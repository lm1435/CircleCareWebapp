import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import '@/i18n';
import { Analytics } from '@/lib/analytics';
import { Hero, formatTodayEyebrow } from '../Hero';

// The Today header: "● WEDNESDAY, OCTOBER 28" over "Today for {{name}}".
// Pure presentation, no router.

describe('Hero (Today header)', () => {
  it('reads "Today for {name}" as the page heading', () => {
    render(<Hero recipientName="Mom" recipientTimezone="America/Denver" />);
    expect(screen.getByRole('heading', { level: 1, name: 'Today for Mom' })).toBeInTheDocument();
  });

  it('a self-care circle (or no name yet) reads just "Today"', () => {
    const { rerender } = render(<Hero recipientName="Pat" isSelfCare recipientTimezone="America/Denver" />);
    expect(screen.getByRole('heading', { name: 'Today' })).toBeInTheDocument();
    rerender(<Hero recipientName="" recipientTimezone="America/Denver" />);
    expect(screen.getByRole('heading', { name: 'Today' })).toBeInTheDocument();
  });

  it('never truncates a long name: it wraps', () => {
    render(
      <Hero recipientName="Maria Guadalupe Fernanda Hernandez de la Cruz" recipientTimezone="America/Denver" />
    );
    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading.className).toContain('break-words');
    expect(heading.className).not.toContain('truncate');
  });

  it('no avatar, no date of birth, no "Cared for by"', () => {
    render(<Hero recipientName="Mom" recipientTimezone="America/Denver" />);
    expect(screen.queryByText(/cared for by/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/born/i)).not.toBeInTheDocument();
  });

  it('waits for the recipient zone before drawing the date eyebrow', () => {
    render(<Hero recipientName="Mom" recipientTimezone={null} />);
    expect(screen.getByTestId('overview-hero').querySelectorAll('p').length).toBe(0);
  });

  describe('formatTodayEyebrow', () => {
    // 2026-10-29 03:00 UTC is still Wednesday 28 in Denver, already Thursday 29 in London.
    const instant = new Date('2026-10-29T03:00:00Z');

    it("is the RECIPIENT'S day, not the device's", () => {
      expect(formatTodayEyebrow('America/Denver', 'en', instant)).toBe('Wednesday, October 28');
      expect(formatTodayEyebrow('Europe/London', 'en', instant)).toBe('Thursday, October 29');
    });

    it('follows the viewer language', () => {
      expect(formatTodayEyebrow('America/Denver', 'es', instant)).toBe('miércoles, 28 de octubre');
    });

    it('is null without a zone', () => {
      expect(formatTodayEyebrow(null, 'en', instant)).toBeNull();
    });
  });

  it('draws the eyebrow in the recipient zone', () => {
    render(<Hero recipientName="Mom" recipientTimezone="America/Denver" />);
    expect(screen.getByTestId('overview-hero').textContent).toMatch(/day, \w+ \d+/);
  });

  describe('header controls (1.4.4)', () => {
    // GEAR = CIRCLE SETTINGS (owner 2026-11-25): the owner of an editable circle gets the gear, to Edit circle.
    const renderWithCircle = (
      canEditCircleSettings = true,
      circleSettingsViewer: 'owner' | 'care_recipient' = 'owner'
    ): void => {
      render(
        <MemoryRouter>
          <Hero
            recipientName="Mom"
            recipientTimezone="America/Denver"
            circleId="c1"
            canEditCircleSettings={canEditCircleSettings}
            circleSettingsViewer={circleSettingsViewer}
          />
        </MemoryRouter>
      );
    };

    afterEach(() => vi.restoreAllMocks());

    it("POSITIVE: a person icon opens account Settings and the owner's gear opens Circle settings", () => {
      renderWithCircle();
      expect(screen.getByRole('link', { name: 'Settings' })).toHaveAttribute('href', '/profile');
      expect(screen.getByRole('link', { name: 'Circle settings' })).toHaveAttribute('href', '/circles/c1/settings');
    });

    it('NEGATIVE: the gear is no longer a second door to the Care team (the row is)', () => {
      renderWithCircle();
      expect(screen.queryByRole('link', { name: /care team/i })).toBeNull();
    });

    it('NEGATIVE: no gear for anyone who cannot edit the circle (member, recipient, frozen owner)', () => {
      renderWithCircle(false);
      expect(screen.queryByRole('link', { name: 'Circle settings' })).toBeNull();
      expect(screen.getByRole('link', { name: 'Settings' })).toBeInTheDocument();
    });

    it('POSITIVE: both are 44px round controls shown below xl only', () => {
      renderWithCircle();
      for (const name of ['Settings', 'Circle settings']) {
        const link = screen.getByRole('link', { name });
        expect(link.className).toContain('w-11');
        expect(link.className).toContain('h-11');
        expect(link.className).toContain('xl:hidden');
      }
    });

    it('POSITIVE: pressing them records the source (enum only)', async () => {
      const user = userEvent.setup();
      const gear = vi.spyOn(Analytics, 'circleSettingsOpened').mockImplementation(() => {});
      const care = vi.spyOn(Analytics, 'careTeamOpened').mockImplementation(() => {});
      const acct = vi.spyOn(Analytics, 'accountSettingsOpened').mockImplementation(() => {});
      renderWithCircle();
      await user.click(screen.getByRole('link', { name: 'Circle settings' }));
      expect(gear).toHaveBeenCalledWith('today_header', 'owner');
      expect(care).not.toHaveBeenCalled();
      await user.click(screen.getByRole('link', { name: 'Settings' }));
      expect(acct).toHaveBeenCalledWith('today_header');
    });

    it("POSITIVE: the care recipient's gear records viewer 'care_recipient' (enum only)", async () => {
      const user = userEvent.setup();
      const gear = vi.spyOn(Analytics, 'circleSettingsOpened').mockImplementation(() => {});
      renderWithCircle(true, 'care_recipient');
      await user.click(screen.getByRole('link', { name: 'Circle settings' }));
      expect(gear).toHaveBeenCalledTimes(1);
      expect(gear).toHaveBeenCalledWith('today_header', 'care_recipient');
    });

    it('NEGATIVE: without a circle the header has no such controls', () => {
      render(<Hero recipientName="Mom" recipientTimezone="America/Denver" />);
      expect(screen.queryByRole('link')).toBeNull();
    });
  });
});

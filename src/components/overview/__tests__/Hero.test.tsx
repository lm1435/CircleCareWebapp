import { render, screen } from '@testing-library/react';
import '@/i18n';
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
    expect(screen.getByTestId('overview-hero').querySelectorAll('p,span').length).toBe(0);
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
});

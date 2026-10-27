import { render, screen } from '@testing-library/react';
import '@/i18n';
import { Hero } from '../Hero';
import type { CircleMember } from '@/api/circleMembers';

// Spec §6.3.1. The hero is pure presentation — no hooks, no router — so it
// renders bare.

function member(overrides: Partial<CircleMember> & { id: string }): CircleMember {
  return {
    email: `${overrides.id}@example.com`,
    first_name: null,
    last_name: null,
    role: 'member',
    is_care_recipient: false,
    is_medication_responsible: false,
    joined_at: '2026-01-01T00:00:00Z',
    timezone: null,
    ...overrides,
  };
}

describe('Hero', () => {
  // Compact: avatar LEFT of the name in one row; "Cared for by" under the name.
  it('puts the avatar and the name in one row, with the caregivers under the name', () => {
    render(
      <Hero recipientTimezone="America/New_York" recipientName="Rose Meza" members={[member({ id: 'a', first_name: 'Pat' })]} />
    );
    const header = screen.getByTestId('overview-hero');
    const classes = header.className.split(/\s+/);
    expect(classes).toContain('flex');
    expect(classes).not.toContain('flex-col');
    const [avatarWrap, textColumn] = Array.from(header.children);
    expect(header.children).toHaveLength(2);
    expect(avatarWrap).not.toContainElement(screen.getByRole('heading', { name: 'Rose Meza' }));
    const heading = screen.getByRole('heading', { name: 'Rose Meza' });
    const caredFor = screen.getByText('Cared for by');
    expect(textColumn).toContainElement(heading);
    expect(textColumn).toContainElement(caredFor);
    expect(heading.compareDocumentPosition(caredFor) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('never truncates a long name: it wraps instead', () => {
    const long = 'Maria Guadalupe Hernandez-Villanueva de la Santisima Trinidad';
    render(<Hero recipientTimezone="America/New_York" recipientName={long} members={[]} />);
    const heading = screen.getByRole('heading', { name: long });
    expect(heading.className).toContain('break-words');
    expect(heading.className).not.toMatch(/truncate|line-clamp|whitespace-nowrap/);
  });

  it('renders the recipient name as the page heading', () => {
    render(<Hero recipientTimezone="America/New_York" recipientName="Rose Meza" members={[]} />);
    expect(screen.getByRole('heading', { name: 'Rose Meza' })).toBeInTheDocument();
  });

  it('shows the DOB eyebrow with the born date and computed age', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-05T12:00:00Z'));
    render(<Hero recipientTimezone="America/New_York" recipientName="Rose" recipientDob="1946-03-02" members={[]} />);
    // "Born {{date}} · age {{age}}" — 1946-03-02 has had its 2026 birthday.
    expect(screen.getByText(/Born March 2, 1946 · age 80/)).toBeInTheDocument();
    vi.useRealTimers();
  });

  it('hides the DOB eyebrow when the circle has no date of birth', () => {
    render(<Hero recipientTimezone="America/New_York" recipientName="Rose" recipientDob={null} members={[]} />);
    expect(screen.queryByText(/Born/)).not.toBeInTheDocument();
  });

  it('hides the DOB eyebrow rather than printing NaN for a malformed date', () => {
    render(<Hero recipientTimezone="America/New_York" recipientName="Rose" recipientDob="not-a-date" members={[]} />);
    expect(screen.queryByText(/Born/)).not.toBeInTheDocument();
    expect(screen.queryByText(/NaN/)).not.toBeInTheDocument();
  });

  it('lists up to three caregiver first names and then "+N more"', () => {
    render(
      <Hero
        recipientTimezone="America/New_York"
        recipientName="Rose"
        members={[
          member({ id: 'a', first_name: 'Pat' }),
          member({ id: 'b', first_name: 'Sam' }),
          member({ id: 'c', first_name: 'Lee' }),
          member({ id: 'd', first_name: 'Kim' }),
          member({ id: 'e', first_name: 'Ari' }),
        ]}
      />
    );
    expect(screen.getByText('Cared for by')).toBeInTheDocument();
    expect(screen.getByText('Pat,')).toBeInTheDocument();
    expect(screen.getByText('Sam,')).toBeInTheDocument();
    expect(screen.getByText('Lee')).toBeInTheDocument();
    expect(screen.queryByText(/Kim/)).not.toBeInTheDocument();
    expect(screen.getByText('+2 more')).toBeInTheDocument();
  });

  it('excludes the care recipient from the "cared for by" list', () => {
    render(
      <Hero
        recipientTimezone="America/New_York"
        recipientName="Rose"
        members={[
          member({ id: 'r', first_name: 'Rose', is_care_recipient: true }),
          member({ id: 'a', first_name: 'Pat' }),
        ]}
      />
    );
    expect(screen.getByText('Pat')).toBeInTheDocument();
    // "Rose" appears only as the heading, never as one of her own caregivers.
    expect(screen.getAllByText('Rose')).toHaveLength(1);
  });

  it('hides the "cared for by" row when nobody else is on the team', () => {
    render(
      <Hero
        recipientTimezone="America/New_York"
        recipientName="Rose"
        members={[member({ id: 'r', first_name: 'Rose', is_care_recipient: true })]}
      />
    );
    expect(screen.queryByText('Cared for by')).not.toBeInTheDocument();
  });

  // Self-care circles carry the OWNER's own name in `recipient_name`, and
  // mobile renders that field unconditionally — there is no self-care branch.
  it('shows the same name field on a self-care circle', () => {
    render(<Hero recipientTimezone="America/New_York" recipientName="Pat Lee" members={[member({ id: 'a', first_name: 'Pat' })]} />);
    expect(screen.getByRole('heading', { name: 'Pat Lee' })).toBeInTheDocument();
  });

  // Age is counted on the RECIPIENT's calendar (utils/recipientAge). DOB
  // 1946-10-28 at 2026-10-27T22:00Z: 09:00 on the birthday in Sydney, but
  // still 10-27 in UTC and in Denver.
  describe('age in the recipient frame', () => {
    afterEach(() => vi.useRealTimers());

    it.each([
      ['Australia/Sydney', 80],
      ['America/Denver', 79],
    ])('recipient in %s sees age %i', (zone, age) => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-10-27T22:00:00Z'));
      render(
        <Hero recipientName="Rose" recipientDob="1946-10-28" recipientTimezone={zone} members={[]} />
      );
      expect(screen.getByText(new RegExp(`age ${age}$`))).toBeInTheDocument();
    });

    it('waits for the recipient zone before showing an age', () => {
      render(<Hero recipientName="Rose" recipientDob="1946-03-02" recipientTimezone={null} members={[]} />);
      expect(screen.queryByText(/Born/)).not.toBeInTheDocument();
    });
  });
});

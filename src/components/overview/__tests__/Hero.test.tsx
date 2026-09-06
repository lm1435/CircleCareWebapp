import { render, screen } from '@testing-library/react';
import '@/i18n';
import { Hero, computeAge } from '../Hero';
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
  it('renders the recipient name as the page heading', () => {
    render(<Hero recipientName="Rose Meza" members={[]} />);
    expect(screen.getByRole('heading', { name: 'Rose Meza' })).toBeInTheDocument();
  });

  it('shows the DOB eyebrow with the born date and computed age', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-05T12:00:00Z'));
    render(<Hero recipientName="Rose" recipientDob="1946-03-02" members={[]} />);
    // "Born {{date}} · age {{age}}" — 1946-03-02 has had its 2026 birthday.
    expect(screen.getByText(/Born March 2, 1946 · age 80/)).toBeInTheDocument();
    vi.useRealTimers();
  });

  it('hides the DOB eyebrow when the circle has no date of birth', () => {
    render(<Hero recipientName="Rose" recipientDob={null} members={[]} />);
    expect(screen.queryByText(/Born/)).not.toBeInTheDocument();
  });

  it('hides the DOB eyebrow rather than printing NaN for a malformed date', () => {
    render(<Hero recipientName="Rose" recipientDob="not-a-date" members={[]} />);
    expect(screen.queryByText(/Born/)).not.toBeInTheDocument();
    expect(screen.queryByText(/NaN/)).not.toBeInTheDocument();
  });

  it('lists up to three caregiver first names and then "+N more"', () => {
    render(
      <Hero
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
        recipientName="Rose"
        members={[member({ id: 'r', first_name: 'Rose', is_care_recipient: true })]}
      />
    );
    expect(screen.queryByText('Cared for by')).not.toBeInTheDocument();
  });

  // Self-care circles carry the OWNER's own name in `recipient_name`, and
  // mobile renders that field unconditionally — there is no self-care branch.
  it('shows the same name field on a self-care circle', () => {
    render(<Hero recipientName="Pat Lee" members={[member({ id: 'a', first_name: 'Pat' })]} />);
    expect(screen.getByRole('heading', { name: 'Pat Lee' })).toBeInTheDocument();
  });

  describe('computeAge', () => {
    const NOW = new Date('2026-09-05T12:00:00Z');

    it('has not counted a birthday that has not happened yet this year', () => {
      expect(computeAge('1946-12-31', NOW)).toBe(79);
    });

    it('counts the birthday on the day itself', () => {
      expect(computeAge('1946-09-05', NOW)).toBe(80);
    });

    it('returns null for an unparseable or absurd value', () => {
      expect(computeAge('nonsense', NOW)).toBeNull();
      expect(computeAge('1800-01-01', NOW)).toBeNull();
    });
  });
});

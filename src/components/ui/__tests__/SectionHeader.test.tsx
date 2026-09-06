import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { SectionHeader, type SectionHeaderTone } from '../SectionHeader';
import { TEXT_CLASS } from '../Text';

/**
 * Mirrors mobile's SectionHeader test. The overview cards used to draw two
 * different headings — a local CardHeader in OverviewPage and a bespoke <h2>
 * with a px-1 offset in TodaysMeds — so one card's heading sat 4px off from its
 * neighbours'. These pin the shared treatment.
 */
function renderHeader(ui: React.ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

describe('SectionHeader (spec §4.5)', () => {
  it('renders the title as a level-2 heading', () => {
    renderHeader(<SectionHeader title="Open tasks" />);
    expect(screen.getByRole('heading', { level: 2, name: 'Open tasks' })).toBeInTheDocument();
  });

  it('uses the sectionTitle type variant, not the deprecated .section-title class', () => {
    renderHeader(<SectionHeader title="Today's medications" />);
    const heading = screen.getByRole('heading', { level: 2 });
    for (const c of TEXT_CLASS.sectionTitle.split(' '))
      expect(heading.className.split(' ')).toContain(c);
    expect(heading.className).not.toContain('section-title');
    // px-1 was the 4px offset that made TodaysMeds sit apart from its siblings.
    expect(heading.className).not.toMatch(/\bpx-\d/);
  });

  it('drops to a level-3 heading without changing the type treatment', () => {
    renderHeader(<SectionHeader title="Refills" headingLevel={3} />);
    const heading = screen.getByRole('heading', { level: 3, name: 'Refills' });
    expect(heading.className.split(' ')).toContain('text-lg');
  });

  it('sets the mobile header rhythm: 28 above, 12 below, baseline-aligned action', () => {
    const { container } = renderHeader(<SectionHeader title="Open tasks" />);
    const cls = (container.firstElementChild as HTMLElement).className.split(' ');
    expect(cls).toEqual(
      expect.arrayContaining(['flex', 'items-end', 'justify-between', 'pt-7', 'pb-3'])
    );
  });

  it('associates an id so a section can be labelled by its heading', () => {
    renderHeader(<SectionHeader id="todays-meds-heading" title="Today's medications" />);
    expect(screen.getByRole('heading', { level: 2 })).toHaveAttribute('id', 'todays-meds-heading');
  });

  it('renders an optional eyebrow above the title, clay by default', () => {
    renderHeader(<SectionHeader eyebrow="Today" title="Medications" />);
    const eyebrow = screen.getByText('Today');
    expect(eyebrow.className.split(' ')).toContain('text-clay!');
    expect(eyebrow.className).toContain('uppercase');
    // The eyebrow leads the title.
    expect(eyebrow.nextElementSibling?.tagName).toBe('H2');
  });

  it('takes an eyebrow colour override', () => {
    renderHeader(<SectionHeader eyebrow="Care" eyebrowColor="moss" title="Tasks" />);
    expect(screen.getByText('Care').className.split(' ')).toContain('text-moss!');
  });

  it('renders no eyebrow by default', () => {
    const { container } = renderHeader(<SectionHeader title="Care team" />);
    expect(container.querySelector('.uppercase')).toBeNull();
  });

  it('renders a trailing link with a chevron when given a destination and label', () => {
    renderHeader(<SectionHeader title="Open tasks" to="/circles/1/tasks" linkLabel="View all" />);
    const link = screen.getByRole('link', { name: 'View all' });
    expect(link).toHaveAttribute('href', '/circles/1/tasks');
    expect(link.className.split(' ')).toEqual(
      expect.arrayContaining(['inline-flex', 'items-center', 'gap-1', 'text-sm', 'font-medium'])
    );
    expect(link.querySelector('svg')).not.toBeNull();
  });

  it('gives the trailing action a 44px hit area', () => {
    renderHeader(<SectionHeader title="Open tasks" to="/t" linkLabel="View all" />);
    const link = screen.getByRole('link', { name: 'View all' });
    expect(`${link.className} ${link.parentElement?.className}`).toContain('min-h-[44px]');
  });

  const TONES: Record<SectionHeaderTone, string> = {
    dusk: 'text-dusk',
    clay: 'text-clay',
    moss: 'text-moss',
    terracotta: 'text-terracotta',
    // 14px text on white: full-strength coral is 4.11:1 and fails AA.
    coral: 'text-coral-deep',
  };

  it('links in dusk by default, never in the old coral', () => {
    renderHeader(<SectionHeader title="Activity" to="/a" linkLabel="View all" />);
    const cls = screen.getByRole('link').className.split(' ');
    expect(cls).toContain('text-dusk');
    expect(cls).not.toContain('text-coral-deep');
  });

  it.each(Object.keys(TONES) as SectionHeaderTone[])(
    '%s tones the link in the section colour of the list it opens',
    (tone) => {
      renderHeader(<SectionHeader title="Meds" to="/m" linkLabel="View all" tone={tone} />);
      expect(screen.getByRole('link').className.split(' ')).toContain(TONES[tone]);
    }
  );

  it('renders no link when only a destination is given', () => {
    renderHeader(<SectionHeader title="Open tasks" to="/circles/1/tasks" />);
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('renders no link when only a label is given', () => {
    renderHeader(<SectionHeader title="Open tasks" linkLabel="View all" />);
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('renders no trailing content by default', () => {
    renderHeader(<SectionHeader title="Care team" />);
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('prefers an explicit action over the link shorthand', () => {
    renderHeader(
      <SectionHeader
        title="Care team"
        to="/circles/1/members"
        linkLabel="Manage"
        action={<button type="button">Invite</button>}
      />
    );
    const invite = screen.getByRole('button', { name: 'Invite' });
    expect(invite).toBeInTheDocument();
    expect(invite.parentElement?.className).toContain('min-h-[44px]');
    expect(screen.queryByRole('link', { name: 'Manage' })).not.toBeInTheDocument();
  });
});

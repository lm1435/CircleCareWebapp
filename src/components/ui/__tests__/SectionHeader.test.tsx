import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { SectionHeader } from '../SectionHeader';

/**
 * Mirrors mobile's SectionHeader test. The overview cards used to draw two
 * different headings — a local CardHeader in OverviewPage and a bespoke <h2>
 * with a px-1 offset in TodaysMeds — so one card's heading sat 4px off from its
 * neighbours'. These pin the shared treatment.
 */
function renderHeader(ui: React.ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

describe('SectionHeader', () => {
  it('renders the title as a level-2 heading', () => {
    renderHeader(<SectionHeader title="Open tasks" />);
    expect(screen.getByRole('heading', { level: 2, name: 'Open tasks' })).toBeInTheDocument();
  });

  it('applies the shared section-title treatment with no extra inset', () => {
    renderHeader(<SectionHeader title="Today's medications" />);
    const heading = screen.getByRole('heading', { level: 2 });
    expect(heading).toHaveClass('section-title');
    // px-1 was the 4px offset that made TodaysMeds sit apart from its siblings.
    expect(heading.className).not.toMatch(/\bpx-\d/);
  });

  it('associates an id so a section can be labelled by its heading', () => {
    renderHeader(<SectionHeader id="todays-meds-heading" title="Today's medications" />);
    expect(screen.getByRole('heading', { level: 2 })).toHaveAttribute(
      'id',
      'todays-meds-heading'
    );
  });

  it('renders a trailing link when given a destination and label', () => {
    renderHeader(<SectionHeader title="Open tasks" to="/circles/1/tasks" linkLabel="View all" />);
    const link = screen.getByRole('link', { name: 'View all' });
    expect(link).toHaveAttribute('href', '/circles/1/tasks');
  });

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
    expect(screen.getByRole('button', { name: 'Invite' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Manage' })).not.toBeInTheDocument();
  });
});

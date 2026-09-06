import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '@/i18n';
import { EmptyCircles } from '@/components/circles/EmptyCircles';

function renderEmpty(action?: React.ReactNode, joinAction?: React.ReactNode) {
  render(
    <MemoryRouter>
      <EmptyCircles action={action} joinAction={joinAction} />
    </MemoryRouter>
  );
}

describe('EmptyCircles', () => {
  it('renders the headline, body, and three how-it-works steps', () => {
    renderEmpty();

    expect(screen.getByRole('heading', { name: "Let's set up your care circle" })).toBeInTheDocument();
    expect(
      screen.getByText(
        'A circle is a private space where family and caregivers come together to care for someone you love — medications, appointments, and tasks, all in one place.'
      )
    ).toBeInTheDocument();
    expect(screen.getByText('Create a circle for your loved one.')).toBeInTheDocument();
    expect(screen.getByText('Invite family and caregivers to share the load.')).toBeInTheDocument();
    expect(
      screen.getByText('Everyone sees the same calendar — medications, appointments, and tasks in one place.')
    ).toBeInTheDocument();
  });

  it('links to the invitations page for an already-invited user', () => {
    renderEmpty();

    expect(screen.getByRole('link', { name: 'Check your invitations' })).toHaveAttribute(
      'href',
      '/invites'
    );
  });

  it('shows the download companion-app badges', () => {
    renderEmpty();

    expect(screen.getByText('Prefer your phone? Get the companion app.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Download on the App Store' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Get it on Google Play' })).toBeInTheDocument();
  });

  it('renders the given primary and secondary actions', () => {
    renderEmpty(<button type="button">Create circle</button>, <button type="button">Join with an invite code</button>);

    expect(screen.getByRole('button', { name: 'Create circle' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Join with an invite code' })).toBeInTheDocument();
  });
});

import { render, screen } from '@testing-library/react';
import { TerminalState } from '@/components/auth/TerminalState';

describe('TerminalState', () => {
  it('renders the icon badge, title as the page h1, and body', () => {
    render(
      <TerminalState icon="mail-outline" title="Check your email" body="We sent you a code." />
    );

    expect(screen.getByRole('heading', { level: 1, name: 'Check your email' })).toBeInTheDocument();
    expect(screen.getByText('We sent you a code.')).toBeInTheDocument();
  });

  it('renders no body when omitted', () => {
    render(<TerminalState icon="checkmark" title="Done" />);
    expect(screen.getByRole('heading', { level: 1, name: 'Done' })).toBeInTheDocument();
  });

  it('renders actions passed as children', () => {
    render(
      <TerminalState icon="alert-circle-outline" title="Something went wrong">
        <button type="button">Try again</button>
      </TerminalState>
    );

    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});

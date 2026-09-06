import { render, screen } from '@testing-library/react';
import { AuthHeader } from '@/components/auth/AuthHeader';

describe('AuthHeader', () => {
  it('renders the title as an authTitle-styled h1', () => {
    render(<AuthHeader title="Welcome back" />);

    const heading = screen.getByRole('heading', { level: 1, name: 'Welcome back' });
    expect(heading.className).toMatch(/text-\[34px\]/);
  });

  it('renders the subtitle below the title when given', () => {
    render(<AuthHeader title="Welcome back" subtitle="Sign in to continue" />);

    expect(screen.getByText('Sign in to continue')).toBeInTheDocument();
  });

  it('renders no subtitle paragraph when omitted', () => {
    const { container } = render(<AuthHeader title="Welcome back" />);

    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
    expect(container.querySelector('p')).not.toBeInTheDocument();
  });

  it('accepts a node subtitle (e.g. bolding an email)', () => {
    render(
      <AuthHeader
        title="Reset password"
        subtitle={
          <>
            Code sent to <strong>pat@example.com</strong>
          </>
        }
      />
    );

    expect(screen.getByText('pat@example.com')).toBeInTheDocument();
  });
});

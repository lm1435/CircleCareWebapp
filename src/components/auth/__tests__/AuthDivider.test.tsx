import { render, screen } from '@testing-library/react';
import { AuthDivider } from '@/components/auth/AuthDivider';

describe('AuthDivider', () => {
  it('renders the given label', () => {
    render(<AuthDivider label="or continue with" />);
    expect(screen.getByText('or continue with')).toBeInTheDocument();
  });
});

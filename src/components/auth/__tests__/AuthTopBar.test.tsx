import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@/i18n';
import { AuthTopBar } from '@/components/auth/AuthTopBar';

describe('AuthTopBar', () => {
  it('renders the CIRCLECARE masthead', () => {
    render(<AuthTopBar />);
    expect(screen.getByText('CIRCLECARE')).toBeInTheDocument();
  });

  it('renders no back button when onBack is omitted', () => {
    render(<AuthTopBar />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('renders a back button that calls onBack when provided', async () => {
    const user = userEvent.setup();
    const onBack = vi.fn();
    render(<AuthTopBar onBack={onBack} />);

    const back = screen.getByRole('button', { name: 'Back' });
    await user.click(back);
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});

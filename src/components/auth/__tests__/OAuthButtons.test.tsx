import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@/i18n';
import { OAuthButtons } from '@/components/auth/OAuthButtons';

function renderButtons(disabled = false) {
  const onApple = vi.fn();
  const onGoogle = vi.fn();
  render(
    <OAuthButtons
      appleLabel="Continue with Apple"
      googleLabel="Continue with Google"
      onApple={onApple}
      onGoogle={onGoogle}
      disabled={disabled}
    />
  );
  return { onApple, onGoogle };
}

describe('OAuthButtons', () => {
  it('renders the Apple and Google buttons with their brand glyphs', () => {
    renderButtons();

    const apple = screen.getByRole('button', { name: 'Continue with Apple' });
    const google = screen.getByRole('button', { name: 'Continue with Google' });
    expect(apple.querySelector('svg')).toBeInTheDocument();
    expect(google.querySelector('svg')).toBeInTheDocument();
  });

  it('calls onApple / onGoogle when clicked', async () => {
    const user = userEvent.setup();
    const { onApple, onGoogle } = renderButtons();

    await user.click(screen.getByRole('button', { name: 'Continue with Apple' }));
    await user.click(screen.getByRole('button', { name: 'Continue with Google' }));

    expect(onApple).toHaveBeenCalledTimes(1);
    expect(onGoogle).toHaveBeenCalledTimes(1);
  });

  it('disables both buttons when disabled is true', () => {
    renderButtons(true);

    expect(screen.getByRole('button', { name: 'Continue with Apple' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Continue with Google' })).toBeDisabled();
  });

  it('renders the legal caption with Terms of Service and Privacy Policy links', () => {
    renderButtons();

    const terms = screen.getByRole('link', { name: 'Terms of Service' });
    const privacy = screen.getByRole('link', { name: 'Privacy Policy' });
    expect(terms).toHaveAttribute('href', expect.stringContaining('terms'));
    expect(privacy).toHaveAttribute('href', expect.stringContaining('privacy'));
    expect(
      screen.getByText(/By continuing with Google or Apple, you confirm you are 18 or older/)
    ).toBeInTheDocument();
  });
});

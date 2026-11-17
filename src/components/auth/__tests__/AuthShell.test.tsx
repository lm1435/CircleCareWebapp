import { render, screen } from '@testing-library/react';
import i18n from '@/i18n';
import { AuthShell } from '@/components/auth/AuthShell';

describe('AuthShell', () => {
  it('renders the hero panel hidden below 1024px and shown at xl (≥1024px)', () => {
    render(
      <AuthShell>
        <p>form content</p>
      </AuthShell>
    );

    const hero = screen.getByAltText(/family/i, { exact: false }).closest('aside');
    expect(hero).not.toBeNull();
    expect(hero).toHaveClass('hidden');
    expect(hero).toHaveClass('xl:block');
  });

  it('renders the wordmark using the serif CSS variable, not a Tailwind class', () => {
    render(
      <AuthShell>
        <p>form content</p>
      </AuthShell>
    );

    const wordmark = screen.getByText('CircleCare');
    expect(wordmark).toHaveStyle({ fontFamily: 'var(--font-serif)' });
    expect(wordmark.className).not.toMatch(/\bserif\b/);
  });

  it('renders the form column with no Card border around the children', () => {
    render(
      <AuthShell>
        <p data-testid="form-child">form content</p>
      </AuthShell>
    );

    const child = screen.getByTestId('form-child');
    // Walk up to the column AuthShell renders around `children` and confirm
    // it carries no border/card-surface classes — the form sits directly on
    // paper (spec §6.1), not inside a bordered Card.
    const column = child.parentElement;
    expect(column).not.toBeNull();
    expect(column?.className).not.toMatch(/\bborder\b/);
  });

  it('renders the given children', () => {
    render(
      <AuthShell>
        <p>form content</p>
      </AuthShell>
    );

    expect(screen.getByText('form content')).toBeInTheDocument();
  });

  // 1.4.3 mock A (mobile Welcome parity): only the tagline changes; headline and values stay.
  describe('1.4.3 tagline', () => {
    afterEach(async () => {
      await i18n.changeLanguage('en');
    });

    it('positive: shows the new "start with one medication" line in English', async () => {
      await i18n.changeLanguage('en');
      render(<AuthShell><p>x</p></AuthShell>);
      expect(
        screen.getByText(
          'Start with one medication and its reminder. Invite family when you are ready, for free.'
        )
      ).toBeInTheDocument();
      expect(screen.getByText('Care for them together.')).toBeInTheDocument();
      expect(screen.getByText('Medication reminders everyone can confirm')).toBeInTheDocument();
    });

    it('positive: shows the owner-approved Spanish line', async () => {
      await i18n.changeLanguage('es');
      render(<AuthShell><p>x</p></AuthShell>);
      expect(
        screen.getByText(
          'Empieza con un medicamento y su recordatorio. Invita a tu familia cuando quieras, gratis.'
        )
      ).toBeInTheDocument();
    });

    it('negative: the old "one shared place" tagline is gone and Welcome-only controls never appear', async () => {
      await i18n.changeLanguage('en');
      render(<AuthShell><p>x</p></AuthShell>);
      expect(screen.queryByText(/One shared place for medications/)).toBeNull();
      expect(screen.queryByText('Have a verification code?')).toBeNull();
    });
  });
});

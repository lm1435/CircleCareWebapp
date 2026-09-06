import { render, screen } from '@testing-library/react';
import '@/i18n';
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
});

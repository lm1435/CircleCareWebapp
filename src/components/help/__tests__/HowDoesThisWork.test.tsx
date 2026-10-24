import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import i18n from '@/i18n';
import { HowDoesThisWork } from '@/components/help/HowDoesThisWork';
import { HELP_FIXTURE } from '@/help/__tests__/fixture';

vi.mock('@/help/content', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/help/content')>()),
  getBundledHelpContent: () => HELP_FIXTURE,
}));

describe('HowDoesThisWork', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('links to the article', () => {
    render(
      <MemoryRouter>
        <HowDoesThisWork slug="invite-family" />
      </MemoryRouter>
    );
    const link = screen.getByRole('link', { name: 'How does this work?' });
    expect(link).toHaveAttribute('href', '/help/invite-family');
  });

  it('is translated', async () => {
    await i18n.changeLanguage('es');
    render(
      <MemoryRouter>
        <HowDoesThisWork slug="invite-family" />
      </MemoryRouter>
    );
    expect(screen.getByRole('link', { name: '¿Cómo funciona?' })).toBeInTheDocument();
  });

  it('renders nothing when the article is not in the bundled content', () => {
    const { container } = render(
      <MemoryRouter>
        <HowDoesThisWork slug="nope" />
      </MemoryRouter>
    );
    expect(container).toBeEmptyDOMElement();
  });
});

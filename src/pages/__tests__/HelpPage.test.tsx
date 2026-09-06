import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@/i18n';
import HelpPage from '@/pages/HelpPage';

// HelpPage — static FAQ page, no writes. Asserts the two-level disclosure
// (section accordion -> nested question accordion, both closed by default,
// mirroring mobile HelpScreen's empty expanded-sets initial state), the
// help_item_expanded analytics call firing only on the OPEN transition, and
// the contact / download cards.

const mockHelpItemExpanded = vi.fn();
vi.mock('@/lib/analytics', () => ({
  Analytics: {
    helpItemExpanded: (...args: unknown[]) => mockHelpItemExpanded(...args),
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('HelpPage', () => {
  it('renders every FAQ section title, all collapsed by default', () => {
    render(<HelpPage />);

    const sectionHeader = screen.getByRole('button', { name: 'Getting started' });
    expect(sectionHeader).toHaveAttribute('aria-expanded', 'false');
    // The section's panel (which holds the nested question accordions) is
    // `inert` while collapsed — jsdom mounts it (Accordion never unmounts its
    // children, see Accordion.tsx) but marks it out of the tab order / a11y
    // tree; real browsers additionally hide it from the accessibility tree.
    const panel = document.getElementById('gettingStarted-accordion-panel');
    expect(panel).toHaveAttribute('inert', '');
  });

  it('expands a section to reveal its nested (still-collapsed) questions', async () => {
    const user = userEvent.setup();
    render(<HelpPage />);

    await user.click(screen.getByRole('button', { name: 'Getting started' }));

    const question = screen.getByRole('button', { name: 'What is a care circle?' });
    expect(question).toBeInTheDocument();
    expect(question).toHaveAttribute('aria-expanded', 'false');
  });

  it('nests questions as level-3 headings under the level-2 section heading', async () => {
    const user = userEvent.setup();
    render(<HelpPage />);

    expect(
      screen.getByRole('heading', { level: 2, name: 'Getting started' })
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Getting started' }));

    expect(
      screen.getByRole('heading', { level: 3, name: 'What is a care circle?' })
    ).toBeInTheDocument();
    // Never a sibling h2 — heading navigation should read section then question.
    expect(
      screen.queryByRole('heading', { level: 2, name: 'What is a care circle?' })
    ).not.toBeInTheDocument();
  });

  it('expands a question to reveal its answer and fires help_item_expanded once', async () => {
    const user = userEvent.setup();
    render(<HelpPage />);

    await user.click(screen.getByRole('button', { name: 'Getting started' }));
    const question = screen.getByRole('button', { name: 'What is a care circle?' });
    await user.click(question);

    expect(question).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText(/A care circle is a private group/)).toBeInTheDocument();
    expect(mockHelpItemExpanded).toHaveBeenCalledTimes(1);
    expect(mockHelpItemExpanded).toHaveBeenCalledWith('gettingStarted.0');
  });

  it('does not re-fire help_item_expanded when a question is collapsed again', async () => {
    const user = userEvent.setup();
    render(<HelpPage />);

    await user.click(screen.getByRole('button', { name: 'Getting started' }));
    const question = screen.getByRole('button', { name: 'What is a care circle?' });
    await user.click(question); // expand
    await user.click(question); // collapse

    expect(mockHelpItemExpanded).toHaveBeenCalledTimes(1);
    expect(question).toHaveAttribute('aria-expanded', 'false');
  });

  it('renders a mailto contact CTA and the store download badges', () => {
    render(<HelpPage />);

    const contactLink = screen.getByRole('link', { name: 'Email support' });
    expect(contactLink).toHaveAttribute('href', expect.stringMatching(/^mailto:/));
    expect(screen.getByRole('link', { name: /app store/i })).toBeInTheDocument();
  });
});

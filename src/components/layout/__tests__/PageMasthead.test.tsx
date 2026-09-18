import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import '@/i18n';
import { PageMasthead } from '@/components/layout/PageMasthead';

function renderMasthead(
  props: Partial<React.ComponentProps<typeof PageMasthead>> = {}
): ReturnType<typeof render> {
  return render(
    <MemoryRouter>
      <PageMasthead section="Care" tone="dusk" title="Calendar" {...props} />
    </MemoryRouter>
  );
}

describe('PageMasthead', () => {
  it('renders the section eyebrow with a dot in the section colour', () => {
    renderMasthead({ section: 'Health', tone: 'terracotta' });

    const eyebrow = screen.getByText('Health');
    expect(eyebrow).toHaveClass('text-terracotta!');
    const dot = eyebrow.querySelector('span[aria-hidden="true"]');
    expect(dot).not.toBeNull();
    expect(dot).toHaveClass('bg-terracotta');
  });

  // Every page under a masthead pads its content `px-5`. At `px-7` the title
  // and the right-hand action sat 8px inside the content edges on both sides —
  // title left of the first card, "Upload document" short of the card's edge.
  it('pads the title row on the same 20px gutter as the page content', () => {
    renderMasthead();

    const row = screen.getByRole('heading', { level: 1, name: 'Calendar' }).closest('div.pb-5');
    expect(row).toHaveClass('px-5');
    expect(row).not.toHaveClass('px-7');
  });

  it('renders the title as the editorial h1', () => {
    renderMasthead();

    const title = screen.getByRole('heading', { level: 1, name: 'Calendar' });
    expect(title).toHaveClass('text-[42px]', 'font-semibold', 'leading-[46px]');
  });

  // L3: `compact` used to APPEND `text-xl leading-[35px]` onto
  // `editorialTitle`'s own `text-[42px] leading-[46px]` on the same element —
  // Tailwind's compiled stylesheet ordered the 42px rule after the override,
  // so it always won and `compact` silently did nothing. It now selects a
  // dedicated `editorialTitleCompact` variant instead of layering classes, so
  // there is no cascade for the bigger rule to win.
  it('drops the title to the compact 32/600 size when asked', () => {
    renderMasthead({ compact: true, title: 'Emergency Information' });

    const title = screen.getByRole('heading', { level: 1 });
    expect(title).toHaveClass('text-[32px]', 'font-semibold', 'leading-[35px]');
    expect(title).not.toHaveClass('text-[42px]');
    expect(title).not.toHaveClass('leading-[46px]');
  });

  it('renders the subtitle under the title', () => {
    renderMasthead({ subtitle: 'Rosa · 12 upcoming' });

    expect(screen.getByText('Rosa · 12 upcoming')).toHaveClass('text-md', 'font-medium', 'text-ink');
  });

  it('renders no back control without backTo, but keeps both 44px end spacers', () => {
    renderMasthead();

    expect(screen.queryByRole('link', { name: 'Back' })).not.toBeInTheDocument();
    // Row 1 is [spacer, eyebrow, spacer] whatever it holds, so the eyebrow
    // stays optically centred.
    const row = screen.getByText('Care').parentElement as HTMLElement;
    expect(row.children).toHaveLength(3);
    expect(row.firstElementChild).toHaveClass('h-11', 'w-11');
    expect(row.lastElementChild).toHaveClass('h-11', 'w-11');
  });

  it('renders the back control below xl only (the sidebar is the way back at xl)', () => {
    renderMasthead({ backTo: '/circles/c1' });

    const back = screen.getByRole('link', { name: 'Back' });
    expect(back).toHaveAttribute('href', '/circles/c1');
    expect(back).toHaveClass('xl:hidden');
  });

  it('renders a right action twice: the round control below xl, a labelled button at xl', async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();
    renderMasthead({ rightAction: { name: 'add-outline', label: 'Add event', onClick } });

    const [round, labelled] = screen.getAllByRole('button', { name: 'Add event' });
    expect(round).toHaveClass('xl:hidden');
    expect(round).toHaveClass('w-11', 'h-11');
    // `hidden` lives on the WRAPPER: on the Button itself it lost the cascade to
    // Button's own `inline-flex` and both actions showed at phone width.
    expect(labelled.parentElement).toHaveClass('hidden', 'xl:inline-flex');
    expect(labelled).not.toHaveClass('hidden');
    // The mouse affordance names the action rather than leaving it to a glyph.
    expect(labelled).toHaveTextContent('Add event');

    await user.click(round);
    await user.click(labelled);
    expect(onClick).toHaveBeenCalledTimes(2);
  });

  it('renders a link right action as links at both widths', () => {
    renderMasthead({
      rightAction: { name: 'share-outline', label: 'Invite', to: '/circles/c1/members' },
    });

    const links = screen.getAllByRole('link', { name: 'Invite' });
    expect(links).toHaveLength(2);
    for (const link of links) expect(link).toHaveAttribute('href', '/circles/c1/members');
  });

  it('renders the children slot (the section tabs) beneath the editorial block', () => {
    renderMasthead({ children: <div data-testid="tabs-slot" /> });

    const slot = screen.getByTestId('tabs-slot');
    expect(slot).toBeInTheDocument();
    // Last thing in the header — after row 1 and the editorial block.
    expect(slot.parentElement?.lastElementChild).toBe(slot);
  });
});

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
  // One accent (owner 2026-11-07): the eyebrow is decoration, muted ink in every section.
  it('renders the section eyebrow without a dot, muted ink whatever the tone', () => {
    renderMasthead({ section: 'Health', tone: 'terracotta' });

    const eyebrow = screen.getByText('Health');
    expect(eyebrow).toHaveClass('text-ink-3');
    expect(eyebrow).not.toHaveClass('text-terracotta!');
    expect(eyebrow.querySelector('span[aria-hidden="true"]')).toBeNull();
  });

  // Mobile 1.4.0: the Shell bar label and a hero eyebrow repeating it ("NEW" x3) read as a bug. The masthead
  // carries the section label ONCE, in the chrome strip; the editorial block holds only the title (and subtitle).
  it('shows the section label once: no second eyebrow repeating it above the title', () => {
    renderMasthead({ section: 'Medications', title: "Jennie Test's meds" });

    expect(screen.getAllByText('Medications')).toHaveLength(1);
    const title = screen.getByRole('heading', { level: 1, name: "Jennie Test's meds" });
    expect(title.parentElement?.querySelector('[class*="uppercase"]')).toBeNull();
  });

  // Every page under a masthead pads its content `px-5`. At `px-7` the title
  // and the right-hand action sat 8px inside the content edges on both sides —
  // title left of the first card, "Upload document" short of the card's edge.
  it('pads the title row on the same 20px gutter as the page content', () => {
    renderMasthead();

    const row = screen.getByRole('heading', { level: 1, name: 'Calendar' }).closest('div.pb-4');
    expect(row).toHaveClass('px-5');
    expect(row).not.toHaveClass('px-7');
  });

  it('renders the title as the pageTitle h1 (32/600/38)', () => {
    renderMasthead();

    const title = screen.getByRole('heading', { level: 1, name: 'Calendar' });
    expect(title).toHaveClass('text-xl', 'font-semibold', 'leading-[38px]', 'tracking-[-0.6px]');
    expect(title).not.toHaveClass('text-[42px]');
  });

  it('is one h1 whatever the title length: a long title wraps, never truncates', () => {
    renderMasthead({ title: 'Emergency Information for Maria Guadalupe Hernandez', subtitle: 'x' });

    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    const title = screen.getByRole('heading', { level: 1 });
    expect(title.className).toMatch(/break-words/);
    expect(title.className).not.toMatch(/truncate|line-clamp/);
  });

  it('has no compact variant: the PageMasthead prop is gone', () => {
    renderMasthead({ title: 'Emergency Information' });

    expect(screen.getByRole('heading', { level: 1 })).toHaveClass('text-xl');
  });

  it('keeps the eyebrow out of the heading outline', () => {
    renderMasthead();

    expect(screen.getByText('Care').tagName).toBe('P');
    expect(screen.queryByRole('heading', { name: 'Care' })).not.toBeInTheDocument();
  });

  it('renders no eyebrow element when the section is empty', () => {
    renderMasthead({ section: '' });

    expect(screen.queryByText('Care')).not.toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });

  it('renders the subtitle under the title', () => {
    renderMasthead({ subtitle: 'Rosa · 12 upcoming' });

    expect(screen.getByText('Rosa · 12 upcoming')).toHaveClass('text-md', 'font-medium', 'text-ink-2', 'mt-1');
  });

  it('left-aligns the eyebrow over the left-aligned title: no leading spacer without backTo', () => {
    renderMasthead();

    expect(screen.queryByRole('link', { name: 'Back' })).not.toBeInTheDocument();
    const eyebrow = screen.getByText('Care');
    expect(eyebrow).toHaveClass('flex-1', 'text-left');
    const row = eyebrow.parentElement as HTMLElement;
    // [eyebrow, end slot]: nothing before the eyebrow pushes it off the title's left edge.
    expect(row.firstElementChild).toBe(eyebrow);
    expect(row.lastElementChild).toHaveClass('h-11');
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

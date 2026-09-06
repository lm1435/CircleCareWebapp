import { useState, type ComponentProps, type ReactElement } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@/i18n';
import { AddMenu, type AddMenuType } from '@/components/layout/AddMenu';
import { ICON_FILES, type IconName } from '@/components/ui';

/**
 * `Icon` inlines the raw ionicon markup, so there is no `name` attribute to
 * assert on. The first `d="…"` of each glyph file is unique to that glyph, so
 * matching it proves the option renders that icon and not a lookalike.
 */
function firstPathData(name: IconName): string {
  const d = /\sd="([^"]+)"/.exec(ICON_FILES[name]);
  if (!d) throw new Error(`No path data in ${name}`);
  return d[1];
}

function setup(
  overrides: Partial<ComponentProps<typeof AddMenu>> = {}
): { onClose: () => void; onSelect: (type: AddMenuType) => void } {
  const onClose = vi.fn();
  const onSelect = vi.fn();
  render(
    <AddMenu open onClose={onClose} onSelect={onSelect} canCreate anchor="bottom" {...overrides} />
  );
  return { onClose, onSelect };
}

describe('AddMenu', () => {
  it('renders the four options in mobile order with the matching glyphs', () => {
    setup();

    const items = screen.getAllByRole('menuitem');

    // The visible label is mobile's SHORT form — the four options share one row.
    expect(items.map((el) => el.textContent)).toEqual(['Med', 'Appt', 'Task', 'Note']);
    // WCAG 2.5.3 Label in Name: the accessible name must CONTAIN the visible
    // text, so the visible short label IS the name — no `aria-label` may
    // override it with "Appointment", which does not contain "Appt".
    expect(items.some((el) => el.hasAttribute('aria-label'))).toBe(false);
    expect(screen.getByRole('menuitem', { name: 'Appt' })).toBe(items[1]);
    expect(screen.queryByRole('menuitem', { name: 'Appointment' })).not.toBeInTheDocument();
    // The full word rides along as the tooltip / accessible description.
    expect(items.map((el) => el.getAttribute('title'))).toEqual([
      'Medication',
      'Appointment',
      'Task',
      'Note',
    ]);

    const expected: IconName[] = [
      'medical-outline',
      'calendar-outline',
      'checkbox-outline',
      'pencil-outline',
    ];
    items.forEach((item, i) => {
      const svg = item.querySelector('svg');
      expect(svg).not.toBeNull();
      expect(svg?.outerHTML).toContain(firstPathData(expected[i]));
    });
  });

  it('gives each option its 44x44 tinted disc and a 24px icon', () => {
    setup();

    const items = screen.getAllByRole('menuitem');
    const tints = ['bg-clay', 'bg-dusk', 'bg-moss', 'bg-dusk'];
    items.forEach((item, i) => {
      const disc = item.querySelector('span');
      expect(disc?.className).toContain('h-11 w-11');
      expect(disc?.className).toContain(tints[i]);
      expect(item.querySelector('svg')?.getAttribute('width')).toBe('24');
    });
  });

  it('staggers the option zoom by 40ms starting at 80ms', () => {
    setup();

    expect(screen.getAllByRole('menuitem').map((el) => el.style.animationDelay)).toEqual([
      '80ms',
      '120ms',
      '160ms',
      '200ms',
    ]);
  });

  it('labels the pill "New" and anchors it bottom-centre by default', () => {
    setup();

    const menu = screen.getByRole('menu', { name: 'New' });
    // The pill is a ROW, so Left/Right are the primary arrow keys — announce it.
    expect(menu).toHaveAttribute('aria-orientation', 'horizontal');
    expect(menu.className).toContain('fixed');
    expect(menu.className).toContain('left-1/2');
    expect(menu.className).toContain('rounded-full');
    expect(menu.className).toContain('bg-ink');
  });

  it('anchor="sidebar" positions the pill off the trigger, not the viewport', () => {
    setup({ anchor: 'sidebar' });

    const menu = screen.getByRole('menu', { name: 'New' });
    expect(menu.className).toContain('absolute left-full top-0 ml-2');
    expect(menu.className).not.toContain('fixed');
  });

  it('selecting an option calls onSelect then onClose', () => {
    const { onSelect, onClose } = setup();

    fireEvent.click(screen.getByRole('menuitem', { name: 'Task' }));

    expect(onSelect).toHaveBeenCalledWith('task');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Escape closes', () => {
    const { onClose } = setup();

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('a backdrop click closes', () => {
    const { onClose } = setup();

    fireEvent.click(screen.getByTestId('add-menu-backdrop'));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('renders nothing when the requester cannot create', () => {
    const { container } = render(
      <AddMenu open canCreate={false} onClose={vi.fn()} onSelect={vi.fn()} />
    );

    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('renders nothing when closed', () => {
    const { container } = render(
      <AddMenu open={false} canCreate onClose={vi.fn()} onSelect={vi.fn()} />
    );

    expect(container).toBeEmptyDOMElement();
  });

  it('focuses the first option on open', () => {
    setup();

    expect(screen.getByRole('menuitem', { name: 'Med' })).toHaveFocus();
  });

  it('returns focus to the previously focused control on close', () => {
    function Harness(): ReactElement {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" data-testid="trigger" onClick={() => setOpen(true)}>
            New
          </button>
          <AddMenu open={open} canCreate onClose={() => setOpen(false)} onSelect={vi.fn()} />
        </>
      );
    }
    render(<Harness />);

    const trigger = screen.getByTestId('trigger');
    trigger.focus();
    fireEvent.click(trigger);
    expect(screen.getByRole('menuitem', { name: 'Med' })).toHaveFocus();

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  // L5/K8: the hand-rolled version had no Tab handling at all, so Tab left
  // the backdrop up while focus moved on past it. Rebuilt on `useMenu`, whose
  // shared `onMenuKeyDown` treats Tab as "let focus move naturally, but close
  // the menu" — same contract as the header's circle-switcher/user menus.
  it('Tab closes the menu and restores focus to the trigger', () => {
    function Harness(): ReactElement {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" data-testid="trigger" onClick={() => setOpen(true)}>
            New
          </button>
          <AddMenu open={open} canCreate onClose={() => setOpen(false)} onSelect={vi.fn()} />
        </>
      );
    }
    render(<Harness />);

    const trigger = screen.getByTestId('trigger');
    trigger.focus();
    fireEvent.click(trigger);
    expect(screen.getByRole('menuitem', { name: 'Med' })).toHaveFocus();

    fireEvent.keyDown(screen.getByRole('menu', { name: 'New' }), { key: 'Tab' });

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('arrow keys move between options and wrap', () => {
    setup();

    const menu = screen.getByRole('menu', { name: 'New' });
    fireEvent.keyDown(menu, { key: 'ArrowRight' });
    expect(screen.getByRole('menuitem', { name: 'Appt' })).toHaveFocus();

    fireEvent.keyDown(menu, { key: 'ArrowLeft' });
    expect(screen.getByRole('menuitem', { name: 'Med' })).toHaveFocus();

    fireEvent.keyDown(menu, { key: 'ArrowLeft' });
    expect(screen.getByRole('menuitem', { name: 'Note' })).toHaveFocus();

    fireEvent.keyDown(menu, { key: 'Home' });
    expect(screen.getByRole('menuitem', { name: 'Med' })).toHaveFocus();

    fireEvent.keyDown(menu, { key: 'End' });
    expect(screen.getByRole('menuitem', { name: 'Note' })).toHaveFocus();
  });
});

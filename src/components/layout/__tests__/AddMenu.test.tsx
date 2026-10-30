import { useState, type ComponentProps, type ReactElement } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@/i18n';
import { AddMenu, type AddMenuType } from '@/components/layout/AddMenu';
import { ICON_FILES, type IconName } from '@/components/ui';
import { Analytics } from '@/lib/analytics';
import { resetLargeTextReports } from '@/hooks/useLargeTextLayout';

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
  it('renders Med, Appt, Task, Note, Shift in order with the matching glyphs', () => {
    setup();

    const items = screen.getAllByRole('menuitem');

    // The visible label is mobile's SHORT form — the four options share one row.
    expect(items.map((el) => el.textContent)).toEqual(['Med', 'Appt', 'Task', 'Note', 'Shift']);
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
      'Shift',
    ]);

    const expected: IconName[] = [
      'medical-outline',
      'calendar-outline',
      'checkbox-outline',
      'pencil-outline',
      'time-outline',
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
    const tints = ['bg-menu-clay', 'bg-menu-dusk', 'bg-menu-moss', 'bg-menu-dusk', 'bg-menu-moss'];
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
      '240ms',
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
    expect(menu.className).toContain('bg-menu-pill');
  });

  // The sidebar rail is `overflow-y-auto` (which forces `overflow-x` to auto
  // too) and `sticky` (a stacking context under the z-20 header), so a pill
  // rendered INSIDE it was clipped at the rail's right edge and its backdrop
  // painted beneath the header. Both render through a portal on <body> and
  // the sidebar pill is fixed off the trigger's measured rect instead.
  it('anchor="sidebar" fixes the pill to the right of the measured trigger', () => {
    const trigger = document.createElement('div');
    document.body.appendChild(trigger);
    trigger.getBoundingClientRect = () =>
      ({ top: 76, right: 272, left: 16, bottom: 120, width: 256, height: 44 }) as DOMRect;

    setup({ anchor: 'sidebar', anchorRef: { current: trigger } });

    const menu = screen.getByRole('menu', { name: 'New' });
    expect(menu.className).toContain('fixed');
    expect(menu.className).not.toContain('absolute');
    expect(menu.style.top).toBe('76px');
    expect(menu.style.left).toBe('280px');
    trigger.remove();
  });

  it('renders the backdrop and pill on <body>, outside the caller subtree', () => {
    const onClose = vi.fn();
    const { container } = render(
      <div data-testid="caller">
        <AddMenu open onClose={onClose} onSelect={vi.fn()} canCreate anchor="sidebar" />
      </div>
    );

    expect(container.querySelector('[role="menu"]')).toBeNull();
    expect(container.querySelector('[data-testid="add-menu-backdrop"]')).toBeNull();
    expect(screen.getByTestId('add-menu-backdrop').parentElement).toBe(document.body);
    // Outside every page landmark now, so it carries its own (axe `region`).
    const region = screen.getByRole('region', { name: 'New' });
    expect(region.parentElement).toBe(document.body);
    expect(region).toContainElement(screen.getByRole('menu'));
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
    expect(screen.getByRole('menuitem', { name: 'Shift' })).toHaveFocus();

    fireEvent.keyDown(menu, { key: 'Home' });
    expect(screen.getByRole('menuitem', { name: 'Med' })).toHaveFocus();

    fireEvent.keyDown(menu, { key: 'End' });
    expect(screen.getByRole('menuitem', { name: 'Shift' })).toHaveFocus();
  });
});

describe('AddMenu analytics (simple UI 1.3.1)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.documentElement.style.fontSize = '';
    resetLargeTextReports();
  });

  it('fires add_menu_opened once when the menu opens, not while it stays open', () => {
    const opened = vi.spyOn(Analytics, 'addMenuOpened');
    const { rerender } = render(<AddMenu open onClose={vi.fn()} onSelect={vi.fn()} canCreate />);
    expect(opened).toHaveBeenCalledTimes(1);
    expect(opened).toHaveBeenCalledWith('nav');
    rerender(<AddMenu open onClose={vi.fn()} onSelect={vi.fn()} canCreate />);
    expect(opened).toHaveBeenCalledTimes(1);
  });

  it('does not fire add_menu_opened for a menu that never opens (read-only member)', () => {
    const opened = vi.spyOn(Analytics, 'addMenuOpened');
    render(<AddMenu open onClose={vi.fn()} onSelect={vi.fn()} canCreate={false} />);
    expect(opened).not.toHaveBeenCalled();
  });

  it.each([
    ['Med', 'medication'],
    ['Appt', 'appointment'],
    ['Task', 'task'],
    ['Note', 'note'],
    ['Shift', 'shift'],
  ] as const)('tapping %s fires add_menu_option_tapped(%s) and NOT closed_empty', (label, option) => {
    const tapped = vi.spyOn(Analytics, 'addMenuOptionTapped');
    const closedEmpty = vi.spyOn(Analytics, 'addMenuClosedEmpty');
    function Harness(): ReactElement {
      const [open, setOpen] = useState(true);
      return <AddMenu open={open} onClose={() => setOpen(false)} onSelect={vi.fn()} canCreate />;
    }
    render(<Harness />);
    fireEvent.click(screen.getByRole('menuitem', { name: label }));
    expect(tapped).toHaveBeenCalledWith(option);
    expect(tapped).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(closedEmpty).not.toHaveBeenCalled();
  });

  it('closing by the backdrop fires add_menu_closed_empty and no option event', () => {
    const tapped = vi.spyOn(Analytics, 'addMenuOptionTapped');
    const closedEmpty = vi.spyOn(Analytics, 'addMenuClosedEmpty');
    function Harness(): ReactElement {
      const [open, setOpen] = useState(true);
      return <AddMenu open={open} onClose={() => setOpen(false)} onSelect={vi.fn()} canCreate />;
    }
    render(<Harness />);
    fireEvent.click(screen.getByTestId('add-menu-backdrop'));
    expect(closedEmpty).toHaveBeenCalledTimes(1);
    expect(tapped).not.toHaveBeenCalled();
  });

  it('closing with Escape also counts as closed empty', () => {
    const closedEmpty = vi.spyOn(Analytics, 'addMenuClosedEmpty');
    function Harness(): ReactElement {
      const [open, setOpen] = useState(true);
      return <AddMenu open={open} onClose={() => setOpen(false)} onSelect={vi.fn()} canCreate />;
    }
    render(<Harness />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(closedEmpty).toHaveBeenCalledTimes(1);
  });

  it('reports large_text_layout(add_menu) once per session with the measured value', () => {
    const large = vi.spyOn(Analytics, 'largeTextLayout');
    const { rerender } = render(<AddMenu open onClose={vi.fn()} onSelect={vi.fn()} canCreate />);
    expect(large).toHaveBeenCalledWith('add_menu', false);
    rerender(<AddMenu open={false} onClose={vi.fn()} onSelect={vi.fn()} canCreate />);
    rerender(<AddMenu open onClose={vi.fn()} onSelect={vi.fn()} canCreate />);
    expect(large).toHaveBeenCalledTimes(1);
  });
});

describe('AddMenu large text', () => {
  afterEach(() => {
    document.documentElement.style.fontSize = '';
    resetLargeTextReports();
  });

  it('is a horizontal pill at the default size', () => {
    setup();
    const menu = screen.getByRole('menu', { name: 'New' });
    expect(menu).toHaveAttribute('aria-orientation', 'horizontal');
    expect(menu.className).toContain('rounded-full');
  });

  it('becomes a vertical list of full-word rows at a large root font', () => {
    document.documentElement.style.fontSize = '32px';
    setup();
    const menu = screen.getByRole('menu', { name: 'New' });
    expect(menu).toHaveAttribute('aria-orientation', 'vertical');
    expect(menu.className).toContain('flex-col');
    expect(menu.className).not.toContain('rounded-full');
    const items = screen.getAllByRole('menuitem');
    expect(items.map((el) => el.textContent)).toEqual([
      'Medication',
      'Appointment',
      'Task',
      'Note',
      'Shift',
    ]);
    // The visible text is the accessible name (WCAG 2.5.3).
    expect(screen.getByRole('menuitem', { name: 'Appointment' })).toBe(items[1]);
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(items[1]).toHaveFocus();
  });
});

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@/i18n';
import { MoreMenu, type MoreMenuEntry, type MoreMenuItem } from '../MoreMenu';
import { Modal } from '../Modal';

function makeItems(overrides?: Partial<Record<string, Partial<MoreMenuItem>>>): {
  items: MoreMenuItem[];
  onEdit: ReturnType<typeof vi.fn>;
  onArchive: ReturnType<typeof vi.fn>;
  onDelete: ReturnType<typeof vi.fn>;
} {
  const onEdit = vi.fn();
  const onArchive = vi.fn();
  const onDelete = vi.fn();
  const items: MoreMenuItem[] = [
    { id: 'edit', label: 'Edit', onSelect: onEdit, ...overrides?.edit },
    { id: 'archive', label: 'Archive', onSelect: onArchive, ...overrides?.archive },
    { id: 'delete', label: 'Delete', onSelect: onDelete, danger: true, ...overrides?.delete },
  ];
  return { items, onEdit, onArchive, onDelete };
}

describe('MoreMenu', () => {
  it('renders a trigger with aria-haspopup="menu" and toggles aria-expanded', async () => {
    const user = userEvent.setup();
    const { items } = makeItems();
    render(<MoreMenu items={items} />);

    const trigger = screen.getByRole('button', { name: 'More' });
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger).not.toHaveAttribute('aria-controls');

    await user.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(trigger).toHaveAttribute('aria-controls');

    await user.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger).not.toHaveAttribute('aria-controls');
  });

  it('uses a custom label instead of the default "More"', () => {
    const { items } = makeItems();
    render(<MoreMenu items={items} label="Options" />);

    expect(screen.getByRole('button', { name: 'Options' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'More' })).not.toBeInTheDocument();
  });

  it('aligns the panel right by default and left when align="left"', async () => {
    const user = userEvent.setup();
    const { items } = makeItems();
    const { rerender } = render(<MoreMenu items={items} />);

    await user.click(screen.getByRole('button', { name: 'More' }));
    expect(screen.getByRole('menu').className).toContain('right-0');

    await user.click(screen.getByRole('button', { name: 'More' }));
    rerender(<MoreMenu items={items} align="left" />);
    await user.click(screen.getByRole('button', { name: 'More' }));
    expect(screen.getByRole('menu').className).toContain('left-0');
  });

  it('opens on Enter and focuses the first item', async () => {
    const user = userEvent.setup();
    const { items } = makeItems();
    render(<MoreMenu items={items} />);

    const trigger = screen.getByRole('button', { name: 'More' });
    trigger.focus();
    await user.keyboard('{Enter}');

    expect(screen.getByRole('menuitem', { name: 'Edit' })).toHaveFocus();
  });

  it('cycles focus with ArrowDown and ArrowUp', async () => {
    const user = userEvent.setup();
    const { items } = makeItems();
    render(<MoreMenu items={items} />);

    const trigger = screen.getByRole('button', { name: 'More' });
    trigger.focus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('menuitem', { name: 'Edit' })).toHaveFocus();

    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('menuitem', { name: 'Archive' })).toHaveFocus();

    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('menuitem', { name: 'Delete' })).toHaveFocus();

    await user.keyboard('{ArrowUp}');
    expect(screen.getByRole('menuitem', { name: 'Archive' })).toHaveFocus();
  });

  it('closes on Escape and returns focus to the trigger', async () => {
    const user = userEvent.setup();
    const { items } = makeItems();
    render(<MoreMenu items={items} />);

    const trigger = screen.getByRole('button', { name: 'More' });
    trigger.focus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('menu')).toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('closes on outside click', async () => {
    const user = userEvent.setup();
    const { items } = makeItems();
    render(<MoreMenu items={items} />);

    await user.click(screen.getByRole('button', { name: 'More' }));
    expect(screen.getByRole('menu')).toBeInTheDocument();

    fireEvent.mouseDown(document.body);
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
  });

  it('closes on Tab out of the menu', async () => {
    const user = userEvent.setup();
    const { items } = makeItems();
    render(<MoreMenu items={items} />);

    await user.click(screen.getByRole('button', { name: 'More' }));
    expect(screen.getByRole('menu')).toBeInTheDocument();

    await user.tab();
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('does not close an ancestor Modal on Escape — only the menu itself', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const { items } = makeItems();
    render(
      <Modal title="Details" onClose={onClose} closeLabel="Close" footer={<MoreMenu items={items} />}>
        <p>Body</p>
      </Modal>
    );

    await user.click(screen.getByRole('button', { name: 'More' }));
    expect(screen.getByRole('menu')).toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('calls onSelect and closes the menu when an item is clicked', async () => {
    const user = userEvent.setup();
    const { items, onArchive } = makeItems();
    render(<MoreMenu items={items} />);

    await user.click(screen.getByRole('button', { name: 'More' }));
    await user.click(screen.getByRole('menuitem', { name: 'Archive' }));

    expect(onArchive).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('returns focus to the trigger after selecting an item', async () => {
    const user = userEvent.setup();
    const { items } = makeItems();
    render(<MoreMenu items={items} />);

    const trigger = screen.getByRole('button', { name: 'More' });
    await user.click(trigger);
    await user.click(screen.getByRole('menuitem', { name: 'Archive' }));

    expect(trigger).toHaveFocus();
  });

  it('renders a danger item with the terracotta-deep text class', async () => {
    const user = userEvent.setup();
    const { items } = makeItems();
    render(<MoreMenu items={items} />);

    await user.click(screen.getByRole('button', { name: 'More' }));
    const deleteItem = screen.getByRole('menuitem', { name: 'Delete' });
    expect(deleteItem.className).toContain('text-terracotta-deep');
  });

  it('renders the danger item after the non-danger hairline group', async () => {
    const user = userEvent.setup();
    const { items } = makeItems();
    render(<MoreMenu items={items} />);

    await user.click(screen.getByRole('button', { name: 'More' }));
    const menuItems = screen.getAllByRole('menuitem');
    expect(menuItems.map((el) => el.textContent)).toEqual(['Edit', 'Archive', 'Delete']);

    const deleteItem = screen.getByRole('menuitem', { name: 'Delete' });
    const wrapper = deleteItem.parentElement;
    expect(wrapper).not.toBeNull();
    expect(wrapper?.className).toContain('border-t');
  });

  // ── Anchoring (spec §4.5) ──────────────────────────────────────────────────
  describe('anchoring', () => {
    afterEach(() => {
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
    });

    /** Pin the trigger's bottom edge and give the panel a real height. */
    function layout(triggerBottom: number, panelHeight: number, viewport = 768): void {
      vi.stubGlobal('innerHeight', viewport);
      vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
        bottom: triggerBottom,
        top: triggerBottom - 44,
        left: 0,
        right: 44,
        width: 44,
        height: 44,
        x: 0,
        y: triggerBottom - 44,
        toJSON: () => ({}),
      });
      Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
        configurable: true,
        get: () => panelHeight,
      });
    }

    it('opens BELOW the trigger when there is room underneath', async () => {
      const user = userEvent.setup();
      layout(100, 200);
      const { items } = makeItems();
      render(<MoreMenu items={items} />);

      await user.click(screen.getByRole('button', { name: 'More' }));
      const panel = screen.getByRole('menu');
      expect(panel.className).toContain('top-full');
      expect(panel.className).toContain('mt-1');
      expect(panel.className).not.toContain('bottom-full');
    });

    it('flips ABOVE the trigger when the panel would overflow the viewport', async () => {
      const user = userEvent.setup();
      // 700 (trigger bottom) + 200 (panel) = 900 > 768 (viewport)
      layout(700, 200);
      const { items } = makeItems();
      render(<MoreMenu items={items} />);

      await user.click(screen.getByRole('button', { name: 'More' }));
      const panel = screen.getByRole('menu');
      expect(panel.className).toContain('bottom-full');
      expect(panel.className).toContain('mb-1');
      expect(panel.className).not.toContain('top-full');
    });

    it('defaults to opening downward when nothing can be measured', async () => {
      const user = userEvent.setup();
      const { items } = makeItems();
      render(<MoreMenu items={items} />);

      await user.click(screen.getByRole('button', { name: 'More' }));
      expect(screen.getByRole('menu').className).toContain('top-full');
    });

    // M2 regression: inside a Modal the panel is `overflow-hidden`, so a
    // footer menu that has plenty of room in the WINDOW can still be clipped
    // by the dialog's own bottom edge. The boundary must be the nearest
    // `[role="dialog"]` ancestor, not `window.innerHeight`.
    it('flips ABOVE when a dialog ancestor clips the panel, even with room in the viewport', async () => {
      const user = userEvent.setup();
      // Plenty of room by the (wrong) viewport measure...
      vi.stubGlobal('innerHeight', 2000);
      // ...but the dialog's own bottom edge sits much higher.
      vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
        function (this: HTMLElement) {
          const bottom = this.getAttribute('role') === 'dialog' ? 150 : 100;
          return {
            bottom,
            top: bottom - 44,
            left: 0,
            right: 44,
            width: 44,
            height: 44,
            x: 0,
            y: bottom - 44,
            toJSON: () => ({}),
          } as DOMRect;
        }
      );
      Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
        configurable: true,
        get: () => 200,
      });

      const { items } = makeItems();
      render(
        <div role="dialog">
          <MoreMenu items={items} />
        </div>
      );

      await user.click(screen.getByRole('button', { name: 'More' }));
      const panel = screen.getByRole('menu');
      expect(panel.className).toContain('bottom-full');
      expect(panel.className).not.toContain('top-full');
    });

    it('placement="up" pins the panel above without measuring', async () => {
      const user = userEvent.setup();
      // Room to spare — auto-measurement would open downward.
      layout(100, 50, 2000);
      const { items } = makeItems();
      render(<MoreMenu items={items} placement="up" />);

      await user.click(screen.getByRole('button', { name: 'More' }));
      expect(screen.getByRole('menu').className).toContain('bottom-full');
    });

    it('placement="down" pins the panel below even when it would overflow', async () => {
      const user = userEvent.setup();
      // Would overflow under auto-measurement.
      layout(700, 200, 768);
      const { items } = makeItems();
      render(<MoreMenu items={items} placement="down" />);

      await user.click(screen.getByRole('button', { name: 'More' }));
      expect(screen.getByRole('menu').className).toContain('top-full');
    });
  });

  it('renders the default trigger as a 44×44 icon button named by its label', () => {
    const { items } = makeItems();
    render(<MoreMenu items={items} />);

    const trigger = screen.getByRole('button', { name: 'More' });
    expect(trigger.className).toContain('h-11');
    expect(trigger.className).toContain('w-11');
    expect(trigger.className).toContain('rounded-full');
    // The glyph is decorative — the button is named by aria-label, not text.
    expect(trigger).toHaveTextContent('');
    expect(trigger.querySelector('svg')).toBeInTheDocument();
  });

  // Spec §4.5 needs MoreMenu as a labelled pill for the Tasks/Vitals/Meds
  // filter + sort controls, not only as the 44×44 ellipsis button.
  describe('renderTrigger', () => {
    function Pill({ items }: { items: MoreMenuEntry[] }) {
      return (
        <MoreMenu
          items={items}
          renderTrigger={(p) => (
            <button {...p} className="min-h-[44px] rounded-full border border-line px-4 text-sm">
              Status: Open
            </button>
          )}
        />
      );
    }

    it('renders a labelled pill instead of the default ellipsis button', async () => {
      const user = userEvent.setup();
      const { items } = makeItems();
      render(<Pill items={items} />);

      const trigger = screen.getByRole('button', { name: 'Status: Open' });
      expect(screen.queryByRole('button', { name: 'More' })).not.toBeInTheDocument();
      expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
      expect(trigger).toHaveAttribute('aria-expanded', 'false');
      expect(trigger).not.toHaveAttribute('aria-controls');
      expect(trigger).toHaveAttribute('id');

      await user.click(trigger);
      expect(trigger).toHaveAttribute('aria-expanded', 'true');
      expect(trigger).toHaveAttribute('aria-controls', screen.getByRole('menu').id);
    });

    it('keeps the keyboard contract and anchors the panel the same way', async () => {
      const user = userEvent.setup();
      const { items, onArchive } = makeItems();
      render(<Pill items={items} />);

      const trigger = screen.getByRole('button', { name: 'Status: Open' });
      trigger.focus();
      await user.keyboard('{Enter}');
      expect(screen.getByRole('menuitem', { name: 'Edit' })).toHaveFocus();
      expect(screen.getByRole('menu').className).toContain('top-full');

      await user.keyboard('{ArrowDown}{Enter}');
      expect(onArchive).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
      expect(trigger).toHaveFocus();
    });
  });

  it('renders an item icon when one is given', async () => {
    const user = userEvent.setup();
    const items: MoreMenuEntry[] = [
      { id: 'edit', label: 'Edit', onSelect: vi.fn(), icon: 'pencil-outline' },
      { id: 'plain', label: 'Plain', onSelect: vi.fn() },
    ];
    render(<MoreMenu items={items} />);

    await user.click(screen.getByRole('button', { name: 'More' }));
    expect(screen.getByRole('menuitem', { name: 'Edit' }).querySelector('svg')).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Plain' }).querySelector('svg')).toBeNull();
  });

  it('renders an explicit { divider: true } entry as a separator, in source order', async () => {
    const user = userEvent.setup();
    const items: MoreMenuEntry[] = [
      { id: 'edit', label: 'Edit', onSelect: vi.fn() },
      { divider: true },
      { id: 'delete', label: 'Delete', onSelect: vi.fn(), danger: true },
      { id: 'archive', label: 'Archive', onSelect: vi.fn() },
    ];
    render(<MoreMenu items={items} />);

    await user.click(screen.getByRole('button', { name: 'More' }));
    expect(screen.getAllByRole('separator')).toHaveLength(1);
    // With an explicit divider the caller owns the order — danger is NOT
    // re-sorted to the bottom.
    expect(screen.getAllByRole('menuitem').map((el) => el.textContent)).toEqual([
      'Edit',
      'Delete',
      'Archive',
    ]);
  });

  it('gives items a 44px row height', async () => {
    const user = userEvent.setup();
    const { items } = makeItems();
    render(<MoreMenu items={items} />);

    await user.click(screen.getByRole('button', { name: 'More' }));
    expect(screen.getByRole('menuitem', { name: 'Edit' }).className).toContain('min-h-[44px]');
  });

  describe('disabled items', () => {
    it('carries aria-disabled instead of the native disabled attribute', async () => {
      const user = userEvent.setup();
      const { items } = makeItems({ archive: { disabled: true } });
      render(<MoreMenu items={items} />);

      await user.click(screen.getByRole('button', { name: 'More' }));
      const archiveItem = screen.getByRole('menuitem', { name: 'Archive' });
      expect(archiveItem).toHaveAttribute('aria-disabled', 'true');
      expect(archiveItem).not.toHaveAttribute('disabled');
    });

    it('does not call onSelect when a disabled item is clicked', async () => {
      const user = userEvent.setup();
      const { items, onArchive } = makeItems({ archive: { disabled: true } });
      render(<MoreMenu items={items} />);

      await user.click(screen.getByRole('button', { name: 'More' }));
      await user.click(screen.getByRole('menuitem', { name: 'Archive' }));

      expect(onArchive).not.toHaveBeenCalled();
      // A disabled item does not activate, so the menu stays open.
      expect(screen.getByRole('menu')).toBeInTheDocument();
    });

    it('lets arrow navigation traverse a disabled item without activating it', async () => {
      const user = userEvent.setup();
      const { items, onArchive } = makeItems({ archive: { disabled: true } });
      render(<MoreMenu items={items} />);

      const trigger = screen.getByRole('button', { name: 'More' });
      trigger.focus();
      await user.keyboard('{Enter}');
      expect(screen.getByRole('menuitem', { name: 'Edit' })).toHaveFocus();

      await user.keyboard('{ArrowDown}');
      expect(screen.getByRole('menuitem', { name: 'Archive' })).toHaveFocus();

      await user.keyboard('{ArrowDown}');
      expect(screen.getByRole('menuitem', { name: 'Delete' })).toHaveFocus();
      expect(onArchive).not.toHaveBeenCalled();
    });

    it('still opens with focus on an item when the first item is disabled', async () => {
      const user = userEvent.setup();
      const { items } = makeItems({ edit: { disabled: true } });
      render(<MoreMenu items={items} />);

      const trigger = screen.getByRole('button', { name: 'More' });
      trigger.focus();
      await user.keyboard('{Enter}');

      expect(screen.getByRole('menuitem', { name: 'Edit' })).toHaveFocus();

      // The menu is not keyboard-dead: arrow keys still move focus onward.
      await user.keyboard('{ArrowDown}');
      expect(screen.getByRole('menuitem', { name: 'Archive' })).toHaveFocus();
    });
  });
});

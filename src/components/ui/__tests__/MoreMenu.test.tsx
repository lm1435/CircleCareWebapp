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

  // ── Clipping ancestors (the Members-page bug) ─────────────────────────────
  //
  // The panel renders INLINE (`absolute z-30`) inside the row, so ANY ancestor
  // with a non-visible `overflow` clips it — not just a Modal. Measured in
  // Chrome at 1280x720 on /circles/:id/members: the pending-invites
  // `<Sheet as="ul" className="overflow-hidden">` is one row (~75px) tall, the
  // panel flipped UP on viewport space alone, and 64% of it — including the
  // "Cancel invite" hit point — landed outside the UL's clip rect and was
  // never painted. Dead for a mouse.
  //
  // jsdom has no layout, so the geometry is driven entirely by mocked rects:
  // `getBoundingClientRect` per element and a fixed panel `offsetHeight`. The
  // assertion is the one that matters — resolve the box the component actually
  // asked for (direction class + any `max-height` it set) and require it to sit
  // INSIDE the clipping ancestor's rect.
  describe('clipping ancestors', () => {
    /** `mt-1` / `mb-1` — the gap the panel keeps from the trigger. */
    const GAP = 4;

    afterEach(() => {
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
    });

    /**
     * Mock rects for a trigger sitting inside a clipping box. Everything that
     * is not the box (trigger, wrapper, panel) reports the trigger's rect —
     * only the trigger's is read.
     */
    function clipLayout(opts: {
      clip: { top: number; bottom: number };
      trigger: { top: number; bottom: number };
      panelHeight: number;
      viewport: number;
    }): void {
      vi.stubGlobal('innerHeight', opts.viewport);
      vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
        this: HTMLElement
      ) {
        const box = this.dataset.clipbox === 'true' ? opts.clip : opts.trigger;
        return {
          top: box.top,
          bottom: box.bottom,
          height: box.bottom - box.top,
          left: 0,
          right: 44,
          width: 44,
          x: 0,
          y: box.top,
          toJSON: () => ({}),
        } as DOMRect;
      });
      Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
        configurable: true,
        get: () => opts.panelHeight,
      });
    }

    /** The box the panel will actually occupy, per the classes + max-height. */
    function resolvePanelBox(
      panel: HTMLElement,
      trigger: { top: number; bottom: number },
      naturalHeight: number
    ): { top: number; bottom: number; flippedUp: boolean } {
      const flippedUp = panel.className.includes('bottom-full');
      const cap = panel.style.maxHeight ? Number.parseFloat(panel.style.maxHeight) : Infinity;
      const height = Math.min(naturalHeight, cap);
      const top = flippedUp ? trigger.top - GAP - height : trigger.bottom + GAP;
      return { top, bottom: top + height, flippedUp };
    }

    it('keeps the panel inside a non-dialog clipping ancestor', async () => {
      const user = userEvent.setup();
      // A short `Sheet ... overflow-hidden` low in a 720px-tall window: there
      // is room ABOVE the trigger in the WINDOW (640px) but only 120px of it
      // inside the UL. Pre-fix this flipped up and hung 160px out.
      //
      // The box must be tall enough to host an OPERABLE panel for containment
      // to be the right answer at all: 108px of usable room here, comfortably
      // over `MIN_USABLE_PANEL` (54px — one 44px item plus the panel's own
      // chrome). Shorter boxes than that escalate to the viewport instead, and
      // the old 100px fixture is exercised there — see 'never applies a cap
      // that cannot scroll one whole 44px item into view' below.
      const clip = { top: 520, bottom: 700 };
      const trigger = { top: 640, bottom: 684 };
      const panelHeight = 200;
      clipLayout({ clip, trigger, panelHeight, viewport: 720 });

      const { items } = makeItems();
      render(
        <ul data-clipbox="true" style={{ overflowY: 'hidden', overflowX: 'hidden' }}>
          <li>
            <MoreMenu items={items} />
          </li>
        </ul>
      );

      await user.click(screen.getByRole('button', { name: 'More' }));
      const box = resolvePanelBox(screen.getByRole('menu'), trigger, panelHeight);

      expect(box.top).toBeGreaterThanOrEqual(clip.top);
      expect(box.bottom).toBeLessThanOrEqual(clip.bottom);
    });

    it('caps the panel height and lets it scroll when it fits in neither direction', async () => {
      const user = userEvent.setup();
      // 108px of usable room above the trigger inside the box — over the
      // `MIN_USABLE_PANEL` floor, so capping is the right answer here.
      clipLayout({
        clip: { top: 520, bottom: 700 },
        trigger: { top: 640, bottom: 684 },
        panelHeight: 200,
        viewport: 720,
      });

      const { items } = makeItems();
      render(
        <ul data-clipbox="true" style={{ overflowY: 'hidden', overflowX: 'hidden' }}>
          <li>
            <MoreMenu items={items} />
          </li>
        </ul>
      );

      await user.click(screen.getByRole('button', { name: 'More' }));
      const panel = screen.getByRole('menu');
      expect(panel.style.maxHeight).not.toBe('');
      expect(Number.parseFloat(panel.style.maxHeight)).toBeLessThan(200);
      expect(panel.className).toContain('overflow-y-auto');
    });

    it('flips up when the panel fits above INSIDE the clipping ancestor', async () => {
      const user = userEvent.setup();
      // A tall Sheet: only 4px below the trigger, but 428px above it — inside
      // the same box this time, so flipping up is the right answer.
      const clip = { top: 200, bottom: 700 };
      const trigger = { top: 640, bottom: 684 };
      const panelHeight = 200;
      clipLayout({ clip, trigger, panelHeight, viewport: 720 });

      const { items } = makeItems();
      render(
        <ul data-clipbox="true" style={{ overflowY: 'hidden', overflowX: 'hidden' }}>
          <li>
            <MoreMenu items={items} />
          </li>
        </ul>
      );

      await user.click(screen.getByRole('button', { name: 'More' }));
      const box = resolvePanelBox(screen.getByRole('menu'), trigger, panelHeight);

      expect(box.flippedUp).toBe(true);
      expect(box.top).toBeGreaterThanOrEqual(clip.top);
      expect(box.bottom).toBeLessThanOrEqual(clip.bottom);
      // It fits — nothing to cap.
      expect(screen.getByRole('menu').style.maxHeight).toBe('');
    });

    it('opens DOWN when the clip box leaves more room below, even though the viewport says flip up', async () => {
      const user = userEvent.setup();
      // 145px-tall Sheet near the bottom of a 720px window. By viewport space
      // alone there is 588px above the trigger and only 64px below, so the
      // pre-fix rule flipped up — outside the Sheet. Inside the Sheet the
      // panel fits NEITHER way, and below is the roomier of the two (59px,
      // clear of the `MIN_USABLE_PANEL` floor, so it caps there rather than
      // escalating).
      const clip = { top: 570, bottom: 715 };
      const trigger = { top: 600, bottom: 644 };
      const panelHeight = 200;
      clipLayout({ clip, trigger, panelHeight, viewport: 720 });

      const { items } = makeItems();
      render(
        <ul data-clipbox="true" style={{ overflowY: 'hidden', overflowX: 'hidden' }}>
          <li>
            <MoreMenu items={items} />
          </li>
        </ul>
      );

      await user.click(screen.getByRole('button', { name: 'More' }));
      const box = resolvePanelBox(screen.getByRole('menu'), trigger, panelHeight);

      expect(box.flippedUp).toBe(false);
      expect(box.top).toBeGreaterThanOrEqual(clip.top);
      expect(box.bottom).toBeLessThanOrEqual(clip.bottom);
    });

    it('clamps a clip box that runs past the fold to the viewport', async () => {
      const user = userEvent.setup();
      // A tall scroll container (bottom 1400) whose lower half is below the
      // 720px fold. "Inside the container" is not enough — 918px down the page
      // is still off-screen.
      const clip = { top: 200, bottom: 1400 };
      const trigger = { top: 600, bottom: 644 };
      const panelHeight = 200;
      clipLayout({ clip, trigger, panelHeight, viewport: 720 });

      const { items } = makeItems();
      render(
        <ul data-clipbox="true" style={{ overflowY: 'auto', overflowX: 'hidden' }}>
          <li>
            <MoreMenu items={items} />
          </li>
        </ul>
      );

      await user.click(screen.getByRole('button', { name: 'More' }));
      const box = resolvePanelBox(screen.getByRole('menu'), trigger, panelHeight);

      expect(box.top).toBeGreaterThanOrEqual(clip.top);
      expect(box.bottom).toBeLessThanOrEqual(720);
    });

    it('ignores an ancestor that does not clip and measures the viewport instead', async () => {
      const user = userEvent.setup();
      // Same geometry as the clipped case, but the ancestor scrolls nothing —
      // the panel is free to flip up out of it, into the window.
      const clip = { top: 600, bottom: 700 };
      const trigger = { top: 640, bottom: 684 };
      clipLayout({ clip, trigger, panelHeight: 200, viewport: 720 });

      const { items } = makeItems();
      render(
        <ul data-clipbox="true">
          <li>
            <MoreMenu items={items} />
          </li>
        </ul>
      );

      await user.click(screen.getByRole('button', { name: 'More' }));
      const panel = screen.getByRole('menu');
      expect(panel.className).toContain('bottom-full');
      expect(panel.style.maxHeight).toBe('');
    });

    // ── Short clipping boxes: the cap needs a FLOOR (the Vitals regression) ──
    //
    // Measured in Chrome at 1280x720 on /circles/:id/vitals with one manual
    // reading: the row's MoreMenu sits inside the `Accordion`'s `0fr→1fr`
    // collapse wrapper (`div.overflow-hidden.min-h-0`), and around a ONE-ROW
    // group that wrapper's rect is 414–496 — an 82px box around a 44px
    // trigger. 23px above it, 15px below it, and a 53px panel. Capping to
    // "whatever is left" produced an 11px scrollport: the "Delete" item laid
    // out at 487–530, entirely outside its own scrollport, and
    // `elementFromPoint` over it returned the SECTION rather than the item.
    // Present, and dead for a pointer (keyboard still reached it — the same
    // invisible-but-operable-by-keyboard shape as the original bug).
    //
    // Containment is not usability. The floor is the shortest scrollport that
    // can still scroll one whole item into view: the items are `min-h-[44px]`
    // and the panel adds `p-1` (4px top + bottom) and a 1px border, all of
    // which sit INSIDE `max-height` under `box-sizing: border-box` — 54px.
    // Below that the clip box is not a viable boundary at all and the panel
    // must fall back to the viewport instead of capping.
    //
    // jsdom has no layout, so "the item is reachable" cannot be asserted by
    // hit-testing. The two concrete things that broke are asserted instead:
    // no cap below the usable floor is ever applied, and the boundary
    // escalated — the panel takes the direction the VIEWPORT dictates, which
    // is the opposite of the one the 82px box dictates.
    describe('short clipping boxes', () => {
      /** 44px item + the panel's `p-1` + its 1px border, all inside max-height. */
      const MIN_USABLE_PANEL = 54;

      /** The panel's scrollport, or `Infinity` when it was left uncapped. */
      function panelCap(panel: HTMLElement): number {
        return panel.style.maxHeight ? Number.parseFloat(panel.style.maxHeight) : Infinity;
      }

      /** The real Vitals geometry: one reading, so a one-row group. */
      const VITALS = {
        clip: { top: 414, bottom: 496 },
        trigger: { top: 437, bottom: 481 },
        panelHeight: 53,
        viewport: 720,
      };

      function renderInClip(): void {
        const { items } = makeItems();
        render(
          <ul data-clipbox="true" style={{ overflowY: 'hidden', overflowX: 'hidden' }}>
            <li>
              <MoreMenu items={items} />
            </li>
          </ul>
        );
      }

      it('escalates to the viewport rather than capping to an unusable 11px scrollport', async () => {
        const user = userEvent.setup();
        clipLayout(VITALS);
        renderInClip();

        await user.click(screen.getByRole('button', { name: 'More' }));
        const panel = screen.getByRole('menu');

        // No cap at all: the 11px the box had left cannot present an item.
        expect(panel.style.maxHeight).toBe('');
        expect(panel.className).not.toContain('overflow-y-auto');
        // The boundary escalated. Inside the 82px box the roomier side is
        // ABOVE (23 vs 15) — `bottom-full`; against the viewport there are
        // 227px BELOW the trigger, so a viewport-measured panel opens down.
        expect(panel.className).toContain('top-full');
        expect(panel.className).not.toContain('bottom-full');
      });

      it('never applies a cap that cannot scroll one whole 44px item into view', async () => {
        const user = userEvent.setup();
        for (const clip of [
          { top: 414, bottom: 496 }, // Vitals: 82px box → 11px left
          { top: 600, bottom: 700 }, // 100px box → 28px left
          { top: 560, bottom: 700 }, // 140px box → 44px left
        ]) {
          clipLayout({ ...VITALS, clip, panelHeight: 200 });
          const { items } = makeItems();
          const { unmount } = render(
            <ul data-clipbox="true" style={{ overflowY: 'hidden', overflowX: 'hidden' }}>
              <li>
                <MoreMenu items={items} />
              </li>
            </ul>
          );

          await user.click(screen.getByRole('button', { name: 'More' }));
          const cap = panelCap(screen.getByRole('menu'));
          expect(cap === Infinity || cap >= MIN_USABLE_PANEL).toBe(true);
          unmount();
        }
      });

      // The floor is a threshold, so pin both sides of it one pixel apart.
      it('caps at exactly the floor, and escalates one pixel below it', async () => {
        const user = userEvent.setup();
        const trigger = { top: 600, bottom: 644 };
        const panelHeight = 200;

        // 54px of usable room above the trigger — exactly `MIN_USABLE_PANEL`.
        // Still a viable box: cap, scroll, stay inside it.
        const atFloor = { top: 534, bottom: 650 };
        clipLayout({ clip: atFloor, trigger, panelHeight, viewport: 720 });
        const first = makeItems();
        const { unmount } = render(
          <ul data-clipbox="true" style={{ overflowY: 'hidden', overflowX: 'hidden' }}>
            <li>
              <MoreMenu items={first.items} />
            </li>
          </ul>
        );
        await user.click(screen.getByRole('button', { name: 'More' }));
        const capped = screen.getByRole('menu');
        expect(panelCap(capped)).toBe(MIN_USABLE_PANEL);
        expect(capped.className).toContain('overflow-y-auto');
        const box = resolvePanelBox(capped, trigger, panelHeight);
        expect(box.top).toBeGreaterThanOrEqual(atFloor.top);
        expect(box.bottom).toBeLessThanOrEqual(atFloor.bottom);
        unmount();

        // One pixel shorter: 53px cannot present a whole item, so the box
        // stops being a boundary and the viewport takes over.
        clipLayout({ clip: { top: 535, bottom: 650 }, trigger, panelHeight, viewport: 720 });
        const second = makeItems();
        render(
          <ul data-clipbox="true" style={{ overflowY: 'hidden', overflowX: 'hidden' }}>
            <li>
              <MoreMenu items={second.items} />
            </li>
          </ul>
        );
        await user.click(screen.getByRole('button', { name: 'More' }));
        expect(panelCap(screen.getByRole('menu'))).toBe(Infinity);
      });

      // The OTHER accordion-clipped call site: `CardActions` on the Emergency
      // page. Same component, same clip, opposite outcome — there the
      // Accordion wraps a whole SECTION, so the box is 691–988px and the
      // 113px panel always fits. Measured in Chrome across all 8 menus
      // (doctors / contacts / insurance): no cap on any of them. The floor
      // must not start firing here.
      it('leaves a tall accordion box (Emergency CardActions) rendering identically', async () => {
        const user = userEvent.setup();
        // AARP Medicare Supplement, the tightest of the eight: 336px above
        // the trigger, 34px below it (the box runs past the fold, so the
        // viewport clamps the bottom), 113px panel.
        clipLayout({
          clip: { top: 306, bottom: 997 },
          trigger: { top: 642, bottom: 686 },
          panelHeight: 113,
          viewport: 720,
        });

        const { items } = makeItems();
        render(
          <ul data-clipbox="true" style={{ overflowY: 'hidden', overflowX: 'hidden' }}>
            <li>
              <MoreMenu items={items} />
            </li>
          </ul>
        );

        await user.click(screen.getByRole('button', { name: 'More' }));
        const panel = screen.getByRole('menu');
        expect(panel.className).toContain('bottom-full');
        expect(panel.style.maxHeight).toBe('');
        expect(panel.className).not.toContain('overflow-y-auto');
      });
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

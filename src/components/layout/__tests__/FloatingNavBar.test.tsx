import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import '@/i18n';
import { FloatingNavBar } from '@/components/layout/FloatingNavBar';

function renderNav(
  path: string,
  props: Partial<React.ComponentProps<typeof FloatingNavBar>> = {}
): ReturnType<typeof render> {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          path="/circles/:circleId/*"
          element={
            <FloatingNavBar
              circleId="c1"
              canCreate
              addOpen={false}
              onToggleAdd={vi.fn()}
              onOpenAssistant={vi.fn()}
              // The AI cell is GATED (src/lib/aiAccess.ts) and the prop fails
              // closed, so the shown-AI case — what most of these tests
              // describe — has to say so. Individual tests override it.
              canUseAssistant
              {...props}
            />
          }
        />
      </Routes>
    </MemoryRouter>
  );
}

function pill(): HTMLElement {
  return screen.getByTestId('floating-nav');
}

/** The 4×4 active dot is the only direct `aria-hidden` child of a cell. */
function hasActiveDot(cell: Element): boolean {
  return cell.querySelector(':scope > span[aria-hidden="true"]') !== null;
}

afterEach(() => {
  document.documentElement.style.removeProperty('--nav-h');
});

describe('FloatingNavBar', () => {
  it('renders five cells in mobile order: HOME · CARE · NEW · HEALTH · AI', () => {
    renderNav('/circles/c1');

    expect(Array.from(pill().children).map((c) => c.textContent)).toEqual([
      'Home',
      'Care',
      'New',
      'Health',
      'AI',
    ]);
  });

  it('is chrome for below 1024px only', () => {
    renderNav('/circles/c1');

    expect(pill()).toHaveClass('xl:hidden');
    expect(pill().tagName).toBe('NAV');
    expect(pill()).toHaveAccessibleName('Main navigation');
  });

  it('points the three tab cells at their mobile targets', () => {
    renderNav('/circles/c1');

    const nav = pill();
    expect(within(nav).getByRole('link', { name: 'Home' })).toHaveAttribute(
      'href',
      '/circles/c1'
    );
    expect(within(nav).getByRole('link', { name: 'Care' })).toHaveAttribute(
      'href',
      '/circles/c1/calendar'
    );
    expect(within(nav).getByRole('link', { name: 'Health' })).toHaveAttribute(
      'href',
      '/circles/c1/emergency'
    );
  });

  it.each([
    ['/circles/c1', 'Home'],
    ['/circles/c1/calendar', 'Care'],
    ['/circles/c1/meds', 'Care'],
    ['/circles/c1/tasks', 'Care'],
    ['/circles/c1/notes', 'Care'],
    ['/circles/c1/emergency', 'Health'],
    ['/circles/c1/documents', 'Health'],
  ])('marks the right cell active on %s', (path, active) => {
    renderNav(path);

    for (const name of ['Home', 'Care', 'Health']) {
      const link = within(pill()).getByRole('link', { name });
      if (name === active) {
        expect(link).toHaveAttribute('aria-current', 'page');
        expect(hasActiveDot(link)).toBe(true);
      } else {
        expect(link).not.toHaveAttribute('aria-current');
        expect(hasActiveDot(link)).toBe(false);
      }
    }
  });

  it('lights no tab on a section that belongs to neither group', () => {
    renderNav('/circles/c1/settings');

    for (const name of ['Home', 'Care', 'Health']) {
      expect(within(pill()).getByRole('link', { name })).not.toHaveAttribute('aria-current');
    }
  });

  it('NEW reports the add-menu state and calls the toggle', async () => {
    const onToggleAdd = vi.fn();
    const user = userEvent.setup();
    const { rerender } = renderNav('/circles/c1', { onToggleAdd });

    const button = within(pill()).getByRole('button', { name: 'New' });
    expect(button).toHaveAttribute('aria-haspopup', 'menu');
    expect(button).toHaveAttribute('aria-expanded', 'false');

    await user.click(button);
    expect(onToggleAdd).toHaveBeenCalledTimes(1);

    rerender(
      <MemoryRouter initialEntries={['/circles/c1']}>
        <FloatingNavBar
          circleId="c1"
          canCreate
          addOpen
          onToggleAdd={onToggleAdd}
          onOpenAssistant={vi.fn()}
        />
      </MemoryRouter>
    );

    const open = within(pill()).getByRole('button', { name: 'New' });
    expect(open).toHaveAttribute('aria-expanded', 'true');
    // The "+" turns into an "×" while the menu is up (mobile's 45° rotation).
    expect(open.querySelector('.rotate-45')).not.toBeNull();
  });

  it('keeps NEW visible but inert when the viewer cannot create', async () => {
    const onToggleAdd = vi.fn();
    const user = userEvent.setup();
    renderNav('/circles/c1', { canCreate: false, onToggleAdd });

    const button = within(pill()).getByRole('button', { name: 'New' });
    expect(button).toBeInTheDocument();
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(button).toHaveClass('opacity-50');

    await user.click(button);
    expect(onToggleAdd).not.toHaveBeenCalled();
  });

  it('AI opens the assistant and reads as active while it is up', async () => {
    const onOpenAssistant = vi.fn();
    const user = userEvent.setup();
    const { rerender } = renderNav('/circles/c1', { onOpenAssistant });

    const ai = within(pill()).getByRole('button', { name: 'AI' });
    expect(ai).toHaveAttribute('aria-expanded', 'false');
    expect(hasActiveDot(ai)).toBe(false);

    await user.click(ai);
    expect(onOpenAssistant).toHaveBeenCalledTimes(1);

    // The pill does not own `assistantOpen` — AppLayout flips it once the modal
    // is up. Hand it back the way the layout does: the SAME cell must now read
    // as active, to assistive tech and to the eye.
    rerender(
      <MemoryRouter initialEntries={['/circles/c1']}>
        <Routes>
          <Route
            path="/circles/:circleId/*"
            element={
              <FloatingNavBar
                circleId="c1"
                canCreate
                addOpen={false}
                onToggleAdd={vi.fn()}
                onOpenAssistant={onOpenAssistant}
                canUseAssistant
                assistantOpen
              />
            }
          />
        </Routes>
      </MemoryRouter>
    );

    const open = within(pill()).getByRole('button', { name: 'AI' });
    expect(open).toHaveAttribute('aria-expanded', 'true');
    expect(hasActiveDot(open)).toBe(true);
  });

  it('AI shows the filled glyph and the dot while the modal is open', () => {
    renderNav('/circles/c1', { assistantOpen: true });

    const ai = within(pill()).getByRole('button', { name: 'AI' });
    expect(ai).toHaveAttribute('aria-expanded', 'true');
    expect(hasActiveDot(ai)).toBe(true);
  });

  // VIEW-ONLY GATING. A view-only member cannot change their own role, so the
  // AI cell is absent rather than disabled — unlike NEW above, a dimmed cell
  // would only advertise a door that is not theirs to open.
  it('drops the AI cell entirely when the viewer has no assistant access', () => {
    renderNav('/circles/c1', { canUseAssistant: false });

    expect(within(pill()).queryByRole('button', { name: 'AI' })).not.toBeInTheDocument();
    expect(Array.from(pill().children).map((c) => c.textContent)).toEqual([
      'Home',
      'Care',
      'New',
      'Health',
    ]);
  });

  it('fails closed: no AI cell when the flag is not supplied at all', () => {
    render(
      <MemoryRouter initialEntries={['/circles/c1']}>
        <FloatingNavBar
          circleId="c1"
          addOpen={false}
          onToggleAdd={vi.fn()}
          onOpenAssistant={vi.fn()}
        />
      </MemoryRouter>
    );

    expect(within(pill()).queryByRole('button', { name: 'AI' })).not.toBeInTheDocument();
  });

  it('publishes --nav-h while mounted and removes it on unmount', () => {
    const { unmount } = renderNav('/circles/c1');

    // jsdom ships no matchMedia, so the phone height is what resolves here.
    expect(document.documentElement.style.getPropertyValue('--nav-h')).toBe('64px');

    unmount();

    expect(document.documentElement.style.getPropertyValue('--nav-h')).toBe('');
  });

  it('re-measures --nav-h at the 600px tablet boundary on resize', () => {
    let tablet = false;
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: tablet, media: query }));
    try {
      renderNav('/circles/c1');
      expect(document.documentElement.style.getPropertyValue('--nav-h')).toBe('64px');

      tablet = true;
      window.dispatchEvent(new Event('resize'));

      expect(document.documentElement.style.getPropertyValue('--nav-h')).toBe('72px');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import '@/i18n';
import { Sidebar, type SidebarProps } from '@/components/layout/Sidebar';
import { ICON_FILES, type IconName } from '@/components/ui';

/** See AddMenu.test.tsx — the inlined glyph carries no name, its path data does. */
function firstPathData(name: IconName): string {
  const d = /\sd="([^"]+)"/.exec(ICON_FILES[name]);
  if (!d) throw new Error(`No path data in ${name}`);
  return d[1];
}

function renderSidebar(initialPath = '/circles/c1/calendar', props: SidebarProps = {}): void {
  render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path="/circles/:circleId" element={<Sidebar {...props} />} />
        <Route path="/circles/:circleId/:section" element={<Sidebar {...props} />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('Sidebar', () => {
  it('renders every nav link scoped to the current circle', () => {
    renderSidebar();

    const hrefs: Array<[string, string]> = [
      ['Home', '/circles/c1'],
      ['Calendar', '/circles/c1/calendar'],
      ['Medications', '/circles/c1/meds'],
      ['Tasks', '/circles/c1/tasks'],
      ['Notes', '/circles/c1/notes'],
      ['Emergency Info', '/circles/c1/emergency'],
      ['Documents', '/circles/c1/documents'],
      ['Activity', '/circles/c1/activity'],
      ['Vitals', '/circles/c1/vitals'],
      ['Members', '/circles/c1/members'],
      ['Circle Settings', '/circles/c1/settings'],
    ];
    for (const [name, href] of hrefs) {
      expect(screen.getByRole('link', { name })).toHaveAttribute('href', href);
    }
  });

  it('groups the links as mobile does: Home, Care, Health, unlabelled, AI', () => {
    renderSidebar('/circles/c1/calendar', { onOpenAssistant: vi.fn() });

    expect(screen.getByRole('list', { name: 'Care' })).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Health' })).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'AI' })).toBeInTheDocument();

    const care = screen.getByRole('list', { name: 'Care' });
    expect(within(care).getAllByRole('link').map((el) => el.textContent)).toEqual([
      'Calendar',
      'Medications',
      'Tasks',
      'Notes',
    ]);

    const health = screen.getByRole('list', { name: 'Health' });
    expect(within(health).getAllByRole('link').map((el) => el.textContent)).toEqual([
      'Emergency Info',
      'Documents',
    ]);

    // Activity / Vitals / Members / Settings are the one unlabelled group.
    const unlabelled = screen.getAllByRole('list').filter((ul) => !ul.hasAttribute('aria-label'));
    expect(unlabelled).toHaveLength(1);
    expect(within(unlabelled[0]).getAllByRole('link').map((el) => el.textContent)).toEqual([
      'Activity',
      'Vitals',
      'Members',
      'Circle Settings',
    ]);

    // Home is its own group, above Care.
    expect(within(screen.getByRole('list', { name: 'Home' })).getAllByRole('link')).toHaveLength(1);
  });

  it.each([
    ['/circles/c1/calendar', 'Calendar', 'bg-dusk-soft text-dusk-deep'],
    ['/circles/c1/activity', 'Activity', 'bg-dusk-soft text-dusk-deep'],
    ['/circles/c1/notes', 'Notes', 'bg-dusk-soft text-dusk-deep'],
    ['/circles/c1/tasks', 'Tasks', 'bg-moss-soft text-moss-deep'],
    ['/circles/c1/meds', 'Medications', 'bg-clay-soft text-clay-deep'],
    ['/circles/c1/emergency', 'Emergency Info', 'bg-terracotta-soft text-terracotta-deep'],
    ['/circles/c1/documents', 'Documents', 'bg-terracotta-soft text-terracotta-deep'],
    ['/circles/c1', 'Home', 'bg-bg-2 text-ink'],
    ['/circles/c1/vitals', 'Vitals', 'bg-bg-2 text-ink'],
    ['/circles/c1/members', 'Members', 'bg-bg-2 text-ink'],
    ['/circles/c1/settings', 'Circle Settings', 'bg-bg-2 text-ink'],
  ])('%s paints %s with its section colour', (path, name, activeClass) => {
    renderSidebar(path);

    const link = screen.getByRole('link', { name });
    expect(link).toHaveAttribute('aria-current', 'page');
    expect(link.className).toContain(activeClass);
    // Every other link keeps the inactive treatment.
    expect(screen.getByRole('link', { name: 'Vitals' }).className).toContain(
      name === 'Vitals' ? activeClass : 'text-ink-2'
    );
  });

  it('Home is only active on the index route, not on a section', () => {
    renderSidebar('/circles/c1/calendar');
    expect(screen.getByRole('link', { name: 'Home' })).not.toHaveAttribute('aria-current');
  });

  it.each([
    ['/circles/c1', 'Home', 'home'],
    ['/circles/c1/calendar', 'Calendar', 'calendar'],
    ['/circles/c1/tasks', 'Tasks', 'checkbox'],
    ['/circles/c1/emergency', 'Emergency Info', 'medical'],
  ])('%s swaps %s to the filled glyph', (path, name, filled) => {
    renderSidebar(path);

    const svg = screen.getByRole('link', { name }).querySelector('svg');
    expect(svg?.outerHTML).toContain(firstPathData(filled as IconName));
  });

  it('an inactive link keeps its outline glyph', () => {
    renderSidebar('/circles/c1/documents');

    const home = screen.getByRole('link', { name: 'Home' }).querySelector('svg');
    expect(home?.outerHTML).toContain(firstPathData('home-outline'));
    expect(home?.outerHTML).not.toContain(firstPathData('home'));
  });

  it('hides the New control when no create handler is supplied', () => {
    renderSidebar();
    expect(screen.queryByRole('button', { name: 'New' })).not.toBeInTheDocument();
  });

  it('the New button toggles the AddMenu and tracks aria-expanded', () => {
    const onCreate = vi.fn();
    renderSidebar('/circles/c1/calendar', { onCreate, canCreate: true });

    const button = screen.getByRole('button', { name: 'New' });
    expect(button).toHaveAttribute('aria-haspopup', 'menu');
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();

    fireEvent.click(button);

    expect(button).toHaveAttribute('aria-expanded', 'true');
    const menu = screen.getByRole('menu', { name: 'New' });
    // Anchored to the sidebar trigger (portalled + fixed off its rect), not
    // the viewport bottom.
    expect(menu.className).toContain('fixed');
    expect(menu.className).not.toContain('left-1/2');
    expect(menu.closest('[role="region"]')?.parentElement).toBe(document.body);
    expect(screen.getAllByRole('menuitem')).toHaveLength(4);

    fireEvent.click(screen.getByRole('menuitem', { name: 'Note' }));

    expect(onCreate).toHaveBeenCalledWith('note');
    expect(button).toHaveAttribute('aria-expanded', 'false');
  });

  it('a read-only member gets the New button but no menu', () => {
    renderSidebar('/circles/c1/calendar', { onCreate: vi.fn(), canCreate: false });

    fireEvent.click(screen.getByRole('button', { name: 'New' }));

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  // L4: the button used to stay enabled and toggle `aria-expanded` for a
  // read-only member even though AddMenu renders nothing for them — a control
  // that visibly responds to activation but produces no menu at all.
  it('disables the New button for a read-only member (canCreate=false)', () => {
    renderSidebar('/circles/c1/calendar', { onCreate: vi.fn(), canCreate: false });

    const button = screen.getByRole('button', { name: 'New' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-disabled', 'true');
  });

  it('leaves the New button enabled for an editable circle (canCreate=true), matching FloatingNavBar', () => {
    renderSidebar('/circles/c1/calendar', { onCreate: vi.fn(), canCreate: true });

    const button = screen.getByRole('button', { name: 'New' });
    expect(button).not.toBeDisabled();
    expect(button).toHaveAttribute('aria-disabled', 'false');
  });

  it('the Assistant entry calls onOpenAssistant (and closes the drawer)', () => {
    const onOpenAssistant = vi.fn();
    const onNavigate = vi.fn();
    renderSidebar('/circles/c1/calendar', { onOpenAssistant, onNavigate });

    fireEvent.click(screen.getByRole('button', { name: 'Assistant' }));

    expect(onOpenAssistant).toHaveBeenCalledTimes(1);
    expect(onNavigate).toHaveBeenCalledTimes(1);
  });

  it('omits the Assistant entry when no handler is supplied', () => {
    renderSidebar();
    expect(screen.queryByRole('button', { name: 'Assistant' })).not.toBeInTheDocument();
  });

  it('renders the download card with both store links', () => {
    renderSidebar();

    const title = screen.getByText('Get the full experience.');
    // Deliberately a <p>: an <h*> in the aside would precede main's h1 and trip
    // WCAG 1.3.1 heading order.
    expect(title.tagName).toBe('P');
    expect(screen.getByText('Download CircleCare for iOS or Android.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Download on the App Store' })).toHaveAttribute(
      'href',
      'https://apps.apple.com/app/id6757629684'
    );
    expect(screen.getByRole('link', { name: 'Get it on Google Play' })).toHaveAttribute(
      'href',
      'https://play.google.com/store/apps/details?id=com.circlecare.circlecare'
    );
  });

  it('is 272 wide and hidden below xl on desktop (the only layout AppLayout renders)', () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/circles/c1']}>
        <Routes>
          <Route path="/circles/:circleId" element={<Sidebar variant="desktop" />} />
        </Routes>
      </MemoryRouter>
    );
    const desktop = container.querySelector('aside');
    expect(desktop?.className).toContain('hidden xl:flex');
    expect(desktop?.className).toContain('w-[272px]');
  });

  it('draws no hand-rolled svg — every glyph comes from Icon, only the store badges keep brand art', () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/circles/c1']}>
        <Routes>
          <Route
            path="/circles/:circleId"
            element={<Sidebar onOpenAssistant={vi.fn()} onCreate={vi.fn()} canCreate />}
          />
        </Routes>
      </MemoryRouter>
    );

    // Icon renders its svg inside a span carrying an inline width/height; the
    // two brand glyphs sit directly inside the store-badge anchors.
    const strays = Array.from(container.querySelectorAll('svg')).filter((svg) => {
      const parent = svg.parentElement;
      const fromIcon = parent?.tagName === 'SPAN' && parent.style.width !== '';
      const fromBadge = parent?.tagName === 'A';
      return !fromIcon && !fromBadge;
    });
    expect(strays.map((s) => s.outerHTML)).toEqual([]);
  });
});

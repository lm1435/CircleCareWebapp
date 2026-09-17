import type { ReactElement } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import '@/i18n';
import { CareTabs } from '@/components/layout/CareTabs';
import { HealthTabs } from '@/components/layout/HealthTabs';

/** Echoes the current path so a tab change can be asserted as navigation. */
function PathProbe(): React.ReactElement {
  const { pathname } = useLocation();
  return <div data-testid="path">{pathname}</div>;
}

function renderTabs(which: 'care' | 'health', path: string): void {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          path="/circles/:circleId/*"
          element={
            <>
              {which === 'care' ? <CareTabs /> : <HealthTabs />}
              <PathProbe />
            </>
          }
        />
      </Routes>
    </MemoryRouter>
  );
}

/**
 * Mirrors `AppLayout`'s `<div key={location.pathname}>…</div>` around the
 * routed page content — the thing that remounts `CareTabs`/`HealthTabs` (and
 * everything else on the page) on every navigation, which is what L2's focus
 * loss depends on reproducing.
 */
function KeyedByPathHarness(): ReactElement {
  const { pathname } = useLocation();
  return (
    <div key={pathname}>
      <CareTabs />
    </div>
  );
}

describe('CareTabs', () => {
  it('offers mobile’s four Care sections in order', () => {
    renderTabs('care', '/circles/c1/calendar');

    // The SHORT label set (`nav.*Short`), not the sidebar's `nav.*`: four
    // segments don't fit "Medications" on a phone. See CareTabs.tsx.
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      'Calendar',
      'Meds',
      'Tasks',
      'Notes',
    ]);
  });

  it('takes its selected value from the path', () => {
    renderTabs('care', '/circles/c1/tasks');

    expect(screen.getByRole('tab', { selected: true })).toHaveTextContent('Tasks');
  });

  it('navigates to the picked section', async () => {
    const user = userEvent.setup();
    renderTabs('care', '/circles/c1/calendar');

    await user.click(screen.getByRole('tab', { name: 'Notes' }));

    expect(screen.getByTestId('path')).toHaveTextContent('/circles/c1/notes');
  });

  it('is hidden from xl up, where the sidebar lists all four', () => {
    renderTabs('care', '/circles/c1/calendar');

    const tablist = screen.getByRole('tablist', { name: 'Care' });
    expect(tablist.parentElement?.parentElement).toHaveClass('xl:hidden');
  });

  // L2 (live-repro'd): AppLayout keys the routed subtree by pathname, so a
  // SegmentedControl-driven navigation remounts CareTabs. A click-driven
  // switch loses nothing, but an arrow-key switch used to strand focus on
  // <body> the instant the pre-navigation instance unmounted.
  it('keeps focus on the selected tab after an arrow-key switch remounts the subtree', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/circles/c1/calendar']}>
        <Routes>
          <Route path="/circles/:circleId/*" element={<KeyedByPathHarness />} />
        </Routes>
      </MemoryRouter>
    );

    screen.getByRole('tab', { name: 'Calendar' }).focus();
    await user.keyboard('{ArrowRight}');

    const medsTab = await screen.findByRole('tab', { name: 'Meds' });
    expect(medsTab).toHaveFocus();
  });

  // A click-driven switch is not a keyboard event, so the remounted instance
  // must NOT also grab focus — that would yank focus from wherever the mouse
  // user's attention actually is (e.g. a page heading read by a screen reader).
  it('does NOT re-focus the tab after a click-driven switch remounts the subtree', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/circles/c1/calendar']}>
        <Routes>
          <Route path="/circles/:circleId/*" element={<KeyedByPathHarness />} />
        </Routes>
      </MemoryRouter>
    );

    await user.click(screen.getByRole('tab', { name: 'Notes' }));

    const notesTab = await screen.findByRole('tab', { name: 'Notes' });
    expect(notesTab).not.toHaveFocus();
  });
});

describe('HealthTabs', () => {
  it('offers Emergency and Documents', () => {
    renderTabs('health', '/circles/c1/emergency');

    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      'Emergency',
      'Documents',
    ]);
    expect(screen.getByRole('tablist', { name: 'Health' })).toBeInTheDocument();
  });

  it('takes its selected value from the path', () => {
    renderTabs('health', '/circles/c1/documents');

    expect(screen.getByRole('tab', { selected: true })).toHaveTextContent('Documents');
  });

  it('navigates to the picked section', async () => {
    const user = userEvent.setup();
    renderTabs('health', '/circles/c1/documents');

    await user.click(screen.getByRole('tab', { name: 'Emergency' }));

    expect(screen.getByTestId('path')).toHaveTextContent('/circles/c1/emergency');
  });
});

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Link, Route, Routes, useNavigate, useSearchParams } from 'react-router-dom';
import { ScrollReset } from '@/components/ScrollReset';

/**
 * ScrollReset lives in the router's ROOT layout so that routes outside
 * AppLayout reset too. The regression this guards: the contextual
 * "How does this work?" link (HowDoesThisWork.tsx) pushes /help/:slug, which
 * renders under HelpRouteLayout — when the reset lived in AppLayout, the help
 * article opened at the previous page's scroll offset.
 */

function SearchParamsReplacer(): React.ReactElement {
  const [, setSearchParams] = useSearchParams();
  return (
    <button type="button" onClick={() => setSearchParams({ date: '2026-11-04' }, { replace: true })}>
      Set date param
    </button>
  );
}

function BackButton(): React.ReactElement {
  const navigate = useNavigate();
  return (
    <button type="button" onClick={() => navigate(-1)}>
      Go back
    </button>
  );
}

function renderApp(initialPath = '/circles/c1'): ReturnType<typeof render> {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <ScrollReset />
      <Routes>
        <Route
          path="/circles/:circleId"
          element={
            <div>
              Circle page
              <Link to="/help/med-reminders">How does this work?</Link>
              <Link to="/help/med-reminders#section">Jump to section</Link>
              <SearchParamsReplacer />
            </div>
          }
        />
        <Route
          path="/help/:slug"
          element={
            <div>
              Help article
              <BackButton />
              <SearchParamsReplacer />
            </div>
          }
        />
      </Routes>
    </MemoryRouter>
  );
}

describe('ScrollReset', () => {
  let scrollTo: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    scrollTo = vi.fn();
    Object.defineProperty(window, 'scrollTo', { configurable: true, writable: true, value: scrollTo });
  });

  it('resets the window on a PUSH to a route outside AppLayout (the help regression)', async () => {
    const user = userEvent.setup();
    renderApp();
    // The initial entry is a POP: the browser owns that scroll position.
    expect(scrollTo).not.toHaveBeenCalled();

    await user.click(screen.getByRole('link', { name: 'How does this work?' }));
    expect(await screen.findByText('Help article')).toBeInTheDocument();
    expect(scrollTo).toHaveBeenLastCalledWith(expect.objectContaining({ top: 0, left: 0 }));
  });

  it('does not reset on POP (Back keeps the browser restoration)', async () => {
    const user = userEvent.setup();
    renderApp();
    await user.click(screen.getByRole('link', { name: 'How does this work?' }));
    scrollTo.mockClear();

    await user.click(screen.getByRole('button', { name: 'Go back' }));
    expect(await screen.findByText('Circle page')).toBeInTheDocument();
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('does not reset on a hash navigation (the page owns section jumps)', async () => {
    const user = userEvent.setup();
    renderApp();
    await user.click(screen.getByRole('link', { name: 'Jump to section' }));
    expect(await screen.findByText('Help article')).toBeInTheDocument();
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('does not reset on a search-only REPLACE on the same pathname (NotesPage ?date= deep link)', async () => {
    const user = userEvent.setup();
    renderApp();
    await user.click(screen.getByRole('button', { name: 'Set date param' }));
    expect(scrollTo).not.toHaveBeenCalled();
  });
});

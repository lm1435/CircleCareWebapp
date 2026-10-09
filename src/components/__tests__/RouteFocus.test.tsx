import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect, useRef, useState, type ReactElement } from 'react';
import { createMemoryRouter, Link, Outlet, RouterProvider, useNavigate } from 'react-router-dom';
import { RouteFocus } from '../RouteFocus';

// WCAG 2.4.3: after an in-app page change, focus lands on the new page's <h1>
// (or <main>), not on <body>. See RouteFocus.tsx for the rules under test.

function Layout(): ReactElement {
  return (
    <>
      <RouteFocus />
      <nav>
        <Link to="/b">Nav to B</Link>
      </nav>
      <main id="main" tabIndex={-1}>
        <Outlet />
      </main>
    </>
  );
}

function PageA(): ReactElement {
  const navigate = useNavigate();
  return (
    <>
      <h1>Page A</h1>
      <Link to="/b">Go to B</Link>
      <Link to="/b#tasks">B tasks</Link>
      <Link to="/a?view=week">Week view</Link>
      <Link to="/c">Go to C</Link>
      <Link to="/d" state={{ focusManaged: true }}>
        Go to D
      </Link>
      <Link to="/b" state={{ dailyUpdateArrow: 'next' }}>
        Next day
      </Link>
      <button type="button" onClick={() => navigate('/e')}>
        Go to E
      </button>
      <button type="button" onClick={() => navigate('/f')}>
        Go to F
      </button>
      <button type="button" onClick={() => navigate('/g')}>
        Go to G
      </button>
    </>
  );
}

function PageB(): ReactElement {
  return (
    <>
      <h1>Page B</h1>
      <section id="tasks" tabIndex={-1}>
        Tasks
      </section>
    </>
  );
}

/** No heading at all: falls back to <main>. */
function PageC(): ReactElement {
  return <p>No heading here</p>;
}

/** Manages its own focus (and says so in router state). */
function PageD(): ReactElement {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => ref.current?.focus(), []);
  return (
    <>
      <h1>Page D</h1>
      <button ref={ref} type="button">
        Own focus
      </button>
    </>
  );
}

/** Heading arrives after the data loads. */
function PageE(): ReactElement {
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setLoaded(true), 50);
    return () => window.clearTimeout(t);
  }, []);
  return loaded ? <h1>Page E</h1> : <p>Loading</p>;
}

/** Opens a dialog on arrival: focus belongs to the dialog. */
function PageF(): ReactElement {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => ref.current?.focus(), []);
  return (
    <>
      <h1>Page F</h1>
      <div role="dialog" aria-modal="true" aria-label="Welcome">
        <button ref={ref} type="button">
          Dialog button
        </button>
      </div>
    </>
  );
}

/** A dialog is already open on arrival (nothing focused it): leave focus alone. */
function PageG(): ReactElement {
  return (
    <>
      <h1>Page G</h1>
      <div role="dialog" aria-modal="true" aria-label="Notice">
        <button type="button">Notice button</button>
      </div>
    </>
  );
}

function setup(initial = '/a') {
  const router = createMemoryRouter(
    [
      {
        element: <Layout />,
        children: [
          { path: '/a', element: <PageA /> },
          { path: '/b', element: <PageB /> },
          { path: '/c', element: <PageC /> },
          { path: '/d', element: <PageD /> },
          { path: '/e', element: <PageE /> },
          { path: '/f', element: <PageF /> },
          { path: '/g', element: <PageG /> },
        ],
      },
    ],
    { initialEntries: [initial] }
  );
  render(<RouterProvider router={router} />);
  return { router, user: userEvent.setup() };
}

describe('RouteFocus', () => {
  it('does nothing on the first load', async () => {
    setup();
    await new Promise((r) => setTimeout(r, 50));
    expect(document.body).toHaveFocus();
    expect(screen.getByRole('heading', { name: 'Page A' })).not.toHaveAttribute('tabindex');
  });

  it('an in-content link lands focus on the new page h1, kept out of the Tab order', async () => {
    const { user } = setup();
    await user.click(screen.getByRole('link', { name: 'Go to B' }));
    const h1 = await screen.findByRole('heading', { name: 'Page B' });
    await waitFor(() => expect(h1).toHaveFocus());
    expect(h1).toHaveAttribute('tabindex', '-1');
  });

  it('works from the keyboard and from a link that stays on screen (nav)', async () => {
    const { user } = setup();
    screen.getByRole('link', { name: 'Nav to B' }).focus();
    await user.keyboard('{Enter}');
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Page B' })).toHaveFocus());
  });

  it('does not scroll to the heading (the layout owns scrolling)', async () => {
    const { user } = setup();
    const spy = vi.spyOn(HTMLElement.prototype, 'focus');
    await user.click(screen.getByRole('link', { name: 'Go to B' }));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Page B' })).toHaveFocus());
    expect(spy).toHaveBeenLastCalledWith({ preventScroll: true });
    spy.mockRestore();
  });

  it('falls back to <main> when the page has no h1', async () => {
    const { user } = setup();
    await user.click(screen.getByRole('link', { name: 'Go to C' }));
    await screen.findByText('No heading here');
    await waitFor(() => expect(screen.getByRole('main')).toHaveFocus(), { timeout: 3000 });
  });

  it('waits for a heading that appears after the page loads', async () => {
    const { user } = setup();
    await user.click(screen.getByRole('button', { name: 'Go to E' }));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Page E' })).toHaveFocus());
  });

  it('leaves a hash navigation to the page', async () => {
    const { user } = setup();
    await user.click(screen.getByRole('link', { name: 'B tasks' }));
    await screen.findByRole('heading', { name: 'Page B' });
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.getByRole('heading', { name: 'Page B' })).not.toHaveFocus();
  });

  it('ignores a search-only change on the same page', async () => {
    const { user } = setup();
    const link = screen.getByRole('link', { name: 'Week view' });
    await user.click(link);
    await new Promise((r) => setTimeout(r, 50));
    expect(link).toHaveFocus();
  });

  it('respects a page that manages its own focus (focusManaged state)', async () => {
    const { user } = setup();
    await user.click(screen.getByRole('link', { name: 'Go to D' }));
    const own = await screen.findByRole('button', { name: 'Own focus' });
    await new Promise((r) => setTimeout(r, 50));
    expect(own).toHaveFocus();
  });

  it('respects the daily update day arrows (dailyUpdateArrow state)', async () => {
    const { user } = setup();
    await user.click(screen.getByRole('link', { name: 'Next day' }));
    await screen.findByRole('heading', { name: 'Page B' });
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.getByRole('heading', { name: 'Page B' })).not.toHaveFocus();
  });

  it('never steals focus from an open dialog', async () => {
    const { user } = setup();
    await user.click(screen.getByRole('button', { name: 'Go to F' }));
    const inDialog = await screen.findByRole('button', { name: 'Dialog button' });
    await new Promise((r) => setTimeout(r, 50));
    expect(inDialog).toHaveFocus();
  });

  it('never moves focus behind a dialog that is open on arrival', async () => {
    const { user } = setup();
    await user.click(screen.getByRole('button', { name: 'Go to G' }));
    const h1 = await screen.findByRole('heading', { name: 'Page G' });
    await new Promise((r) => setTimeout(r, 50));
    expect(h1).not.toHaveFocus();
  });

  it('does not move focus for a programmatic redirect before any interaction', async () => {
    const { router } = setup();
    await act(async () => {
      await router.navigate('/b', { replace: true });
    });
    await screen.findByRole('heading', { name: 'Page B' });
    await new Promise((r) => setTimeout(r, 50));
    expect(document.body).toHaveFocus();
  });
});

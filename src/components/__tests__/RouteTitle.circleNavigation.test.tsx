import { lazy, Suspense, type ReactElement } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, Link, MemoryRouter, Outlet, RouterProvider } from 'react-router-dom';
import { HelmetProvider } from 'react-helmet-async';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import i18n from '@/i18n';
import { AuthGuard } from '@/components/AuthGuard';
import { useAuthStore } from '@/store/authStore';
import { RouteTitle, routeTitleFor } from '../RouteTitle';

/**
 * Prod bug (owner, web): after choosing a circle the tab still read
 * "Choose a circle · CircleCare" although the URL was /circles/<id>.
 *
 * The tree mirrors App.tsx + router.tsx: HelmetProvider > ONE <Suspense> >
 * RouterProvider (v7_startTransition), RouteTitle in the root layout, AuthGuard
 * around lazy authenticated pages. A signed-in visit renders RouteTitle while
 * AuthGuard is still bootstrapping; bootstrap then resolves through the zustand
 * store (a SYNC update, not a router transition), the lazy page suspends, and
 * React hides the already-visible tree behind the fallback. Hiding calls
 * componentWillUnmount on react-helmet-async's class Dispatcher, which drops it
 * from the instance list; on reveal it is never re-added (its `rendered` flag is
 * already true), so every later title change is computed without it and
 * document.title freezes on whatever it last was.
 */

let resolveChunk: () => void = () => {};
function lazyPage(render: () => ReactElement) {
  return lazy(
    () =>
      new Promise<{ default: () => ReactElement }>((resolve) => {
        resolveChunk = () => resolve({ default: render });
      })
  );
}

function CirclePage(): ReactElement {
  return (
    <nav>
      <Link to="/circles/c1/calendar">Calendar</Link>
      <Link to="/circles">All circles</Link>
    </nav>
  );
}

function renderApp(initialPath: string) {
  // A fresh lazy chunk per test (React.lazy caches a resolved module), so the
  // picker suspends on every boot. Choosing a circle is a <Link> (CircleCard).
  const PickerPage = lazyPage(() => <Link to="/circles/c1">Mom</Link>);
  const router = createMemoryRouter(
    [
      {
        element: (
          <>
            <RouteTitle />
            <Outlet />
          </>
        ),
        children: [
          {
            element: (
              <AuthGuard>
                <Outlet />
              </AuthGuard>
            ),
            children: [
              { path: '/circles', element: <PickerPage /> },
              {
                path: '/circles/:circleId',
                children: [
                  { index: true, element: <CirclePage /> },
                  { path: 'calendar', element: <CirclePage /> },
                ],
              },
            ],
          },
        ],
      },
    ],
    { initialEntries: [initialPath] }
  );
  render(
    <HelmetProvider>
      <Suspense fallback={<p>loading</p>}>
        <RouterProvider router={router} future={{ v7_startTransition: true }} />
      </Suspense>
    </HelmetProvider>
  );
  return router;
}

describe('RouteTitle: survives the signed-in boot (Suspense hide/reveal)', () => {
  beforeEach(() => {
    document.title = '';
    useAuthStore.setState({ isBootstrapping: true, isAuthenticated: false, user: null });
  });

  async function bootIntoPicker() {
    renderApp('/circles');
    await waitFor(() => expect(document.title).toBe('Choose a circle · CircleCare'));
    // Bootstrap resolves: a sync store update reveals the lazy picker, which suspends.
    act(() => {
      useAuthStore.setState({ isBootstrapping: false, isAuthenticated: true });
    });
    await act(async () => {
      resolveChunk();
    });
    await screen.findByRole('link', { name: 'Mom' });
  }

  it('positive: choosing a circle titles the tab with the overview title', async () => {
    await bootIntoPicker();
    fireEvent.click(screen.getByRole('link', { name: 'Mom' }));
    await screen.findByRole('link', { name: 'Calendar' });
    await waitFor(() => expect(document.title).toBe('Today · CircleCare'));
  });

  it('positive: a circle sub-page after that gets its own title', async () => {
    await bootIntoPicker();
    fireEvent.click(screen.getByRole('link', { name: 'Mom' }));
    fireEvent.click(await screen.findByRole('link', { name: 'Calendar' }));
    await waitFor(() => expect(document.title).toBe('Calendar · CircleCare'));
  });

  it('negative: back on /circles the tab says "Choose a circle" again', async () => {
    await bootIntoPicker();
    expect(document.title).toBe('Choose a circle · CircleCare');
    fireEvent.click(screen.getByRole('link', { name: 'Mom' }));
    fireEvent.click(await screen.findByRole('link', { name: 'All circles' }));
    await screen.findByRole('link', { name: 'Mom' });
    await waitFor(() => expect(document.title).toBe('Choose a circle · CircleCare'));
  });
});

// Every child of /circles/:circleId in router.tsx (plus the standalone welcome page)
// must map to its own title — read from the route table so a new route can't slip by.
describe('RouteTitle: every circle sub-route has a title', () => {
  const routerSource = readFileSync(resolve(__dirname, '../../router.tsx'), 'utf8');
  const circleBlock = routerSource.slice(
    routerSource.indexOf("path: '/circles/:circleId',"),
    routerSource.indexOf("{ path: '*'")
  );
  const subPaths = [...circleBlock.matchAll(/\{ path: '([^']+)', element:/g)].map((m) => m[1]);
  const t = (key: string) => i18n.t(key, { ns: 'common' });

  it('found the circle child routes', () => {
    expect(subPaths).toEqual(expect.arrayContaining(['calendar', 'providers/:providerId', 'notifications']));
  });

  it.each(subPaths)('/circles/c1/%s has a page title', (sub) => {
    const path = `/circles/c1/${sub.replace(':providerId', 'p1').replace(':date', '2026-10-08')}`;
    const title = routeTitleFor(path, t);
    expect(title).not.toBeNull();
    expect(title).not.toBe('Choose a circle · CircleCare');
    expect(title).toMatch(/^[^·]+ · CircleCare$/);
  });

  it('/circles/c1 is the overview and /circles/c1/welcome the welcome page', () => {
    expect(routeTitleFor('/circles/c1', t)).toBe('Today · CircleCare');
    expect(routeTitleFor('/circles/c1/welcome', t)).toBe(`${t('pageTitles.welcome')} · CircleCare`);
  });

  it('negative: /circles is the picker', () => {
    expect(routeTitleFor('/circles', t)).toBe('Choose a circle · CircleCare');
  });
});

describe('RouteTitle: pages that own their title are not overridden', () => {
  it.each(['/invite/abc123', '/help/add-a-medication', '/help/c/daily-care', '/no-such-page'])(
    'negative: leaves document.title alone on %s',
    async (path) => {
      document.title = 'Owned by the page';
      render(
        <MemoryRouter initialEntries={[path]}>
          <RouteTitle />
        </MemoryRouter>
      );
      await act(async () => {});
      expect(document.title).toBe('Owned by the page');
    }
  );
});

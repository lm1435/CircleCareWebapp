import { render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import '@/i18n';

// SECURITY (web audit 2026-10-01): React Router decodes `%2F` inside a param,
// so `/circles/..%2Fusers%2Fme/notes` matches with circleId `../users/me`. The
// route boundary must refuse it before AppLayout (or any page) can build a
// request from it.
const appLayoutRendered = vi.fn();
vi.mock('../AppLayout', () => ({
  AppLayout: () => {
    appLayoutRendered();
    return <div data-testid="app-layout" />;
  },
}));

import { CircleRoute } from '../CircleRoute';

function renderAt(path: string): void {
  const router = createMemoryRouter(
    [{ path: '/circles/:circleId', element: <CircleRoute />, children: [{ path: 'notes' }] }],
    { initialEntries: [path] }
  );
  render(<RouterProvider router={router} />);
}

beforeEach(() => appLayoutRendered.mockClear());

it.each([
  '/circles/..%2Fusers%2Fme/notes',
  '/circles/..%2F..%2Fcspt-probe%3F/notes',
  '/circles/%252e%252e/notes',
  '/circles/a%5Cb/notes',
])('%s lands on "Circle not found" and never mounts AppLayout', (path) => {
  renderAt(path);
  expect(screen.getByTestId('circle-access-lost')).toBeInTheDocument();
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Circle not found');
  expect(appLayoutRendered).not.toHaveBeenCalled();
});

it('a real circle id renders AppLayout', () => {
  renderAt('/circles/3f1c2a9e-7b6d-4c1e-9a2b-0d4e5f6a7b8c/notes');
  expect(screen.getByTestId('app-layout')).toBeInTheDocument();
  expect(screen.queryByTestId('circle-access-lost')).toBeNull();
});

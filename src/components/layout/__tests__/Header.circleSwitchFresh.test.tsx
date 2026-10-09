import type { ReactElement } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import '@/i18n';
import { Header } from '@/components/layout/Header';
import { useCircles } from '@/hooks/useCircles';

// Owner decision: "every new circle should be fresh". Switching circles must
// land on the section's DEFAULT view, so the switcher drops the search string
// (Meds `?tab=history&medication=x`) and hash instead of carrying them over.

vi.mock('@/hooks/useCircles', () => ({ useCircles: vi.fn() }));

function LocationSpy(): ReactElement {
  const l = useLocation();
  return (
    <>
      <div data-testid="path">{l.pathname}</div>
      <div data-testid="search">{l.search}</div>
      <div data-testid="hash">{l.hash}</div>
    </>
  );
}

function renderAt(initial: string): void {
  vi.mocked(useCircles).mockReturnValue({
    data: [
      { id: 'A', name: 'Circle A', recipient_name: 'Rosa' },
      { id: 'B', name: 'Circle B', recipient_name: 'Ana' },
    ],
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  } as never);
  render(
    <MemoryRouter initialEntries={[initial]}>
      <LocationSpy />
      <Routes>
        <Route path="/circles/:circleId/*" element={<Header />} />
        <Route path="*" element={null} />
      </Routes>
    </MemoryRouter>
  );
}

describe('Header circle switch lands on a fresh view', () => {
  it('drops ?tab=history&medication=x from the Meds URL', async () => {
    const user = userEvent.setup();
    renderAt('/circles/A/meds?tab=history&medication=x');
    await user.click(screen.getByRole('button', { name: /Circle A/ }));
    await user.click(screen.getByRole('menuitem', { name: /Circle B/ }));
    expect(screen.getByTestId('path')).toHaveTextContent('/circles/B/meds');
    expect(screen.getByTestId('search')).toBeEmptyDOMElement();
    expect(screen.getByTestId('hash')).toBeEmptyDOMElement();
  });

  it('drops the /daily-update/:date segment and any hash', async () => {
    const user = userEvent.setup();
    renderAt('/circles/A/daily-update/2026-10-01?x=1#top');
    await user.click(screen.getByRole('button', { name: /Circle A/ }));
    await user.click(screen.getByRole('menuitem', { name: /Circle B/ }));
    expect(screen.getByTestId('path').textContent).not.toContain('2026-10-01');
    expect(screen.getByTestId('path').textContent).toMatch(/^\/circles\/B(\/daily-update)?$/);
    expect(screen.getByTestId('search')).toBeEmptyDOMElement();
    expect(screen.getByTestId('hash')).toBeEmptyDOMElement();
  });
});

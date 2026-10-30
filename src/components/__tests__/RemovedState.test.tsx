import { render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MemoryRouter } from 'react-router-dom';
import '@/i18n';
import i18n from '@/i18n';
import { RemovedState } from '@/components/RemovedState';

function renderState(props: Parameters<typeof RemovedState>[0]) {
  return render(
    <MemoryRouter>
      <RemovedState {...props} />
    </MemoryRouter>
  );
}

afterEach(async () => {
  await i18n.changeLanguage('en');
});

describe('RemovedState (mobile twin copy, EN)', () => {
  it('removed: title, reason, OK dismisses and takes focus on the heading', async () => {
    const onDismiss = vi.fn();
    renderState({ reason: 'removed', onDismiss });
    const heading = screen.getByRole('heading', { name: 'This was removed' });
    expect(heading).toHaveFocus();
    expect(screen.getByText('It was deleted or is no longer scheduled.')).toBeInTheDocument();
    expect(screen.queryByTestId('removed-state-context')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('a11y: OK unmounts the state and focus lands on the page heading, never <body>', async () => {
    function Host() {
      const [shown, setShown] = useState(true);
      return (
        <main id="main">
          <h1>Calendar</h1>
          {shown ? <RemovedState reason="removed" onDismiss={() => setShown(false)} /> : null}
        </main>
      );
    }
    render(
      <MemoryRouter>
        <Host />
      </MemoryRouter>
    );
    await userEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(screen.queryByTestId('removed-state')).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Calendar' })).toHaveFocus());
  });

  it('ended: "This has ended."', () => {
    renderState({ reason: 'ended', onDismiss: vi.fn() });
    expect(screen.getByText('This has ended.')).toBeInTheDocument();
  });

  it('no_access: reason, and the primary action is a link "See your circles" (never OK)', () => {
    renderState({ reason: 'no_access' });
    expect(screen.getByText('You no longer have access to this circle.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'See your circles' })).toHaveAttribute('href', '/circles');
    expect(screen.queryByRole('button', { name: 'OK' })).not.toBeInTheDocument();
  });

  it('context line: "From your email" alone, or followed by the linked date in the user\'s locale', async () => {
    const { unmount } = renderState({ reason: 'removed', fromEmail: true, onDismiss: vi.fn() });
    expect(screen.getByTestId('removed-state-context')).toHaveTextContent(/^From your email$/);
    unmount();

    renderState({ reason: 'removed', fromEmail: true, date: '2026-06-12', onDismiss: vi.fn() });
    expect(screen.getByTestId('removed-state-context')).toHaveTextContent('From your email · Jun 12, 2026');
  });

  it('the date is formatted in the active locale and is not shifted by timezone', async () => {
    await i18n.changeLanguage('es');
    renderState({ reason: 'removed', fromEmail: true, date: '2026-06-12', onDismiss: vi.fn() });
    const ctx = screen.getByTestId('removed-state-context');
    expect(ctx).toHaveTextContent(/^Desde tu correo · 12 jun 2026$/);
  });

  it('a malformed date falls back to the plain context line', () => {
    renderState({ reason: 'removed', fromEmail: true, date: 'not-a-date', onDismiss: vi.fn() });
    expect(screen.getByTestId('removed-state-context')).toHaveTextContent(/^From your email$/);
  });

  it('page layout renders an h1 inside the state', () => {
    renderState({ reason: 'removed', layout: 'page', onDismiss: vi.fn() });
    expect(within(screen.getByTestId('removed-state')).getByRole('heading', { level: 1 })).toBeInTheDocument();
  });
});

describe('removedState strings exist in every webapp locale', () => {
  const LOCALES = ['en', 'es', 'de', 'fr', 'fr-CA', 'it', 'pt', 'pt-PT'];
  const KEYS = ['title', 'removed', 'ended', 'noAccess', 'fromEmail', 'fromEmailDate', 'ok', 'seeCircles'];

  it.each(LOCALES)('%s has every key, a {{date}} slot, and no "missed" wording', (locale) => {
    const json = JSON.parse(
      readFileSync(join(__dirname, '..', '..', 'i18n', locale, 'common.json'), 'utf8')
    ) as { removedState?: Record<string, string> };
    const rs = json.removedState ?? {};
    for (const k of KEYS) expect(rs[k], `${locale}.${k}`).toBeTruthy();
    expect(rs.fromEmailDate).toContain('{{date}}');
    expect(Object.values(rs).join(' ')).not.toMatch(/\b(missed|manqu|perdid|mancat|verpasst|versäumt|perdeu)/i);
    expect(Object.values(rs).join(' ')).not.toMatch(/\p{Extended_Pictographic}/u);
  });
});

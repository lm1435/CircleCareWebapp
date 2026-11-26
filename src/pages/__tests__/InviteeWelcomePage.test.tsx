import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import i18n from '@/i18n';
import InviteeWelcomePage from '@/pages/InviteeWelcomePage';
import { Analytics } from '@/lib/analytics';
import { useAuthStore } from '@/store/authStore';
import {
  peekPendingInviteeWelcome,
  recordPendingInviteeWelcome,
  type InviteeWelcomeInput,
} from '@/lib/inviteeWelcome';

// Onboarding 1.3.1 section 4: the invitee welcome (ObWebWelcomeInvitee).

function renderPage(path = '/circles/c1/welcome') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/circles/:circleId/welcome" element={<InviteeWelcomePage />} />
        <Route path="/circles/:circleId" element={<p>TODAY PAGE</p>} />
      </Routes>
    </MemoryRouter>
  );
}

function park(input: InviteeWelcomeInput): void {
  recordPendingInviteeWelcome('u1', 'c1', input);
}

let viewed: ReturnType<typeof vi.spyOn>;
let continued: ReturnType<typeof vi.spyOn>;

beforeEach(async () => {
  sessionStorage.clear();
  await i18n.changeLanguage('en');
  useAuthStore.setState({ user: { id: 'u1' } as never, isAuthenticated: true });
  viewed = vi.spyOn(Analytics, 'inviteeWelcomeViewed').mockImplementation(() => undefined);
  continued = vi.spyOn(Analytics, 'inviteeWelcomeContinued').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  useAuthStore.setState({ user: null, isAuthenticated: false });
});

describe('InviteeWelcomePage', () => {
  it('caregiver: eyebrow, title with inviter + recipient, lede, three editor items', () => {
    park({ inviterName: 'Sam', recipientName: 'Rose' });
    renderPage();
    expect(screen.getByText('Welcome')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { level: 1, name: 'Sam invited you to help with Rose.' })
    ).toBeInTheDocument();
    expect(screen.getByText("You're in Rose's circle now. Here's what you can do:")).toBeInTheDocument();
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(3);
    expect(screen.getByText('See today\'s meds and mark a dose Taken')).toBeInTheDocument();
    expect(screen.getByText('Add a note about how the day went')).toBeInTheDocument();
    expect(screen.getByText('Sam and anyone else helping can read it.')).toBeInTheDocument();
    expect(screen.getByText('See appointments and tasks')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Go to Today' })).toBeInTheDocument();
  });

  it('view-only: only the two "See" items, no editor rows', () => {
    park({ inviterName: 'Sam', recipientName: 'Rose', viewOnly: true });
    renderPage();
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByText("See today's meds")).toBeInTheDocument();
    expect(screen.getByText('Who gave what, and when.')).toBeInTheDocument();
    expect(screen.getByText('Everything coming up for Rose.')).toBeInTheDocument();
    expect(screen.queryByText(/mark a dose/i)).toBeNull();
    expect(screen.queryByText(/Add a note/i)).toBeNull();
  });

  it('missing inviter name falls back to the no-inviter wording everywhere', () => {
    park({ inviterName: null, recipientName: 'Rose' });
    renderPage();
    expect(screen.getByRole('heading', { level: 1, name: "You're helping with Rose." })).toBeInTheDocument();
    expect(screen.getByText('Anyone helping can read it.')).toBeInTheDocument();
    expect(screen.queryByText(/invited you/)).toBeNull();
  });

  it('a care recipient joiner gets the self-care wording', () => {
    park({ inviterName: 'Sam', recipientName: 'Rose', memberType: 'care_recipient', viewOnly: true });
    renderPage();
    expect(screen.getByRole('heading', { level: 1, name: 'Sam invited you to your circle.' })).toBeInTheDocument();
    expect(screen.getByText('Everything coming up for you.')).toBeInTheDocument();
  });

  it('renders in Spanish', async () => {
    await i18n.changeLanguage('es');
    park({ inviterName: 'Sam', recipientName: 'Rose' });
    renderPage();
    expect(screen.getByRole('heading', { level: 1, name: 'Sam te invitó a ayudar con Rose.' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ir a Hoy' })).toBeInTheDocument();
  });

  it('focuses the heading on load', () => {
    park({ inviterName: 'Sam', recipientName: 'Rose' });
    renderPage();
    expect(screen.getByRole('heading', { level: 1 })).toHaveFocus();
  });

  it('is shown once: consumed on view, a second visit goes straight to Today', () => {
    park({ inviterName: 'Sam', recipientName: 'Rose' });
    const first = renderPage();
    expect(peekPendingInviteeWelcome('u1', 'c1')).toBeNull();
    first.unmount();
    renderPage();
    expect(screen.getByText('TODAY PAGE')).toBeInTheDocument();
    expect(viewed).toHaveBeenCalledTimes(1);
  });

  it('with nothing pending (owner / existing member / direct link) it redirects to Today and tracks nothing', () => {
    renderPage();
    expect(screen.getByText('TODAY PAGE')).toBeInTheDocument();
    expect(viewed).not.toHaveBeenCalled();
  });

  it("another user's pending welcome is never shown", () => {
    recordPendingInviteeWelcome('someone-else', 'c1', { recipientName: 'Rose' });
    renderPage();
    expect(screen.getByText('TODAY PAGE')).toBeInTheDocument();
  });

  it('fires invitee_welcome_viewed {role, items} once per mount', () => {
    park({ inviterName: 'Sam', recipientName: 'Rose' });
    renderPage();
    expect(viewed).toHaveBeenCalledTimes(1);
    expect(viewed).toHaveBeenCalledWith('caregiver', 3);
  });

  it('view-only fires role view_only with 2 items', () => {
    park({ recipientName: 'Rose', viewOnly: true });
    renderPage();
    expect(viewed).toHaveBeenCalledWith('view_only', 2);
  });

  it('Go to Today fires invitee_welcome_continued {seconds} and opens Today', async () => {
    let now = 1_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    park({ inviterName: 'Sam', recipientName: 'Rose' });
    renderPage();
    now += 7400;
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Go to Today' }));
    expect(continued).toHaveBeenCalledTimes(1);
    expect(continued).toHaveBeenCalledWith(7);
    expect(screen.getByText('TODAY PAGE')).toBeInTheDocument();
  });
});

// FIRST RUN FUNNEL (owner 2026-11-22): the invited path's `invitee_welcome` step, then Today.
describe('InviteeWelcomePage — first run funnel', () => {
  let stepViewed: ReturnType<typeof vi.spyOn>;
  let stepCompleted: ReturnType<typeof vi.spyOn>;
  beforeEach(async () => {
    const { resetFirstRunFunnelForTests } = await import('@/lib/firstRunFunnel');
    resetFirstRunFunnelForTests();
    stepViewed = vi.spyOn(Analytics, 'firstRunStepViewed').mockImplementation(() => {});
    stepCompleted = vi.spyOn(Analytics, 'firstRunStepCompleted').mockImplementation(() => {});
  });

  it('POSITIVE: an invited run views invitee_welcome once, completes it on Go to Today, then views today', async () => {
    const { setFirstRunPath } = await import('@/lib/firstRunFunnel');
    setFirstRunPath('invited');
    park({ inviterName: 'Sam', recipientName: 'Rose' });
    renderPage();
    expect(stepViewed).toHaveBeenCalledTimes(1);
    expect(stepViewed).toHaveBeenCalledWith(undefined, 'invitee_welcome', 'invited');
    expect(stepCompleted).not.toHaveBeenCalled();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Go to Today' }));
    expect(stepCompleted).toHaveBeenCalledTimes(1);
    expect(stepCompleted).toHaveBeenCalledWith('invitee_welcome', expect.any(String), 'invited', undefined);
    expect(stepViewed).toHaveBeenLastCalledWith(undefined, 'today', 'invited');
  });

  it('NEGATIVE: someone joining a SECOND circle (no first run in this tab) sends no funnel event', async () => {
    park({ inviterName: 'Sam', recipientName: 'Rose' });
    renderPage();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Go to Today' }));
    expect(stepViewed).not.toHaveBeenCalled();
    expect(stepCompleted).not.toHaveBeenCalled();
  });

  it('NEGATIVE: nothing pending (reload) redirects to Today with no funnel event', async () => {
    const { setFirstRunPath } = await import('@/lib/firstRunFunnel');
    setFirstRunPath('invited');
    renderPage();
    expect(stepViewed).not.toHaveBeenCalled();
  });
});

// 1.4.4 (prod 2026-11-26): 38 of 100 invites were accepted in a browser, which cannot send push.
describe('InviteeWelcomePage: "Get alerts on your phone"', () => {
  let appViewed: ReturnType<typeof vi.spyOn>;
  let appTapped: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    appViewed = vi.spyOn(Analytics, 'getAppPromptViewed').mockImplementation(() => undefined);
    appTapped = vi.spyOn(Analytics, 'getAppPromptTapped').mockImplementation(() => undefined);
  });

  it('POSITIVE: a new member is told the website cannot notify, with both store links; viewed once', () => {
    park({ inviterName: 'Sam', recipientName: 'Rose' });
    renderPage();
    const block = screen.getByRole('region', { name: 'Get alerts on your phone' });
    expect(block).toHaveTextContent(
      "This website can't send notifications. Install the CircleCare app and sign in with the same account to get reminders and alerts."
    );
    expect(within(block).getByRole('link', { name: 'Download on the App Store' })).toHaveAttribute('href', expect.stringContaining('apps.apple.com'));
    expect(within(block).getByRole('link', { name: 'Get it on Google Play' })).toHaveAttribute('href', expect.stringContaining('play.google.com'));
    expect(appViewed).toHaveBeenCalledTimes(1);
    expect(appViewed).toHaveBeenCalledWith('invitee_welcome');
    expect(appTapped).not.toHaveBeenCalled();
  });

  it('POSITIVE: each badge reports its own store (enum only) and stays a normal link', async () => {
    park({ inviterName: 'Sam', recipientName: 'Rose', viewOnly: true });
    renderPage();
    const block = screen.getByRole('region', { name: 'Get alerts on your phone' });
    const play = within(block).getByRole('link', { name: 'Get it on Google Play' });
    play.addEventListener('click', (e) => e.preventDefault());
    await userEvent.setup().click(play);
    expect(appTapped.mock.calls).toEqual([['invitee_welcome', 'android']]);
    const ios = within(block).getByRole('link', { name: 'Download on the App Store' });
    ios.addEventListener('click', (e) => e.preventDefault());
    await userEvent.setup().click(ios);
    expect(appTapped.mock.calls).toEqual([['invitee_welcome', 'android'], ['invitee_welcome', 'ios']]);
  });

  it('NEGATIVE: it never blocks: "Go to Today" still continues without touching a badge', async () => {
    park({ inviterName: 'Sam', recipientName: 'Rose' });
    renderPage();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Go to Today' }));
    expect(continued).toHaveBeenCalledTimes(1);
    expect(appTapped).not.toHaveBeenCalled();
  });

  it('NEGATIVE: nothing pending (reload) shows no block and reports nothing', () => {
    renderPage();
    expect(screen.queryByTestId('invitee-get-app')).not.toBeInTheDocument();
    expect(appViewed).not.toHaveBeenCalled();
  });

  it('POSITIVE (es): the block is translated', async () => {
    await i18n.changeLanguage('es');
    park({ inviterName: 'Sam', recipientName: 'Rose' });
    renderPage();
    expect(screen.getByRole('region', { name: 'Recibe alertas en tu teléfono' })).toBeInTheDocument();
  });
});

import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import fs from 'node:fs';
import path from 'node:path';
import i18n from '@/i18n';
import { EmptyCircles, type EmptyCirclesProps } from '@/components/circles/EmptyCircles';

// 1.4.3 Circles first-time empty state "A2-complete" (docs/mocks-143/empty-state,
// A2-complete-web.png). Mobile twin: CircleListEmptyStateA2.test.tsx.
//
// POSITIVE: the new title / sentence / Example card (labelled Example) / free and
// private lines / both doors / the kept footer (invitations, Learn more, badges), ES.
// NEGATIVE: no old headline / steps / "or"; no "even offline" on web; no locale's
// reminders row claims reminders go to "you and" someone; old keys gone.

function renderEmpty(props: EmptyCirclesProps = {}) {
  render(
    <MemoryRouter>
      <EmptyCircles {...props} />
    </MemoryRouter>
  );
}

const BUTTONS: EmptyCirclesProps = {
  action: <button type="button">Start a care circle</button>,
  joinAction: <button type="button">I have an invite code</button>,
};

afterEach(async () => {
  await i18n.changeLanguage('en');
});

describe('EmptyCircles (A2): positive', () => {
  it('renders the greeting eyebrow, the h1 title and the one-sentence explanation', () => {
    renderEmpty({ greeting: 'Good morning, Maria' });
    expect(screen.getByText('Good morning, Maria')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'One place for their care' })).toBeInTheDocument();
    expect(
      screen.getByText(
        'A care circle keeps one person’s medications, appointments, tasks, notes and documents together, shared with the family, friends or paid caregiver you invite.'
      )
    ).toBeInTheDocument();
  });

  it('shows the Example card, named as an example, with its four rows', () => {
    renderEmpty();
    const card = screen.getByRole('figure', { name: 'Example: Today for Rosa' });
    expect(within(card).getByText('Example')).toBeInTheDocument();
    expect(within(card).getByText('Today for Rosa')).toBeInTheDocument();
    expect(within(card).getByText('Rosa took her 8:00 AM dose')).toBeInTheDocument();
    expect(within(card).getByText('You and Ana were notified')).toBeInTheDocument();
    expect(within(card).getByText('You choose who gets reminders')).toBeInTheDocument();
    expect(within(card).getByText('It doesn’t all have to fall to you')).toBeInTheDocument();
    expect(within(card).getByText('Dr. Patel, cardiology · 10:30 AM')).toBeInTheDocument();
    expect(within(card).getByText('On one shared calendar')).toBeInTheDocument();
    expect(within(card).getByText('Emergency info')).toBeInTheDocument();
    expect(within(card).getByText('Allergies, doctors and insurance in seconds')).toBeInTheDocument();
    expect(within(card).getAllByRole('listitem')).toHaveLength(4);
  });

  it('shows the free line and "Private & secure"', () => {
    renderEmpty();
    expect(screen.getByText('Free to start. Medications and reminders are never paywalled.')).toBeInTheDocument();
    expect(screen.getByText('Private & secure')).toBeInTheDocument();
  });

  it('renders both doors side by side', () => {
    renderEmpty(BUTTONS);
    const start = screen.getByRole('button', { name: 'Start a care circle' });
    const join = screen.getByRole('button', { name: 'I have an invite code' });
    expect(start.parentElement).toBe(join.parentElement);
  });

  it('keeps the invitations link, Learn more and the companion-app badges', () => {
    renderEmpty();
    expect(screen.getByRole('link', { name: 'Check your invitations' })).toHaveAttribute('href', '/invites');
    expect(screen.getByRole('link', { name: 'Learn more' })).toHaveAttribute('href', '/help');
    expect(screen.getByText('Prefer your phone? Get the companion app.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Download on the App Store' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Get it on Google Play' })).toBeInTheDocument();
  });

  it('renders the Latin American Spanish strings from the mock', async () => {
    await i18n.changeLanguage('es');
    renderEmpty();
    expect(screen.getByRole('heading', { level: 1, name: 'Un solo lugar para su cuidado' })).toBeInTheDocument();
    expect(screen.getByRole('figure', { name: 'Ejemplo: Hoy para Rosa' })).toBeInTheDocument();
    expect(screen.getByText('Tú eliges quién recibe los recordatorios')).toBeInTheDocument();
    expect(screen.getByText('Alergias, médicos y seguro en segundos')).toBeInTheDocument();
    expect(screen.getByText('Privado y seguro')).toBeInTheDocument();
  });
});

describe('EmptyCircles (A2): negative', () => {
  it.each([
    "Let's set up your care circle",
    'How CircleCare works',
    'Create a circle for your loved one.',
    'Invite family and caregivers to share the load.',
    'or',
  ])('does not render the old "%s"', (s) => {
    renderEmpty(BUTTONS);
    expect(screen.queryByText(s)).not.toBeInTheDocument();
  });

  it('never says "even offline" on web (no offline emergency copy here)', () => {
    renderEmpty();
    expect(screen.queryByText(/offline/i)).not.toBeInTheDocument();
  });

  it('no eyebrow when no greeting is given', () => {
    renderEmpty();
    expect(screen.queryByText(/^Good (morning|afternoon|evening)/)).not.toBeInTheDocument();
  });

  const dir = path.resolve(__dirname, '../../../i18n');
  const locales = fs.readdirSync(dir).filter((l) => fs.existsSync(path.join(dir, l, 'members.json')));

  it.each(locales)('%s: the old headline / steps keys are gone', (l) => {
    const empty = JSON.parse(fs.readFileSync(path.join(dir, l, 'members.json'), 'utf8')).picker?.empty ?? {};
    for (const k of ['title', 'body', 'howItWorksTitle', 'step1', 'step2', 'step3']) {
      expect([l, k, empty[k]]).toEqual([l, k, undefined]);
    }
  });

  it.each(locales)('%s: no "reminders go to you and" claim, no offline claim', (l) => {
    const empty = JSON.parse(fs.readFileSync(path.join(dir, l, 'members.json'), 'utf8')).picker?.empty ?? {};
    const FALSE_CLAIM = [/reminders? go(es)? to you and/i, /recordatorios? (te )?llegan? a ti y/i, /you and \w+ get (the )?reminders/i];
    for (const k of ['exampleReminders', 'exampleRemindersSub', 'a2Subtitle']) {
      if (empty[k] === undefined) continue;
      for (const re of FALSE_CLAIM) expect(`${l}:${empty[k]}`).not.toMatch(re);
    }
    if (empty.exampleEmergencySub !== undefined) {
      expect(empty.exampleEmergencySub).not.toMatch(/offline|sin conexión|hors ligne|sem ligação/i);
    }
  });
});

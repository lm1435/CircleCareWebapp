import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import fs from 'node:fs';
import path from 'node:path';
import i18n from '@/i18n';
import { Button } from '@/components/ui';
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
    expect(screen.getByRole('heading', { level: 1, name: 'One place for care' })).toBeInTheDocument();
    expect(
      screen.getByText(
        'Keep one person’s care in one place, shared with the family, friends or paid caregiver you invite.'
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

  it('the free line says "always free", never "free forever" or a stronger claim', () => {
    renderEmpty();
    expect(screen.queryByText(/forever|never paywalled|for life/i)).not.toBeInTheDocument();
  });

  it('shows the free line and "Private & secure"', () => {
    renderEmpty();
    expect(screen.getByText('Free to start. Medications and reminders are always free.')).toBeInTheDocument();
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

  it('renders the approved copy in every locale (title, subtitle, free note)', async () => {
    const expected: Record<string, [string, RegExp, string]> = {
      es: ['Un solo lugar para el cuidado', /^Reúne el cuidado de una persona/, 'Gratis para empezar. Los medicamentos y recordatorios siempre son gratis.'],
      de: ['Alles für die Pflege an einem Ort', /^Halten Sie die Pflege einer Person/, 'Kostenlos starten. Medikamente und Erinnerungen sind immer kostenlos.'],
      fr: ['Un seul endroit pour les soins', /^Réunissez les soins d’une personne/, 'Gratuit pour commencer. Les médicaments et les rappels sont toujours gratuits.'],
      it: ['Un solo posto per la cura', /^Riunisci la cura di una persona/, 'Si inizia gratis. Farmaci e promemoria sono sempre gratuiti.'],
      pt: ['Um só lugar para o cuidado', /^Reúna o cuidado de uma pessoa em um só lugar/, 'Grátis para começar. Medicamentos e lembretes são sempre grátis.'],
      'pt-PT': ['Um só lugar para o cuidado', /^Reúna o cuidado de uma pessoa num só lugar/, 'Grátis para começar. Medicamentos e lembretes são sempre grátis.'],
    };
    for (const [lng, [title, sub, free]] of Object.entries(expected)) {
      await i18n.changeLanguage(lng);
      const { unmount } = render(
        <MemoryRouter>
          <EmptyCircles />
        </MemoryRouter>
      );
      expect([lng, screen.getByRole('heading', { level: 1 }).textContent]).toEqual([lng, title]);
      expect([lng, screen.getByText(sub) !== null]).toEqual([lng, true]);
      expect([lng, screen.getByText(free) !== null]).toEqual([lng, true]);
      unmount();
    }
  });

  it('renders the Latin American Spanish strings from the mock', async () => {
    await i18n.changeLanguage('es');
    renderEmpty();
    expect(screen.getByRole('heading', { level: 1, name: 'Un solo lugar para el cuidado' })).toBeInTheDocument();
    expect(screen.getByRole('figure', { name: 'Ejemplo: Hoy para Rosa' })).toBeInTheDocument();
    expect(screen.getByText('Tú eliges quién recibe los recordatorios')).toBeInTheDocument();
    expect(screen.getByText('Alergias, médicos y seguro en segundos')).toBeInTheDocument();
    expect(screen.getByText('Privado y seguro')).toBeInTheDocument();
  });
});

describe('EmptyCircles (A2): look and feel parity (1.4.4)', () => {
  it('the Example card avatars are an aria-hidden overlapped stack (32 px, -10 px overlap) with a cream ring', () => {
    renderEmpty({ firstName: 'Maria' });
    const stack = screen.getByTestId('empty-example-avatars');
    expect(stack).toHaveAttribute('aria-hidden', 'true');
    const items = Array.from(stack.children) as HTMLElement[];
    expect(items).toHaveLength(2);
    expect(items[0]!.className).not.toMatch(/-ml-/);
    expect(items[1]!.className).toContain('-ml-2.5');
    for (const item of items) {
      const avatar = item.firstElementChild as HTMLElement;
      expect(avatar.className).toContain('ring-2');
      expect(avatar.className).toContain('ring-cream');
      expect(avatar.className).toContain('h-8 w-8');
    }
  });

  it('without a first name the stack is just Ana, with no overlap', () => {
    renderEmpty();
    const items = Array.from(screen.getByTestId('empty-example-avatars').children) as HTMLElement[];
    expect(items).toHaveLength(1);
    expect(items[0]!.className).not.toMatch(/-ml-/);
  });

  it('the stack is decorative: the figure name carries the meaning and no avatar is announced', () => {
    renderEmpty({ firstName: 'Maria' });
    const card = screen.getByRole('figure', { name: 'Example: Today for Rosa' });
    expect(within(card).queryByRole('img')).toBeNull();
    expect(within(card).getByText('M').closest('[aria-hidden="true"]')).not.toBeNull(); // initials live inside the aria-hidden stack
  });

  it('the secondary door is smaller than the primary (sm vs lg) and still 44 px tall', () => {
    renderEmpty({
      action: <Button size="lg">Start a care circle</Button>,
      joinAction: (
        <Button size="sm" variant="outline">
          I have an invite code
        </Button>
      ),
    });
    const start = screen.getByRole('button', { name: 'Start a care circle' });
    const join = screen.getByRole('button', { name: 'I have an invite code' });
    expect(start.className).toContain('min-h-[52px]');
    expect(join.className).toContain('min-h-[44px]');
    expect(join.className).not.toContain('min-h-[52px]');
    expect(join.className).toContain('text-sm');
  });

  it('the intro uses the page title + page subtitle rhythm, and renders no account entry of its own', () => {
    renderEmpty({ greeting: 'Good morning, Maria' });
    const h1 = screen.getByRole('heading', { level: 1 });
    expect(h1.className).toContain('leading-[38px]'); // pageTitle
    expect(screen.getByText(/^Keep one person/).className).toContain('leading-[22px]'); // pageSubtitle
    // The global header owns the account menu; the empty state must not add a second one.
    expect(screen.queryByRole('button', { name: /account|profile/i })).toBeNull();
    expect(screen.queryByTestId('empty-profile-button')).toBeNull();
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

  it.each(locales)('%s: the title has no possessive and the free note makes no "forever" claim', (l) => {
    const empty = JSON.parse(fs.readFileSync(path.join(dir, l, 'members.json'), 'utf8')).picker?.empty ?? {};
    const POSSESSIVE = /\b(their|su cuidado|ihre|ses soins|sua cura|de quem|quem (você )?ama)\b/i;
    if (empty.a2Title !== undefined) expect(`${l}:${empty.a2Title}`).not.toMatch(POSSESSIVE);
    if (empty.freeNote !== undefined) {
      expect(`${l}:${empty.freeNote}`).not.toMatch(/forever|para siempre|für immer|pour toujours|per sempre|para sempre|nunca|never|nie |jamais|mai /i);
    }
  });
});

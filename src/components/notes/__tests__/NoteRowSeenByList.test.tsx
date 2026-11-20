import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n from '@/i18n';
import { NoteRow } from '../NoteRow';
import type { CareNote } from '@/api/careNotes';

// Full reader list behind the "Seen by" caption (3+ readers): button, hover / focus / click,
// Escape, ARIA, the 50-name cap, the generic "Someone" fallback and the analytics event.

vi.mock('@/hooks/useHourCycle', () => ({ useHourCycle: () => '12h' }));

const expanded = vi.fn();
vi.mock('@/lib/analytics', async (orig) => {
  const mod = await orig<typeof import('@/lib/analytics')>();
  return {
    ...mod,
    Analytics: new Proxy(mod.Analytics, {
      get: (t, k) => (k === 'careNoteSeenByExpanded' ? expanded : (t as never)[k]),
    }),
  };
});

const ME = 'me-user';
vi.mock('@/store/authStore', () => {
  const state = () => ({ user: { id: 'me-user' } });
  const useAuthStore = (selector: (s: ReturnType<typeof state>) => unknown) => selector(state());
  useAuthStore.getState = state;
  return { useAuthStore };
});

const AUTHOR = 'author-user';
const r = (id: string, first: string | null) => ({ user_id: id, first_name: first });
const five = [r('u1', 'Maria'), r('u2', 'Luis'), r('u3', 'Ana'), r('u4', 'Joe'), r('u5', 'Zed')];

function makeNote(seen_by: CareNote['seen_by']): CareNote {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    circle_id: 'c1',
    author_id: AUTHOR,
    note_date: '2026-08-10',
    body: 'Ate a good breakfast.',
    mood: null,
    categories: [],
    created_at: '2026-08-10T20:30:00.000Z',
    updated_at: '2026-08-10T20:30:00.000Z',
    author: { id: AUTHOR, first_name: 'Sam', last_name: 'Rivera' },
    seen_by,
  };
}

function renderRow(seen: CareNote['seen_by']) {
  const noop = () => {};
  return render(
    <NoteRow
      note={makeNote(seen)}
      timezone="America/New_York"
      canEditOwn={false}
      canDelete={false}
      editing={false}
      onStartEdit={noop}
      onCancelEdit={noop}
      onSaveEdit={noop}
      onDelete={noop}
      savePending={false}
    />
  );
}

const CAPTION = /^Seen by Maria, Luis and 3 others$/;
const sleep = (ms: number) => act(() => new Promise<void>((res) => setTimeout(res, ms)));
const dwell = () => sleep(400);
// Reader list items only (the note card itself is an <li>).
const listNames = () =>
  Array.from(document.querySelectorAll('[role="group"] ul li')).map((li) => li.textContent);

beforeEach(async () => {
  expanded.mockClear();
  await i18n.changeLanguage('en');
});

describe('NoteRow seen-by list: positive', () => {
  it('P1 5 readers: the caption is a button; hover shows all 5 names in order', async () => {
    const user = userEvent.setup({ delay: null });
    renderRow(five);
    const btn = screen.getByRole('button', { name: CAPTION });
    expect(btn.getAttribute('type')).toBe('button');
    expect(document.querySelector('[role="group"]')).toBeNull();
    await user.hover(btn);
    expect(listNames()).toEqual(['Maria', 'Luis', 'Ana', 'Joe', 'Zed']);
    expect(screen.getByRole('group', { name: 'Seen by' })).toBeInTheDocument();
  });

  it('P1b the popover is hoverable: moving the pointer onto it keeps it open', async () => {
    const user = userEvent.setup({ delay: null });
    renderRow(five);
    await user.hover(screen.getByRole('button', { name: CAPTION }));
    const pop = screen.getByRole('group', { name: 'Seen by' });
    await user.unhover(screen.getByRole('button', { name: CAPTION }));
    await user.hover(pop);
    await sleep(500);
    expect(screen.getByRole('group', { name: 'Seen by' })).toBeInTheDocument();
    await user.unhover(pop);
    await sleep(500);
    expect(screen.queryByRole('group')).toBeNull();
  });

  it('P2 keyboard focus opens it; Escape closes it and focus stays on the button', async () => {
    const user = userEvent.setup({ delay: null });
    renderRow(five);
    await user.tab();
    const btn = screen.getByRole('button', { name: CAPTION });
    expect(btn).toHaveFocus();
    expect(listNames()).toHaveLength(5);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('group')).toBeNull();
    expect(btn).toHaveFocus();
  });

  it('P3 click toggles open and closed (and a click outside closes it)', async () => {
    const user = userEvent.setup({ delay: null });
    renderRow(five);
    const btn = screen.getByRole('button', { name: CAPTION });
    await user.click(btn); // hover already opened it; the click pins it
    await user.unhover(btn);
    await sleep(500);
    expect(screen.getByRole('group')).toBeInTheDocument(); // pinned: survives mouse leave
    await user.click(btn);
    expect(screen.queryByRole('group')).toBeNull();
    await user.click(btn);
    expect(screen.getByRole('group')).toBeInTheDocument();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('group')).toBeNull();
  });

  it('P4 aria-expanded and aria-controls are right in both states', async () => {
    const user = userEvent.setup({ delay: null });
    renderRow(five);
    const btn = screen.getByRole('button', { name: CAPTION });
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    const id = btn.getAttribute('aria-controls');
    expect(id).toBeTruthy();
    await user.hover(btn);
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    expect(document.getElementById(id!)).toBe(screen.getByRole('group', { name: 'Seen by' }));
    await user.keyboard('{Escape}');
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    expect(btn.getAttribute('aria-controls')).toBe(id);
  });

  it('P5 the analytics event fires once per open with {reader_count: 5, trigger: hover}', async () => {
    const user = userEvent.setup({ delay: null });
    renderRow(five);
    const btn = screen.getByRole('button', { name: CAPTION });
    await user.hover(btn);
    await dwell();
    expect(expanded).toHaveBeenCalledTimes(1);
    expect(expanded).toHaveBeenCalledWith({ readerCount: 5, trigger: 'hover' });
    await user.keyboard('{Escape}');
    await user.unhover(btn);
    await user.hover(btn); // a new open: a second event
    await dwell();
    expect(expanded).toHaveBeenCalledTimes(2);
  });

  it('P8 keyboard focus fires once with trigger focus after the dwell', async () => {
    const user = userEvent.setup({ delay: null });
    renderRow(five);
    await user.tab();
    expect(expanded).not.toHaveBeenCalled();
    await dwell();
    expect(expanded).toHaveBeenCalledTimes(1);
    expect(expanded).toHaveBeenCalledWith({ readerCount: 5, trigger: 'focus' });
  });

  it('P9 a click fires immediately with trigger click (no dwell wait)', async () => {
    renderRow(five);
    const btn = screen.getByRole('button', { name: CAPTION });
    fireEvent.click(btn);
    expect(expanded).toHaveBeenCalledTimes(1);
    expect(expanded).toHaveBeenCalledWith({ readerCount: 5, trigger: 'click' });
    await sleep(800);
    expect(expanded).toHaveBeenCalledTimes(1);
  });

  it('P10 hover then click (pin) after the event fired does not fire a second event', async () => {
    const user = userEvent.setup({ delay: null });
    renderRow(five);
    const btn = screen.getByRole('button', { name: CAPTION });
    await user.hover(btn);
    await dwell();
    expect(expanded).toHaveBeenCalledTimes(1);
    await user.click(btn);
    await sleep(500);
    expect(expanded).toHaveBeenCalledTimes(1);
    expect(expanded).toHaveBeenLastCalledWith({ readerCount: 5, trigger: 'hover' });
  });

  it('P11 the popover has a "Seen by" heading line above the names and a 180px minimum width', async () => {
    const user = userEvent.setup({ delay: null });
    renderRow(five);
    await user.hover(screen.getByRole('button', { name: CAPTION }));
    const pop = screen.getByRole('group', { name: 'Seen by' });
    const heading = pop.querySelector('p[aria-hidden="true"]');
    expect(heading?.textContent).toBe('Seen by');
    expect(heading!.compareDocumentPosition(pop.querySelector('ul')!)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING
    );
    expect(pop.className).toMatch(/min-w-\[min\(180px/);
    expect(pop.className).toMatch(/max-w-\[min\(280px,calc\(100vw-16px\)\)\]/);
  });

  it('P6 60 readers show 50 names plus "+10 more"', async () => {
    const user = userEvent.setup({ delay: null });
    renderRow(Array.from({ length: 60 }, (_, i) => r(`u${i}`, `Name${i}`)));
    await user.hover(screen.getByRole('button'));
    const shown = listNames();
    expect(shown).toHaveLength(50);
    expect(shown[0]).toBe('Name0');
    expect(shown[49]).toBe('Name49');
    expect(screen.getByText('+10 more')).toBeInTheDocument();
    expect(screen.queryByText('Name50')).toBeNull();
  });

  it('P7 a nameless reader shows "Someone" (en) / "Alguien" (es)', async () => {
    const user = userEvent.setup({ delay: null });
    const seen = [r('u1', 'Maria'), r('u2', 'Luis'), r('u3', null)];
    const { unmount } = renderRow(seen);
    await user.hover(screen.getByRole('button'));
    expect(listNames()).toEqual(['Maria', 'Luis', 'Someone']);
    unmount();
    await i18n.changeLanguage('es');
    renderRow(seen);
    await user.hover(screen.getByRole('button'));
    expect(listNames()).toEqual(['Maria', 'Luis', 'Alguien']);
    expect(screen.getByRole('group', { name: 'Visto por' })).toBeInTheDocument();
  });
});

describe('NoteRow seen-by list: negative', () => {
  it('N1 one or two readers: plain text, no button, no popover, no event', async () => {
    const user = userEvent.setup({ delay: null });
    for (const seen of [[r('u1', 'Maria')], [r('u1', 'Maria'), r('u2', 'Luis')]]) {
      const { unmount } = renderRow(seen);
      const line = screen.getByText(/^Seen by /);
      expect(line.tagName).toBe('P');
      expect(screen.queryByRole('button')).toBeNull();
      await user.hover(line);
      await user.click(line);
      await dwell();
      expect(screen.queryByRole('group')).toBeNull();
      unmount();
    }
    expect(expanded).not.toHaveBeenCalled();
  });

  it('N2 zero readers: nothing rendered', () => {
    renderRow([]);
    expect(screen.queryByText(/Seen by/)).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('N3 the viewer and the author never appear in the list', async () => {
    const user = userEvent.setup({ delay: null });
    renderRow([r(ME, 'Viola'), r(AUTHOR, 'Sam'), ...five.slice(0, 3)]);
    await user.hover(screen.getByRole('button', { name: /^Seen by Maria, Luis and 1 other$/ }));
    expect(listNames()).toEqual(['Maria', 'Luis', 'Ana']);
    expect(screen.queryByText('Viola')).toBeNull();
    expect(screen.getByRole('group').textContent).not.toMatch(/Sam|Viola/);
  });

  it('N4 a hover shorter than the threshold fires no event; staying open fires no second event', async () => {
    const user = userEvent.setup({ delay: null });
    renderRow(five);
    const btn = screen.getByRole('button', { name: CAPTION });
    // Fly-by: pointer in and straight out (fireEvent keeps the timing deterministic).
    fireEvent.mouseEnter(btn);
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    fireEvent.mouseLeave(btn);
    await sleep(200); // the leave grace (150 ms) elapses; act flushes the close before the 300 ms dwell
    await sleep(1000);
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    expect(expanded).not.toHaveBeenCalled();
    await user.hover(btn);
    await dwell();
    await sleep(1500);
    expect(expanded).toHaveBeenCalledTimes(1);
  });

  it('N8 a tab-through (focus then blur within the dwell) fires no event', async () => {
    renderRow(five);
    const btn = screen.getByRole('button', { name: CAPTION });
    fireEvent.focus(btn);
    fireEvent.blur(btn);
    await sleep(1000);
    expect(expanded).not.toHaveBeenCalled();
  });

  it('N9 closing a pinned popover with a click fires no event', async () => {
    renderRow(five);
    const btn = screen.getByRole('button', { name: CAPTION });
    fireEvent.click(btn);
    expanded.mockClear();
    fireEvent.click(btn);
    await sleep(500);
    expect(expanded).not.toHaveBeenCalled();
  });

  it('N6 a hostile name renders as text, not markup', async () => {
    const user = userEvent.setup({ delay: null });
    const evil = '<img src=x onerror=alert(1)>';
    renderRow([r('u1', evil), r('u2', 'Luis'), r('u3', 'Ana')]);
    await user.hover(screen.getByRole('button'));
    expect(listNames()[0]).toBe(evil);
    expect(document.querySelector('img')).toBeNull();
  });

  it('N7 "Former member" is not used for a nameless reader; the author fallback still is', async () => {
    const user = userEvent.setup({ delay: null });
    const note = makeNote([r('u1', null), r('u2', null), r('u3', null)]);
    const noop = () => {};
    render(
      <NoteRow
        note={{ ...note, author: null }}
        timezone="America/New_York"
        canEditOwn={false}
        canDelete={false}
        editing={false}
        onStartEdit={noop}
        onCancelEdit={noop}
        onSaveEdit={noop}
        onDelete={noop}
        savePending={false}
      />
    );
    await user.hover(screen.getByRole('button'));
    expect(screen.getByRole('group').textContent).not.toMatch(/Former member/);
    expect(screen.getByRole('button').textContent).not.toMatch(/Former member/);
    // The author header still says "Former member" (unchanged use).
    expect(screen.getByText('Former member')).toBeInTheDocument();
  });
});

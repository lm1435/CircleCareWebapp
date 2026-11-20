import { render, screen } from '@testing-library/react';
import '@/i18n';
import i18n from '@/i18n';
import { NoteRow } from '../NoteRow';
import type { CareNote } from '@/api/careNotes';

// "Seen by" caption on the Notes row: reader sentences (1 / 2 / 3+), en + es, and the cases that
// must render NOTHING (absent, empty, only the viewer / the author). Never "Not seen".

vi.mock('@/hooks/useHourCycle', () => ({ useHourCycle: () => '12h' }));

const ME = 'me-user';
vi.mock('@/store/authStore', () => {
  const state = () => ({ user: { id: 'me-user' } });
  const useAuthStore = (selector: (s: ReturnType<typeof state>) => unknown) => selector(state());
  useAuthStore.getState = state;
  return { useAuthStore };
});

const AUTHOR = 'author-user';
const r = (id: string, first: string | null) => ({ user_id: id, first_name: first });

function makeNote(seen_by?: CareNote['seen_by']): CareNote {
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
    ...(seen_by === undefined ? {} : { seen_by }),
  };
}

function renderRow(note: CareNote) {
  const noop = () => {};
  return render(
    <NoteRow
      note={note}
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

const seenLine = () => document.querySelector('li p:not(.whitespace-pre-wrap)');

afterEach(async () => {
  await i18n.changeLanguage('en');
});

describe('NoteRow "Seen by": positive', () => {
  it('P3 en: 1 / 2 / 3 / 4 readers', () => {
    const cases: Array<[CareNote['seen_by'], string]> = [
      [[r('u1', 'Maria')], 'Seen by Maria'],
      [[r('u1', 'Maria'), r('u2', 'Luis')], 'Seen by Maria and Luis'],
      [[r('u1', 'Maria'), r('u2', 'Luis'), r('u3', 'Ana')], 'Seen by Maria, Luis and 1 other'],
      [
        [r('u1', 'Maria'), r('u2', 'Luis'), r('u3', 'Ana'), r('u4', 'Joe')],
        'Seen by Maria, Luis and 2 others',
      ],
    ];
    for (const [seen, text] of cases) {
      const { unmount } = renderRow(makeNote(seen));
      expect(screen.getByText(text)).toBeInTheDocument();
      unmount();
    }
  });

  it('P3 es: 1 / 2 / 3+ readers', async () => {
    await i18n.changeLanguage('es');
    const cases: Array<[CareNote['seen_by'], string]> = [
      [[r('u1', 'Maria')], 'Visto por Maria'],
      [[r('u1', 'Maria'), r('u2', 'Luis')], 'Visto por Maria y Luis'],
      [[r('u1', 'Maria'), r('u2', 'Luis'), r('u3', 'Ana')], 'Visto por Maria, Luis y 1 más'],
      [
        [r('u1', 'Maria'), r('u2', 'Luis'), r('u3', 'Ana'), r('u4', 'Joe')],
        'Visto por Maria, Luis y 2 más',
      ],
    ];
    for (const [seen, text] of cases) {
      const { unmount } = renderRow(makeNote(seen));
      expect(screen.getByText(text)).toBeInTheDocument();
      unmount();
    }
  });

  it('P3 de/fr/it/pt: the 2-reader sentence is translated', async () => {
    const expected: Record<string, string> = {
      de: 'Gesehen von Maria und Luis',
      fr: 'Vu par Maria et Luis',
      it: 'Vista da Maria e Luis',
      pt: 'Visto por Maria e Luis',
    };
    for (const [lng, text] of Object.entries(expected)) {
      await i18n.changeLanguage(lng);
      const { unmount } = renderRow(makeNote([r('u1', 'Maria'), r('u2', 'Luis')]));
      expect(screen.getByText(text)).toBeInTheDocument();
      unmount();
    }
  });

  it('a reader with no first name uses the generic "Someone" fallback (mobile parity)', () => {
    renderRow(makeNote([r('u1', null)]));
    expect(screen.getByText('Seen by Someone')).toBeInTheDocument();
  });

  it('the line is real text in the note content, after the body (reading order)', () => {
    renderRow(makeNote([r('u1', 'Maria')]));
    const body = screen.getByText('Ate a good breakfast.');
    const line = screen.getByText('Seen by Maria');
    expect(line.getAttribute('aria-hidden')).toBeNull();
    expect(body.compareDocumentPosition(line) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(line.closest('li')).toBe(body.closest('li'));
  });
});

describe('NoteRow "Seen by": negative', () => {
  it('N8: absent, empty, or only me and/or the author renders NO element and never "Not seen"', () => {
    const cases: Array<CareNote['seen_by']> = [
      undefined,
      [],
      [r(ME, 'Me')],
      [r(AUTHOR, 'Sam')],
      [r(ME, 'Me'), r(AUTHOR, 'Sam')],
    ];
    for (const seen of cases) {
      const { unmount } = renderRow(makeNote(seen));
      expect(seenLine()).toBeNull();
      expect(document.body.textContent).not.toMatch(/Seen by|Not seen|No seen/i);
      unmount();
    }
  });

  it('N8b: Not-seen wording exists in no locale bundle', () => {
    for (const lng of ['en', 'es', 'de', 'fr', 'it', 'pt']) {
      const bundle = JSON.stringify(i18n.getResourceBundle(lng, 'notes')).toLowerCase();
      expect(bundle).not.toMatch(/not seen|no visto|nicht gesehen|non vu|non visto|não visto/);
    }
  });

  it('N9: the viewer and the author are never named; the rest still are', () => {
    renderRow(makeNote([r(ME, 'Viola'), r(AUTHOR, 'Sam'), r('u1', 'Maria')]));
    expect(screen.getByText('Seen by Maria')).toBeInTheDocument();
    expect(screen.queryByText(/Viola/)).toBeNull();
    // "Sam" appears only as the author's header name, never in the Seen by line.
    expect(screen.getByText('Seen by Maria').textContent).not.toMatch(/Sam|Viola/);
  });

  it('N9b: 3 entries where two are me/author count only the real reader (no "and N others")', () => {
    renderRow(makeNote([r(ME, 'Viola'), r(AUTHOR, 'Sam'), r('u1', 'Maria')]));
    expect(screen.getByText('Seen by Maria').textContent).not.toMatch(/other/);
  });
});

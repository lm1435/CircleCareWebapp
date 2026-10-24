import { useState, type ReactElement } from 'react';
import { act, render, screen, within } from '@testing-library/react';
import i18n from '@/i18n';
import { CARE_NOTE_CATEGORIES, CARE_NOTE_MOODS } from '@/api/careNotes';
import {
  NoteComposer,
  EMPTY_NOTE_DRAFT,
  NOTE_CHIP_MAX_ROWS,
  type NoteDraft,
} from '../NoteComposer';
import en from '@/i18n/en/notes.json';
import es from '@/i18n/es/notes.json';
import fr from '@/i18n/fr/notes.json';
import it_ from '@/i18n/it/notes.json';
import pt from '@/i18n/pt/notes.json';
import de from '@/i18n/de/notes.json';

// The composer's Mood and Categories chip rows wrap, at most two lines (mobile
// parity). jsdom has no layout: every chip's offsetTop is 0 unless a test
// stubs it, so the line cap is driven by stubbing offsetTop per chip and the
// assertions are on structure (data-layout + classes), never on pixel widths.

type NotesBundle = { moods: Record<string, string>; categories: Record<string, string> };
const BUNDLES: Record<string, NotesBundle> = { en, es, fr, it: it_, pt, de };
const LOCALES = Object.keys(BUNDLES);

function Harness(): ReactElement {
  const [draft, setDraft] = useState<NoteDraft>(EMPTY_NOTE_DRAFT);
  return (
    <NoteComposer
      idPrefix="note"
      draft={draft}
      onChange={setDraft}
      onSubmit={() => {}}
      submitLabel="Post"
    />
  );
}

function moodRow(): HTMLElement {
  return screen.getByRole('radiogroup');
}

function categoryRow(): HTMLElement {
  return document.getElementById('note-categories') as HTMLElement;
}

/** Stub offsetTop so the Nth chip of each row lands on the given line top. */
function stubLines(moodTops: number[], categoryTops: number[]): void {
  vi.spyOn(HTMLElement.prototype, 'offsetTop', 'get').mockImplementation(function (
    this: HTMLElement
  ) {
    const parent = this.parentElement;
    if (!parent) return 0;
    const index = Array.from(parent.children).indexOf(this);
    if (parent.getAttribute('role') === 'radiogroup') return moodTops[index] ?? 0;
    if (parent.id === 'note-categories') return categoryTops[index] ?? 0;
    return 0;
  });
}

describe('NoteComposer chip rows', () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    await act(async () => {
      await i18n.changeLanguage('en');
    });
  });

  it.each(LOCALES)('%s: both rows wrap and render every option', async (locale) => {
    await act(async () => {
      await i18n.changeLanguage(locale);
    });
    render(<Harness />);
    const bundle = BUNDLES[locale];

    for (const row of [moodRow(), categoryRow()]) {
      expect(row).toHaveAttribute('data-layout', 'wrap');
      expect(row.className.split(/\s+/)).toContain('flex-wrap');
      expect(row.className).not.toContain('overflow-x-auto');
    }
    for (const mood of CARE_NOTE_MOODS) {
      expect(within(moodRow()).getByRole('radio', { name: bundle.moods[mood] })).toBeInTheDocument();
    }
    for (const category of CARE_NOTE_CATEGORIES) {
      expect(
        within(categoryRow()).getByRole('button', { name: bundle.categories[category] })
      ).toBeInTheDocument();
    }
  });

  it('es: all four moods render, including "Día difícil" (the chip that was cut off on mobile)', async () => {
    await act(async () => {
      await i18n.changeLanguage('es');
    });
    render(<Harness />);
    const radios = within(moodRow()).getAllByRole('radio');
    expect(radios.map((r) => r.textContent)).toEqual([
      'Excelente día',
      'Buen día',
      'Regular',
      'Día difícil',
    ]);
  });

  // ── The two-line cap ──────────────────────────────────────────────────────

  it('caps both rows at two lines', () => {
    expect(NOTE_CHIP_MAX_ROWS).toBe(2);
  });

  it('stays wrapped when each row fits in two lines', () => {
    stubLines([0, 0, 52, 52], [0, 0, 0, 52]);
    render(<Harness />);
    expect(moodRow()).toHaveAttribute('data-layout', 'wrap');
    expect(categoryRow()).toHaveAttribute('data-layout', 'wrap');
  });

  it('turns a row that would need a third line into one sideways-scrolling line', () => {
    stubLines([0, 52, 104, 104], [0, 0, 52, 52]);
    render(<Harness />);
    const mood = moodRow();
    expect(mood).toHaveAttribute('data-layout', 'scroll');
    expect(mood.className).toContain('overflow-x-auto');
    expect(mood.className).toContain('flex-nowrap');
    expect(within(mood).getAllByRole('radio')).toHaveLength(CARE_NOTE_MOODS.length);
    // Each row is measured on its own.
    expect(categoryRow()).toHaveAttribute('data-layout', 'wrap');
  });

  it('caps the category row the same way', () => {
    stubLines([0, 0, 0, 0], [0, 52, 104, 156]);
    render(<Harness />);
    expect(categoryRow()).toHaveAttribute('data-layout', 'scroll');
    expect(within(categoryRow()).getAllByRole('button')).toHaveLength(CARE_NOTE_CATEGORIES.length);
    expect(moodRow()).toHaveAttribute('data-layout', 'wrap');
  });
});

// "Added by voice" — the one line that tells the care circle an entry was
// dictated on the phone. Real i18n resources: the copy IS the feature, and it
// must be the same sentence mobile shows, in every app language.
import { render, screen } from '@testing-library/react';
import { afterAll, describe, expect, it } from 'vitest';
import i18n from '@/i18n';
import { EntrySourceNote } from '../EntrySourceNote';

afterAll(async () => {
  await i18n.changeLanguage('en');
});

describe('EntrySourceNote', () => {
  it('says "Added by voice" for an entry saved by voice', () => {
    render(<EntrySourceNote event={{ entry_source: 'voice' }} />);
    const note = screen.getByTestId('entry-source-note');
    expect(note).toHaveTextContent(/^Added by voice$/);
  });

  it.each([['form'], ['scan'], [null], [undefined]] as const)(
    'renders NOTHING for %s: no line, no empty gap',
    (value) => {
      const { container } = render(<EntrySourceNote event={{ entry_source: value }} />);
      expect(container).toBeEmptyDOMElement();
    },
  );

  it('renders nothing while there is no event', () => {
    const { container } = render(<EntrySourceNote event={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('is plain muted text: no icon, no emoji, not hidden from a screen reader, never an error colour', () => {
    render(<EntrySourceNote event={{ entry_source: 'voice' }} />);
    const note = screen.getByTestId('entry-source-note');
    expect(note.tagName).toBe('P');
    expect(note.children).toHaveLength(0);
    expect(note).not.toHaveAttribute('aria-hidden');
    expect(note.className).toContain('text-ink-3');
    expect(note.className).not.toMatch(/terracotta|danger|clay/);
    expect(note.textContent ?? '').not.toMatch(/\p{Extended_Pictographic}/u);
  });

  it.each([
    ['en', 'Added by voice'],
    ['es', 'Se agregó por voz'],
    ['fr', 'Ajout à la voix'],
    ['de', 'Per Sprache hinzugefügt'],
    ['it', 'Aggiunta a voce'],
    ['pt', 'Adição por voz'],
  ])('%s: "%s" (same wording as mobile)', async (lang, copy) => {
    await i18n.changeLanguage(lang);
    render(<EntrySourceNote event={{ entry_source: 'voice' }} />);
    expect(screen.getByTestId('entry-source-note')).toHaveTextContent(copy);
  });
});

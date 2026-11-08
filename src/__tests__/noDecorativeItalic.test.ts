import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Unslop audit 2026-11-07 #3: muted placeholder/state text ("Unassigned", "No due date", "edited") keeps its
// muted colour and loses the decorative italic. A source scan, because these strings sit in rows that
// need heavy fixtures to render; the class on the element is the whole contract.
const FILES = [
  'components/tasks/TaskRow.tsx',
  'components/activity/ActivityItem.tsx',
  'components/notes/NoteRow.tsx',
];

describe('no decorative italic on muted state text', () => {
  for (const file of FILES) {
    it(`${file} has no italic class`, () => {
      const src = readFileSync(resolve(__dirname, '..', file), 'utf8');
      expect(src.match(/className=[^\n]*\bitalic\b/g) ?? []).toEqual([]);
    });
  }
});

import { deriveTitleSuggestions } from '../titleSuggestions';

// nowMs is ALWAYS passed explicitly — the util never calls Date.now(), so
// these fixtures are stable forever. NOW = 2026-07-01 UTC midnight.
const NOW = Date.UTC(2026, 6, 1);

const GENERICS = ['Doctor visit', 'Lab work', 'Follow-up', 'Dentist', 'Eye exam'];

interface Ev {
  title: string;
  event_type: string;
  scheduled_date: string;
}

function ev(title: string, scheduled_date: string, event_type = 'appointment'): Ev {
  return { title, event_type, scheduled_date };
}

describe('deriveTitleSuggestions', () => {
  it('includes a title used >= 2 times even when both uses are old', () => {
    const events = [ev('Cardiology checkup', '2025-01-10'), ev('Cardiology checkup', '2025-02-10')];
    const result = deriveTitleSuggestions(events, 'appointment', NOW, []);
    expect(result).toEqual(['Cardiology checkup']);
  });

  it('excludes single-use titles however recent, stale, or upcoming', () => {
    // Recency used to admit one-offs, which turned the strip into a recent-items
    // list. Because the source is circle-wide, one member's one-off private
    // shorthand became a chip every other member saw.
    const events = [
      ev('Recent one-off', '2026-06-20'), // 11 days before NOW
      ev('Stale one-off', '2026-03-01'), // > 60 days before NOW
      ev('Upcoming visit', '2026-07-15'), // scheduled ahead of NOW
    ];
    expect(deriveTitleSuggestions(events, 'appointment', NOW, [])).toEqual([]);
  });

  it('offers a title as soon as it has been used a second time', () => {
    const once = [ev('Change bandage', '2026-06-20', 'task')];
    expect(deriveTitleSuggestions(once, 'task', NOW, [])).toEqual([]);

    const twice = [...once, ev('Change bandage', '2026-06-27', 'task')];
    expect(deriveTitleSuggestions(twice, 'task', NOW, [])).toEqual(['Change bandage']);
  });

  it('falls back to generics when every past title was used once', () => {
    const events = [ev('One', '2026-06-20'), ev('Two', '2026-06-21')];
    expect(deriveTitleSuggestions(events, 'appointment', NOW, GENERICS)).toEqual(GENERICS);
  });

  it('ranks by frequency desc, then recency desc', () => {
    const events = [
      ev('Twice old', '2026-01-01'),
      ev('Twice old', '2026-01-02'),
      ev('Thrice', '2025-01-01'),
      ev('Thrice', '2025-01-02'),
      ev('Thrice', '2025-01-03'),
      ev('Twice newer', '2026-02-01'),
      ev('Twice newer', '2026-02-02'),
    ];
    const result = deriveTitleSuggestions(events, 'appointment', NOW, []);
    expect(result).toEqual(['Thrice', 'Twice newer', 'Twice old']);
  });

  it('dedupes case-insensitively and keeps the casing of the most recent use', () => {
    const events = [ev('cardiology Follow-Up', '2026-06-01'), ev('Cardiology follow-up', '2026-06-15')];
    const result = deriveTitleSuggestions(events, 'appointment', NOW, []);
    expect(result).toEqual(['Cardiology follow-up']);
  });

  it('pads with generics to 6, skipping generics that duplicate history case-insensitively', () => {
    const events = [ev('doctor visit', '2026-06-25'), ev('doctor visit', '2026-06-26')];
    const result = deriveTitleSuggestions(events, 'appointment', NOW, GENERICS);
    // History entry first (original casing), then generics minus the duplicate.
    expect(result).toEqual(['doctor visit', 'Lab work', 'Follow-up', 'Dentist', 'Eye exam']);
  });

  it('caps the result at 6 entries', () => {
    // Each title used twice so all qualify under the repetition rule.
    const events = ['A', 'B', 'C', 'D', 'E', 'F', 'G'].flatMap((title, i) => [
      ev(title, `2026-06-0${i + 1}`),
      ev(title, `2026-06-1${i + 1}`),
    ]);
    const result = deriveTitleSuggestions(events, 'appointment', NOW, GENERICS);
    expect(result).toHaveLength(6);
    expect(result).toEqual(['G', 'F', 'E', 'D', 'C', 'B']); // recency desc, no generics fit
  });

  it('stays at 6 for a heavily-used circle', () => {
    const events = Array.from({ length: 200 }, (_, i) => [
      ev(`Task ${i}`, '2026-06-01', 'task'),
      ev(`Task ${i}`, '2026-06-02', 'task'),
    ]).flat();
    expect(deriveTitleSuggestions(events, 'task', NOW, GENERICS)).toHaveLength(6);
  });

  it('only considers events of the requested type and ignores empty titles', () => {
    const events = [
      ev('Grocery run', '2026-06-20', 'task'),
      ev('Grocery run', '2026-06-21', 'task'),
      ev('   ', '2026-06-21', 'task'),
      ev('   ', '2026-06-22', 'task'),
      ev('Cardiology', '2026-06-22', 'appointment'),
      ev('Cardiology', '2026-06-23', 'appointment'),
    ];
    const result = deriveTitleSuggestions(events, 'task', NOW, []);
    expect(result).toEqual(['Grocery run']);
  });

  it('returns only generics when there is no history', () => {
    expect(deriveTitleSuggestions([], 'appointment', NOW, GENERICS)).toEqual(GENERICS);
  });
});

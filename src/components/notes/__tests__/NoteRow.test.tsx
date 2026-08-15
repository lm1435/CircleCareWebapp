import { render, screen } from '@testing-library/react';
import '@/i18n';
import { NoteRow } from '../NoteRow';
import type { CareNote } from '@/api/careNotes';

// WA2 — the entry timestamp must route through the VIEWER's resolved
// 12h/24h clock (resolveHourCycle), not the runtime's default locale. Pin
// useHourCycle so the test is deterministic instead of following
// navigator.language (same pattern as MedicationsPage.test.tsx / TodaysMeds).

const mockUseHourCycle = vi.fn();
vi.mock('@/hooks/useHourCycle', () => ({
  useHourCycle: () => mockUseHourCycle(),
}));

function makeNote(overrides: Partial<CareNote> = {}): CareNote {
  return {
    id: 'note-1',
    circle_id: 'circle-1',
    author_id: 'user-1',
    note_date: '2026-08-10',
    body: 'Ate a good breakfast.',
    mood: null,
    categories: [],
    created_at: '2026-08-10T20:30:00.000Z', // 4:30 PM ET / 20:30 UTC
    updated_at: '2026-08-10T20:30:00.000Z',
    author: { id: 'user-1', first_name: 'Sam', last_name: 'Rivera' },
    ...overrides,
  };
}

const noop = () => {};

function renderRow(note: CareNote, timezone = 'America/New_York') {
  return render(
    <NoteRow
      note={note}
      timezone={timezone}
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

describe('NoteRow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the entry time in 12h format when the viewer is on a 12h clock', () => {
    mockUseHourCycle.mockReturnValue('12h');
    renderRow(makeNote());

    // 20:30 UTC in America/New_York (EDT, UTC-4) is 16:30 → "4:30 PM".
    expect(screen.getByText(/4:30 PM/)).toBeInTheDocument();
    expect(screen.queryByText(/16:30/)).not.toBeInTheDocument();
  });

  it('renders the entry time in 24h format when the viewer is on a 24h clock (WA2 regression)', () => {
    // Before the fix, formatNoteTime used Intl.DateTimeFormat(undefined, ...)
    // which follows the runtime's default locale/hour-cycle and ignores
    // resolveHourCycle entirely — a 24h-clock viewer still saw AM/PM here.
    mockUseHourCycle.mockReturnValue('24h');
    renderRow(makeNote());

    expect(screen.getByText(/16:30/)).toBeInTheDocument();
    expect(screen.queryByText(/4:30 PM/)).not.toBeInTheDocument();
    expect(screen.queryByText(/PM/)).not.toBeInTheDocument();
  });

  it('renders the time in the CARE RECIPIENT timezone, not device-local', () => {
    mockUseHourCycle.mockReturnValue('24h');
    // 20:30 UTC in Europe/Madrid (CEST, UTC+2) is 22:30.
    renderRow(makeNote(), 'Europe/Madrid');

    expect(screen.getByText(/22:30/)).toBeInTheDocument();
  });

  it('renders the author name and note body', () => {
    mockUseHourCycle.mockReturnValue('12h');
    renderRow(makeNote());

    expect(screen.getByText('Sam Rivera')).toBeInTheDocument();
    expect(screen.getByText('Ate a good breakfast.')).toBeInTheDocument();
  });
});

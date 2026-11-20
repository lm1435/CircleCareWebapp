import { act, render } from '@testing-library/react';
import {
  SEEN_DEBOUNCE_MS,
  SEEN_DWELL_MS,
  resetMarkCareNotesSeenSession,
  useMarkCareNotesSeen,
} from '../useMarkCareNotesSeen';
import type { CareNote } from '@/api/careNotes';

// "Seen by" marking. jsdom has no layout, so a mocked IntersectionObserver is driven by hand and
// timers are fake; real geometry is covered by e2e/flows/care-notes-seen-by.spec.ts.

const mockMark = vi.fn();
vi.mock('@/api/careNotes', async () => {
  const actual = await vi.importActual<typeof import('@/api/careNotes')>('@/api/careNotes');
  return { ...actual, markCareNotesSeen: (...a: unknown[]) => mockMark(...a) };
});

const mockSeenRecorded = vi.fn();
const mockErrorOccurred = vi.fn();
vi.mock('@/lib/analytics', () => ({
  Analytics: {
    careNotesSeenRecorded: (...a: unknown[]) => mockSeenRecorded(...a),
    errorOccurred: (...a: unknown[]) => mockErrorOccurred(...a),
  },
}));

// ── Mock IntersectionObserver ────────────────────────────────────────────────
type IOCallback = (entries: Array<Partial<IntersectionObserverEntry>>) => void;
class MockIO {
  static instances: MockIO[] = [];
  elements = new Set<Element>();
  constructor(
    public cb: IOCallback,
    public options?: IntersectionObserverInit
  ) {
    MockIO.instances.push(this);
  }
  observe(el: Element) {
    this.elements.add(el);
  }
  unobserve(el: Element) {
    this.elements.delete(el);
  }
  disconnect() {
    this.elements.clear();
  }
}

function report(id: string, ratio: number) {
  const io = MockIO.instances[MockIO.instances.length - 1];
  const el = document.querySelector(`[data-care-note-id="${id}"]`)!;
  act(() => {
    io.cb([{ target: el, isIntersecting: ratio > 0, intersectionRatio: ratio }]);
  });
}

/** A tall row: ratio of its own area is small, but it covers `coverage` of a 500 px root. */
function reportTall(id: string, ratio: number, coverage: number) {
  const io = MockIO.instances[MockIO.instances.length - 1];
  const el = document.querySelector(`[data-care-note-id="${id}"]`)!;
  act(() => {
    io.cb([
      {
        target: el,
        isIntersecting: coverage > 0 || ratio > 0,
        intersectionRatio: ratio,
        intersectionRect: { height: 500 * coverage } as DOMRectReadOnly,
        rootBounds: { height: 500 } as DOMRectReadOnly,
      },
    ]);
  });
}

let visibility: 'visible' | 'hidden' = 'visible';
function setVisibility(v: 'visible' | 'hidden') {
  visibility = v;
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
}

// ── Fixtures ─────────────────────────────────────────────────────────────────
const CIRCLE = 'circle-1';
const ME = 'me-user';
const AUTHOR = 'author-user';
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const T0 = '2026-03-15T14:00:00.000Z';

function note(n: number, o: Partial<CareNote> = {}): CareNote {
  return {
    id: uuid(n),
    circle_id: CIRCLE,
    author_id: AUTHOR,
    note_date: '2026-03-15',
    body: `note ${n}`,
    mood: null,
    categories: [],
    created_at: T0,
    updated_at: T0,
    author: { id: AUTHOR, first_name: 'Ana', last_name: 'L' },
    ...o,
  };
}

function Harness(props: { notes: CareNote[]; enabled?: boolean; circleId?: string; viewerId?: string }) {
  useMarkCareNotesSeen({
    circleId: props.circleId ?? CIRCLE,
    notes: props.notes,
    viewerId: 'viewerId' in props ? props.viewerId : ME,
    enabled: props.enabled ?? true,
  });
  return (
    <ul>
      {props.notes.map((n) => (
        <li key={n.id} data-care-note-id={n.id}>
          {n.body}
        </li>
      ))}
    </ul>
  );
}

const elapse = async (ms: number) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};
/** Dwell then debounce: everything a seen note needs to reach the network. */
const settle = () => elapse(SEEN_DWELL_MS + SEEN_DEBOUNCE_MS + 10);

beforeEach(() => {
  vi.useFakeTimers();
  MockIO.instances = [];
  vi.stubGlobal('IntersectionObserver', MockIO);
  visibility = 'visible';
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
  mockMark.mockReset();
  mockMark.mockImplementation(async (_c: string, notes: unknown[]) => ({ marked: notes.length }));
  mockSeenRecorded.mockReset();
  mockErrorOccurred.mockReset();
  resetMarkCareNotesSeenSession();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('useMarkCareNotesSeen: positive', () => {
  it('P1: a note by another author visible for 1 s is sent once with {note_id, updated_at}', async () => {
    render(<Harness notes={[note(1)]} />);
    expect(MockIO.instances[0].options?.threshold).toContain(0.5);
    report(uuid(1), 0.9);
    await settle();
    expect(mockMark).toHaveBeenCalledTimes(1);
    expect(mockMark).toHaveBeenCalledWith(CIRCLE, [{ note_id: uuid(1), updated_at: T0 }]);
    await elapse(10_000);
    expect(mockMark).toHaveBeenCalledTimes(1);
    // One shared observer for every row.
    expect(MockIO.instances).toHaveLength(1);
  });

  it('P2a: several newly seen notes are batched into ONE request', async () => {
    render(<Harness notes={[note(1), note(2), note(3)]} />);
    report(uuid(1), 1);
    report(uuid(2), 1);
    report(uuid(3), 1);
    await settle();
    expect(mockMark).toHaveBeenCalledTimes(1);
    expect(mockMark.mock.calls[0][1]).toHaveLength(3);
  });

  it('P2b: 150 notes are split into requests of at most 100', async () => {
    const notes = Array.from({ length: 150 }, (_, i) => note(i + 1));
    render(<Harness notes={notes} />);
    notes.forEach((n) => report(n.id, 1));
    await settle();
    const sizes = mockMark.mock.calls.map((c) => (c[1] as unknown[]).length);
    expect(sizes).toEqual([100, 50]);
  });

  it('P4: the analytics event fires with the marked count after a successful POST', async () => {
    mockMark.mockResolvedValue({ marked: 2 });
    render(<Harness notes={[note(1), note(2)]} />);
    report(uuid(1), 1);
    report(uuid(2), 1);
    await settle();
    expect(mockSeenRecorded).toHaveBeenCalledTimes(1);
    expect(mockSeenRecorded).toHaveBeenCalledWith({ count: 2 });
  });
});

describe('useMarkCareNotesSeen: negative', () => {
  it('N1: my own note is never sent', async () => {
    render(<Harness notes={[note(1, { author_id: ME })]} />);
    report(uuid(1), 1);
    await settle();
    expect(mockMark).not.toHaveBeenCalled();
  });

  it('N2: a note I am already in seen_by for is not sent', async () => {
    render(
      <Harness notes={[note(1, { seen_by: [{ user_id: ME, first_name: 'Me' }] })]} />
    );
    report(uuid(1), 1);
    await settle();
    expect(mockMark).not.toHaveBeenCalled();
  });

  it('N3: an optimistic / temporary id is not sent', async () => {
    render(<Harness notes={[note(1, { id: `optimistic-${T0}` })]} />);
    report(`optimistic-${T0}`, 1);
    await settle();
    expect(mockMark).not.toHaveBeenCalled();
  });

  it('N3b: placeholder rows (enabled=false) and rows of another circle are not sent', async () => {
    const { rerender } = render(<Harness notes={[note(1)]} enabled={false} />);
    await settle();
    expect(MockIO.instances.length === 0 || MockIO.instances[0].elements.size === 0).toBe(true);
    rerender(<Harness notes={[note(1, { circle_id: 'other-circle' })]} />);
    report(uuid(1), 1);
    await settle();
    expect(mockMark).not.toHaveBeenCalled();
  });

  it('N4: nothing is sent while the document is hidden, then it is once visible', async () => {
    setVisibility('hidden');
    render(<Harness notes={[note(1)]} />);
    report(uuid(1), 1);
    await settle();
    expect(mockMark).not.toHaveBeenCalled();
    setVisibility('visible');
    await settle();
    expect(mockMark).toHaveBeenCalledTimes(1);
  });

  it('N4b: a tab hidden during the dwell cancels it', async () => {
    render(<Harness notes={[note(1)]} />);
    report(uuid(1), 1);
    await elapse(SEEN_DWELL_MS - 200);
    setVisibility('hidden');
    await settle();
    expect(mockMark).not.toHaveBeenCalled();
  });

  it('N5: the same (id, updated_at) is not sent twice, but IS after updated_at changes', async () => {
    const { rerender } = render(<Harness notes={[note(1)]} />);
    report(uuid(1), 1);
    await settle();
    expect(mockMark).toHaveBeenCalledTimes(1);
    // Leaves and re-enters the view with the same version: no resend.
    report(uuid(1), 0);
    report(uuid(1), 1);
    await settle();
    expect(mockMark).toHaveBeenCalledTimes(1);
    // The note is edited (new updated_at) while on screen: counts again.
    const edited = '2026-03-15T15:00:00.000Z';
    rerender(<Harness notes={[note(1, { updated_at: edited })]} />);
    await settle();
    expect(mockMark).toHaveBeenCalledTimes(2);
    expect(mockMark.mock.calls[1][1]).toEqual([{ note_id: uuid(1), updated_at: edited }]);
  });

  it('N6: a failed POST is silent (no error analytics, no success event) and retried on a later view', async () => {
    mockMark.mockRejectedValueOnce({ error: { code: 'INTERNAL_ERROR' } });
    render(<Harness notes={[note(1)]} />);
    report(uuid(1), 1);
    await settle();
    expect(mockMark).toHaveBeenCalledTimes(1);
    expect(mockErrorOccurred).not.toHaveBeenCalled();
    expect(mockSeenRecorded).not.toHaveBeenCalled();
    // Not retried by a timer.
    await elapse(20_000);
    expect(mockMark).toHaveBeenCalledTimes(1);
    // A later view sends the pair again.
    report(uuid(1), 0);
    report(uuid(1), 1);
    await settle();
    expect(mockMark).toHaveBeenCalledTimes(2);
    expect(mockSeenRecorded).toHaveBeenCalledWith({ count: 1 });
  });

  it('N7: after a 404 (old backend) no further POST is made', async () => {
    mockMark.mockRejectedValue({ error: { code: 'NOT_FOUND', message: 'Route not found' } });
    render(<Harness notes={[note(1), note(2)]} />);
    report(uuid(1), 1);
    await settle();
    expect(mockMark).toHaveBeenCalledTimes(1);
    report(uuid(2), 1);
    await settle();
    report(uuid(1), 0);
    report(uuid(1), 1);
    await settle();
    expect(mockMark).toHaveBeenCalledTimes(1);
    expect(mockErrorOccurred).not.toHaveBeenCalled();
  });

  it('N12a: a row that leaves view before 1 s is not sent', async () => {
    render(<Harness notes={[note(1)]} />);
    report(uuid(1), 1);
    await elapse(SEEN_DWELL_MS - 100);
    report(uuid(1), 0);
    await settle();
    expect(mockMark).not.toHaveBeenCalled();
  });

  it('N12b: a row under 50% visible is not sent', async () => {
    render(<Harness notes={[note(1)]} />);
    report(uuid(1), 0.49);
    await settle();
    expect(mockMark).not.toHaveBeenCalled();
  });

  it('N11: a success event with marked = 0 sends nothing', async () => {
    mockMark.mockResolvedValue({ marked: 0 });
    render(<Harness notes={[note(1)]} />);
    report(uuid(1), 1);
    await settle();
    expect(mockMark).toHaveBeenCalledTimes(1);
    expect(mockSeenRecorded).not.toHaveBeenCalled();
  });

  it('no viewer id (signed out) sends nothing', async () => {
    render(<Harness notes={[note(1)]} viewerId={undefined} />);
    report(uuid(1), 1);
    await settle();
    expect(mockMark).not.toHaveBeenCalled();
  });
});

describe('useMarkCareNotesSeen: tall rows (60% of the viewport rule)', () => {
  it('P-tall-1: ratio 0.3 but 70% of the viewport covered for 1 s is sent once', async () => {
    render(<Harness notes={[note(1)]} />);
    reportTall(uuid(1), 0.3, 0.7);
    await settle();
    expect(mockMark).toHaveBeenCalledTimes(1);
    expect(mockMark).toHaveBeenCalledWith(CIRCLE, [{ note_id: uuid(1), updated_at: T0 }]);
    await elapse(10_000);
    expect(mockMark).toHaveBeenCalledTimes(1);
  });

  it('P-tall-2: a row satisfying both conditions is sent once', async () => {
    render(<Harness notes={[note(1)]} />);
    reportTall(uuid(1), 0.9, 0.9);
    await settle();
    expect(mockMark).toHaveBeenCalledTimes(1);
  });

  it('N-tall-1: ratio 0.3 and 40% viewport coverage is never sent', async () => {
    render(<Harness notes={[note(1)]} />);
    reportTall(uuid(1), 0.3, 0.4);
    await settle();
    expect(mockMark).not.toHaveBeenCalled();
  });

  it('N-tall-2: dropping below both conditions before 1 s is not sent', async () => {
    render(<Harness notes={[note(1)]} />);
    reportTall(uuid(1), 0.3, 0.7);
    await elapse(SEEN_DWELL_MS - 200);
    reportTall(uuid(1), 0.3, 0.4);
    await settle();
    expect(mockMark).not.toHaveBeenCalled();
  });

  it('N-tall-3: one condition ending while the other holds does not cancel the dwell', async () => {
    render(<Harness notes={[note(1)]} />);
    reportTall(uuid(1), 0.3, 0.7);
    await elapse(SEEN_DWELL_MS - 400);
    // Coverage falls to 40% but the row is now 60% visible: the other condition holds.
    reportTall(uuid(1), 0.6, 0.4);
    await settle();
    expect(mockMark).toHaveBeenCalledTimes(1);
    await elapse(10_000);
    expect(mockMark).toHaveBeenCalledTimes(1);
  });

  it('N-tall-4: a hidden document sends nothing on a coverage hit', async () => {
    setVisibility('hidden');
    render(<Harness notes={[note(1)]} />);
    reportTall(uuid(1), 0.3, 0.7);
    await settle();
    expect(mockMark).not.toHaveBeenCalled();
  });

  it('N-tall-5: my own tall note is never sent', async () => {
    render(<Harness notes={[note(1, { author_id: ME })]} />);
    reportTall(uuid(1), 0.3, 0.9);
    await settle();
    expect(mockMark).not.toHaveBeenCalled();
  });
});

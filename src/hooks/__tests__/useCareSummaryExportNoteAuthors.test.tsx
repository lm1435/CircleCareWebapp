import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

// Care-summary PDF note AUTHORS, web vs mobile (Fix 4b). Mobile's
// EmergencyInfoScreen maps both note sources with `authorFirstName:
// n.author?.first_name ?? null`, and the shared template prints that first
// name ONLY (a `.sub` line under the date; "(Sam)" in the text fallback). These
// pin that the web export hook maps the same field, end to end through the
// real hook and the real mirrored template: first name printed, last name
// never, no author line when there is no first name.

vi.mock('@/api/calendarEvents', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/calendarEvents')>();
  return { ...actual, getEvents: vi.fn() };
});
vi.mock('@/api/circleMembers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/circleMembers')>();
  return { ...actual, getCircleDetail: vi.fn() };
});
vi.mock('@/api/emergencyInfo', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/emergencyInfo')>();
  return { ...actual, getEmergencyInfo: vi.fn() };
});
vi.mock('@/api/eventNotes', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/eventNotes')>();
  return { ...actual, getEventNotesInRange: vi.fn() };
});
vi.mock('@/api/careNotes', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/careNotes')>();
  return { ...actual, getCareNotes: vi.fn() };
});
vi.mock('@/pdf/printHtml', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/pdf/printHtml')>();
  return { ...actual, printHtml: vi.fn() };
});

import '@/i18n';

vi.mock('@/components/ui', () => ({
  useToast: () => ({ showToast: vi.fn() }),
}));
vi.mock('@/lib/analytics', () => ({
  Analytics: { careSummaryShared: vi.fn(), careSummaryExportFailed: vi.fn() },
}));

import { getEvents } from '@/api/calendarEvents';
import { getCircleDetail, type CircleDetail } from '@/api/circleMembers';
import { getEmergencyInfo } from '@/api/emergencyInfo';
import { getEventNotesInRange, type EventNoteRangeItem } from '@/api/eventNotes';
import { getCareNotes, type CareNote } from '@/api/careNotes';
import { printHtml } from '@/pdf/printHtml';
import { useAuthStore } from '@/store/authStore';
import { getDateInTimezone } from '@/utils/timezone';
import { useCareSummaryExport } from '@/hooks/useCareSummaryExport';

const CIRCLE_ID = 'circle-1';
const TZ = 'America/New_York';

const circle: CircleDetail = {
  id: CIRCLE_ID,
  name: "Rose's Care Team",
  recipient_name: 'Rose Marie Whitfield',
  recipient_photo_url: null,
  recipient_dob: '1948-03-12',
  recipient_conditions: [],
  owner_id: 'owner-1',
  created_at: '2026-01-01T00:00:00.000Z',
  is_self_care: false,
  care_recipient_timezone: TZ,
  members: [],
  access_level: 'view',
  is_premium_circle: false,
  can_edit: false,
  view_only: true,
};

function visitNote(id: string, author: EventNoteRangeItem['author']): EventNoteRangeItem {
  return {
    id,
    body: `Visit body ${id}`,
    created_at: '2026-01-01T00:00:00.000Z',
    author,
    event: { id: `ev-${id}`, title: `Visit ${id}`, scheduled_date: '2026-01-01', event_type: 'appointment' },
  };
}

function careNote(id: string, author: CareNote['author']): CareNote {
  return {
    id,
    circle_id: CIRCLE_ID,
    author_id: 'u1',
    note_date: '2026-01-02',
    body: `Care body ${id}`,
    mood: null,
    categories: [],
    created_at: '2026-01-02T00:00:00.000Z',
    updated_at: '2026-01-02T00:00:00.000Z',
    author,
  };
}

async function exportHtml(): Promise<string> {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const { result } = renderHook(() => useCareSummaryExport({ circleId: CIRCLE_ID }), { wrapper });
  await act(async () => {
    await result.current.exportPdf({ includeVisitNotes: true, includeCareNotes: true });
  });
  const call = vi.mocked(printHtml).mock.calls[0];
  if (!call) throw new Error('printHtml was not called');
  return call[0].html;
}

/** The `<tr>` of the row whose body cell carries `body`. */
function rowFor(html: string, body: string): string {
  const at = html.indexOf(body);
  if (at < 0) throw new Error(`row with "${body}" not printed`);
  return html.slice(html.lastIndexOf('<tr', at), html.indexOf('</tr>', at));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getCircleDetail).mockResolvedValue(circle);
  vi.mocked(getEmergencyInfo).mockResolvedValue(null as never);
  vi.mocked(getEvents).mockResolvedValue([]);
  vi.mocked(printHtml).mockResolvedValue(undefined);
  useAuthStore.setState({ user: null });
});

describe('care summary PDF: note authors match mobile (first name only)', () => {
  it('visit note: prints the author first name under the date, never the last name', async () => {
    vi.mocked(getEventNotesInRange).mockResolvedValue([visitNote('a', { first_name: 'Sam', last_name: 'Rivera' })]);
    vi.mocked(getCareNotes).mockResolvedValue({ notes: [], today: getDateInTimezone(TZ), timezone: TZ });
    const row = rowFor(await exportHtml(), 'Visit body a');
    expect(row).toContain('<span class="sub">Sam</span>');
    expect(row).not.toContain('Rivera');
  });

  it('daily care note: same first-name author line', async () => {
    vi.mocked(getEventNotesInRange).mockResolvedValue([]);
    vi.mocked(getCareNotes).mockResolvedValue({
      notes: [careNote('b', { id: 'u1', first_name: 'Lena', last_name: 'Ortiz' })],
      today: getDateInTimezone(TZ),
      timezone: TZ,
    });
    const row = rowFor(await exportHtml(), 'Care body b');
    expect(row).toContain('<span class="sub">Lena</span>');
    expect(row).not.toContain('Ortiz');
  });

  it('no first name (departed author with no name on file / anonymized): no author line, the row still prints', async () => {
    vi.mocked(getEventNotesInRange).mockResolvedValue([visitNote('c', { first_name: null, last_name: null })]);
    vi.mocked(getCareNotes).mockResolvedValue({
      notes: [careNote('d', null)],
      today: getDateInTimezone(TZ),
      timezone: TZ,
    });
    const html = await exportHtml();
    expect(rowFor(html, 'Visit body c')).not.toContain('class="sub"');
    expect(rowFor(html, 'Care body d')).not.toContain('class="sub"');
  });
});

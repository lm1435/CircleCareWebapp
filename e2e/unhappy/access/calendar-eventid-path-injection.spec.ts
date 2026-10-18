import { test, expect, uniqueLabel } from '../../fixtures';
import { apiSession } from '../../unhappy';
import { apiCreateEvent, dateInZone, purgeEventsTitled, recipientTimezone } from '../writes/_helpers';

// A `?eventId=` LINK CANNOT REWRITE THE API PATH (web security audit 2026-10-17).
//
// CalendarPage reads `?eventId=` (the daily-update "open this task" link) and
// fetches GET /circles/:id/events/:eventId with the user's Bearer token. The
// value arrives already DECODED by URLSearchParams, so a link carrying
// `<id>%2Fnotes%3Fx%3D1` used to send the request to `/events/<id>/notes?x=1`:
// a path and query the link's author chose. The id is now encoded at the API
// boundary, so the request stays one segment, the backend 404s, and the user
// gets the ordinary "This item is no longer available." toast.

test.use({ persona: 'premiumOwner' });

test('a crafted ?eventId= stays one encoded path segment and reads as unavailable', async ({
  page,
  request,
  account,
  circleId,
}) => {
  const title = uniqueLabel('Path link');
  const api = await apiSession(request, account);
  const tz = await recipientTimezone(api, circleId);
  const appt = await apiCreateEvent(api, circleId, {
    event_type: 'appointment',
    title,
    scheduled_date: dateInZone(tz, 3),
    scheduled_time: '10:00',
  });
  const eventPaths: string[] = [];
  page.on('request', (req) => {
    const url = new URL(req.url());
    if (url.pathname.includes(`/api/circles/${circleId}/events/${appt.id}`)) {
      eventPaths.push(url.pathname + url.search);
    }
  });
  try {
    await page.goto(
      `/circles/${circleId}/calendar?eventId=${appt.id}%2Fnotes%3Fx%3D1`,
      { waitUntil: 'domcontentloaded' }
    );
    await expect(
      page.getByText('This item is no longer available. Someone may have deleted it.')
    ).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('dialog')).toHaveCount(0);

    // The one event read the link caused kept the payload inside its segment.
    expect(eventPaths).toContain(`/api/circles/${circleId}/events/${appt.id}%2Fnotes%3Fx%3D1`);
    expect(eventPaths.some((p) => p.startsWith(`/api/circles/${circleId}/events/${appt.id}/notes`))).toBe(false);
  } finally {
    purgeEventsTitled(circleId, title);
  }
});

import { test, expect, uniqueLabel, type PersonaHandle } from '../../fixtures';
import { sqlExec } from '../../db';
import { adminUpload } from '../../isolation';
import { dbQuery, sqlStr } from '../../unhappy';
import {
  MINIMAL_PDF,
  WRITE_RESOURCES,
  circleNameOf,
  circleTodaySql,
  openAllCircles,
  runWriteProbes,
  sidebarNew,
  spaNavigate,
  type WriteOutcome,
} from './_helpers';

// ===========================================================================
// ARCHIVED CIRCLE — a premium owner whose `circleId` was archived exactly as
// DELETE /api/circles/:id leaves it, plus one live circle.
//
//   list      the archived circle is not offered; the live one is.
//   direct    /circles/<archivedId> must not offer write actions: GET
//             /api/circles/:id answers the archived circle read-only
//             (200, can_edit:false).
//   server    writes to the archived circle are refused with the SAME answer
//             invites give — 400 CIRCLE_ARCHIVED (body
//             backend/src/utils/circleArchived.ts, returned by
//             requireCircleEditAccess, documents resolveEditAccess and the
//             invites route). One test per resource, so a regression in one
//             resource fails exactly that test.
//
// These were `test.fail()` known bugs until the backend gate landed
// (services/circleAccess.ts `archived`). Only the exact code counts as
// refused: a 400 VALIDATION_ERROR or a 404 is not an archived-circle gate.
// ===========================================================================

test.use({ persona: 'archivedCircleOwner' });

const ARCHIVED: WriteOutcome = { status: 400, code: 'CIRCLE_ARCHIVED' };

test('circle list: the archived circle is absent and the live circle is present', async ({
  page,
  personaHandle: h,
}) => {
  const archivedName = circleNameOf(h.circleId);
  const liveId = h.liveCircleIds[0];
  const liveName = circleNameOf(liveId);
  expect(archivedName, 'the two circles are distinguishable by name').not.toBe(liveName);

  // A single live circle: /circles auto-enters it (never the archived one).
  await page.goto('/circles');
  await expect(page).toHaveURL(new RegExp(`/circles/${liveId}(/|$)`), { timeout: 20_000 });

  await openAllCircles(page);
  await expect(page.getByRole('link', { name: new RegExp(`^Open ${liveName}`) })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('link', { name: /^Open / })).toHaveCount(1);
  await expect(page.getByRole('link', { name: new RegExp(`^Open ${archivedName}`) })).toHaveCount(0);
});

/**
 * A member the archived circle has and NO live circle of this persona has, as
 * MembersPage renders it (`memberName`: full name, else e-mail). The owner's
 * e-mail is on every roster, so it cannot tell the archived circle's page from
 * the live one's.
 */
function memberOnlyInArchivedCircle(h: PersonaHandle): string {
  const [row] = dbQuery<{ label: string }>(`
    select coalesce(nullif(concat_ws(' ', nullif(u.first_name, ''), nullif(u.last_name, '')), ''), u.email) as label
      from circle_memberships m join users u on u.id = m.user_id
     where m.circle_id = ${sqlStr(h.circleId)}::uuid
       and m.user_id not in (select user_id from circle_memberships
                              where circle_id = any(array[${h.liveCircleIds.map((id) => `${sqlStr(id)}::uuid`).join(', ')}]::uuid[]))
     order by 1 limit 1`);
  if (!row) throw new Error(`archived circle ${h.circleId} has no member the live circle lacks`);
  return row.label;
}

test(
  'direct navigation to /circles/<archivedId> offers no write actions',
  async ({ page, personaHandle: h }) => {
    const notOffered = /couldn.t find|not found|archived|deleted|went wrong/i;
    const onlyHere = memberOnlyInArchivedCircle(h);
    const archivedUrl = new RegExp(`/circles/${h.circleId}/members$`);
    const detail = page.waitForResponse(
      (r) => r.request().method() === 'GET' && new URL(r.url()).pathname === `/api/circles/${h.circleId}`,
      { timeout: 20_000 }
    );
    await page.goto(`/circles/${h.circleId}/members`);
    await detail;
    // Loaded signal, rendered FROM the answer about THIS circle: a member only
    // the archived circle has (GET /circles/:id `members`), or an explicit
    // error / not-found state if the gate is ever fixed that way. A static
    // page shell is not enough — the flags are `?? false` until the detail
    // is consumed, so an earlier version of this check passed vacuously.
    await expect(
      page.getByText(onlyHere, { exact: true }).or(page.getByRole('heading', { name: notOffered })).first()
    ).toBeVisible({ timeout: 20_000 });
    // …and it is still the ARCHIVED circle's page (no redirect into the live
    // one). A fix that REDIRECTS away fails here instead: then rewrite this test.
    await expect(page, 'still on the archived circle').toHaveURL(archivedUrl);
    // canEdit-gated controls only: they are what a detail-level archived check
    // (the missing gate) withdraws. Members' Invite is OWNER-gated in the UI and
    // this persona is the owner, so asserting it would keep this test red even
    // after the fix (verified: with the detail answered as non-editable the
    // Invite check alone still failed).
    //
    // ANCHORED TO A RENDERED PAGE. A retrying absence check (`toHaveCount(0)`)
    // passes the moment the control is gone for ANY reason — and under load the
    // app remounted to its boot spinner mid-test, so this known-bug test
    // "passed" with the bug still live (verified: the detail still answered
    // can_edit:true and Add event rendered). So: the sidebar New must be
    // PRESENT and disabled (the gated state, SURFACES), and Add event is counted
    // once between two checks that the calendar grid is on screen.
    if (await page.getByRole('heading', { name: notOffered }).count() === 0) {
      await expect(sidebarNew(page), 'sidebar rendered').toBeVisible();
      await expect.soft(sidebarNew(page), 'sidebar New disabled').toBeDisabled({ timeout: 2_000 });
    }

    // Same circle, calendar, flags already cached (no reload).
    await spaNavigate(page, `/circles/${h.circleId}/calendar`);
    await expect(
      page.getByRole('button', { name: /, (Appointment|Task|Medication), / }).or(page.getByRole('heading', { name: notOffered })).first()
    ).toBeVisible({ timeout: 20_000 });
    if (await page.getByRole('heading', { name: notOffered }).count() === 0) {
      const grid = page.getByRole('grid');
      await expect(grid, 'calendar rendered before counting').toBeVisible();
      const addEvent = await page.getByRole('button', { name: 'Add event', exact: true }).count();
      await expect(grid, 'calendar still rendered after counting').toBeVisible();
      expect.soft(addEvent, 'Add event offered on the archived circle').toBe(0);
    }
  }
);

/**
 * Fresh rows for ONE probe run, in the archived circle, written the way the app
 * writes them (owner-authored; the document with a real Storage object). A
 * resource whose bug lets writes through (renames, completes, DELETES) must not
 * eat the rows the next test or the next repeat probes, or that later probe
 * would fail on a 404 instead of at its refusal.
 */
async function freshTargets(h: PersonaHandle, label: string): Promise<{ handle: PersonaHandle; cleanup: () => void }> {
  const c = `${sqlStr(h.circleId)}::uuid`;
  const o = `${sqlStr(h.userId)}::uuid`;
  const today = circleTodaySql(h.circleId);
  const t = (kind: string) => sqlStr(`${label} ${kind}`);
  const objectName = `${h.circleId.toLowerCase()}/${Date.now()}-archived-probe.pdf`;
  await adminUpload('circle-documents', objectName, new Uint8Array(MINIMAL_PDF), 'application/pdf');
  sqlExec(`
    insert into calendar_events (circle_id, event_type, title, scheduled_date, created_by)
    values (${c}, 'task', ${t('task')}, ${today}, ${o});
    insert into calendar_events (circle_id, event_type, title, scheduled_date, scheduled_time, created_by)
    values (${c}, 'appointment', ${t('appointment')}, ${today}, '10:00:00', ${o});
    insert into calendar_events (circle_id, event_type, title, medication_name, medication_dosage,
                                 scheduled_date, scheduled_time, created_by)
    values (${c}, 'medication', ${t('medication')}, ${t('medication')}, '1 tablet', ${today}, '08:00:00', ${o});
    insert into care_notes (circle_id, author_id, note_date, body) values (${c}, ${o}, ${today}, ${t('note')});
    insert into health_vitals (circle_id, vital_type, value1, value2, unit, recorded_at, recorded_by, notes)
    values (${c}, 'blood_pressure', 121, 81, 'mmHg', now() - interval '1 hour', ${o}, ${t('vital')});
    insert into circle_documents (circle_id, uploaded_by, label, category, file_path, file_type, file_size)
    values (${c}, ${o}, ${t('document')}, 'medical_records', ${sqlStr(`circle-documents/${objectName}`)},
            'application/pdf', ${MINIMAL_PDF.byteLength});
  `);
  const [ids] = dbQuery<Record<string, string | null>>(`
    select (select id::text from calendar_events where circle_id = ${c} and title = ${t('task')}) as "taskId",
           (select id::text from calendar_events where circle_id = ${c} and title = ${t('appointment')}) as "appointmentId",
           (select id::text from calendar_events where circle_id = ${c} and title = ${t('medication')}) as "medicationId",
           (select id::text from care_notes where circle_id = ${c} and body = ${t('note')}) as "careNoteId",
           (select id::text from health_vitals where circle_id = ${c} and notes = ${t('vital')}) as "vitalId",
           (select id::text from circle_documents where circle_id = ${c} and label = ${t('document')}) as "documentId"`);
  const seeded = { ...h.seeded, ...ids } as PersonaHandle['seeded'];
  const idList = (vals: Array<string | null>) =>
    vals.filter((v): v is string => !!v).map((v) => `${sqlStr(v)}::uuid`).join(', ') || 'null';
  const eventIds = idList([ids.taskId, ids.appointmentId, ids.medicationId]);
  return {
    handle: { ...h, seeded },
    cleanup: () =>
      sqlExec(`
        delete from event_notes where event_id in (${eventIds}) or (circle_id = ${c} and body like ${sqlStr(`${label}%`)});
        delete from medication_confirmations where event_id in (${eventIds});
        delete from calendar_events where circle_id = ${c} and parent_event_id in (${eventIds});
        delete from calendar_events where circle_id = ${c} and (id in (${eventIds}) or title like ${sqlStr(`${label}%`)});
        delete from care_notes where circle_id = ${c} and (id in (${idList([ids.careNoteId])}) or body like ${sqlStr(`${label}%`)});
        delete from health_vitals where circle_id = ${c} and (id in (${idList([ids.vitalId])}) or notes like ${sqlStr(`${label}%`)});
        delete from circle_documents where circle_id = ${c} and (id in (${idList([ids.documentId])}) or label like ${sqlStr(`${label}%`)});
      `),
  };
}

for (const resource of WRITE_RESOURCES) {
  test(
    `server refuses ${resource} writes to an archived circle with 400 CIRCLE_ARCHIVED, and nothing is written`,
    async ({ request, personaHandle }) => {
      const label = uniqueLabel('Archived probe');
      const { handle, cleanup } = await freshTargets(personaHandle, label);
      try {
        await runWriteProbes(
          request,
          handle,
          { default: ARCHIVED, documents: ARCHIVED, invite: ARCHIVED },
          { only: resource, tag: label }
        );
      } finally {
        cleanup();
      }
    }
  );
}

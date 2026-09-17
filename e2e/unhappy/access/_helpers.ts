import type { APIRequestContext, APIResponse, Locator, Page } from '@playwright/test';
import { expect, uniqueLabel, type PersonaHandle } from '../../fixtures';
import { sqlExec } from '../../db';
import { adminUpload } from '../../isolation';
import { apiSession, dbCount, dbQuery, errorCodeOf, pathMatcher, sqlStr, type HttpMethod, type PathPattern } from '../../unhappy';

// ===========================================================================
// Shared pieces for e2e/unhappy/access/*. Not a foundation file: everything in
// here exists so the GATED specs and their NEGATIVE CONTROLS run the very same
// flows (`SURFACES`), and so the server-side write matrix (`runWriteProbes`) is
// written once.
// ===========================================================================

export const VIEW_ONLY_BANNER = 'View-only — you can see everything, but changes are off.';
export const UPGRADE_GATE_MESSAGE =
  "That feature isn't included in the free plan. Upgrade to Premium to unlock it for your whole circle.";
export const CIRCLE_SELECTION_BANNER = 'Your subscription ended. Choose which circle to keep with free access.';

/** A timed medication dose seeded for yesterday: confirmable at any hour (see ensurePastDoseYesterday). */
export const PAST_DOSE_NAME = 'E2E Past Dose';

const CONTROL_NOTE = 'E2E access control note';
const CONTROL_DOC = 'E2E access control document';
const CONTROL_VITAL_NOTE = 'E2E access control vital';

/** Rows the persona itself authored / uploaded (see ensureOwnAuthoredRows). */
export const OWN_NOTE = 'E2E note authored by this persona';
export const OWN_DOC = 'E2E document uploaded by this persona';

export const MINIMAL_PDF = Buffer.from(
  '%PDF-1.1\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n' +
    '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
    '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 100 100]>>endobj\n' +
    'trailer<</Root 1 0 R>>\n%%EOF\n'
);

export function rx(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const uuid = (id: string) => `${sqlStr(id)}::uuid`;

function one(sql: string): string | null {
  const row = dbQuery<{ v: string | null }>(sql)[0];
  return row ? row.v : null;
}

export function circleNameOf(circleId: string): string {
  const name = one(`select name as v from care_circles where id = ${uuid(circleId)}`);
  if (!name) throw new Error(`circle ${circleId} not found`);
  return name;
}

/**
 * The desktop sidebar's "New" button. Below `xl` the sidebar is not rendered
 * and the same accessible name belongs to the FloatingNavBar pill's NEW cell,
 * so this is "the create control of the navigation this viewport draws".
 */
export function sidebarNew(page: Page): Locator {
  return page.getByRole('button', { name: 'New', exact: true });
}

/**
 * Navigate into a circle page with the gating flags PROVABLY applied.
 *
 * Every write control reads `useCircle().canEdit`, which is `?? false` until
 * GET /api/circles/:id has been consumed. A page whose own data renders first
 * would let an absence check pass against the not-yet-loaded flags (this
 * happened: the archived-circle spec passed on a static grid). So:
 *
 *   1. hard-load the Members page — its roster is rendered FROM the detail
 *      payload's `members`, so the owner's e-mail on screen means the detail
 *      is in the query cache;
 *   2. SPA-navigate (history + popstate, no reload) to the target page, which
 *      then mounts with the cached flags on its very first render (staleTime
 *      60s, well beyond any test).
 */
export async function gotoCirclePage(page: Page, circleId: string, sub: string): Promise<void> {
  const detail = page.waitForResponse(
    (r) => r.request().method() === 'GET' && new URL(r.url()).pathname === `/api/circles/${circleId}`,
    { timeout: 20_000 }
  );
  await page.goto(`/circles/${circleId}/members`);
  expect((await detail).status(), `GET /api/circles/${circleId}`).toBe(200);
  const ownerEmail = one(
    `select u.email as v from care_circles c join users u on u.id = c.owner_id where c.id = ${uuid(circleId)}`
  );
  await expect(
    page.getByText(need(ownerEmail, 'the circle owner e-mail'), { exact: true }).first(),
    'roster rendered from GET /api/circles/:id (gating flags are cached)'
  ).toBeVisible({ timeout: 20_000 });
  if (sub !== 'members') await spaNavigate(page, `/circles/${circleId}${sub ? `/${sub}` : ''}`);
}

/** Client-side navigation (react-router handles popstate): no reload, the query cache survives. */
export async function spaNavigate(page: Page, path: string): Promise<void> {
  await page.evaluate((url) => {
    window.history.pushState({}, '', url);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, path);
  await expect(page).toHaveURL(new RegExp(`${rx(path)}$`));
}

/** Header circle switcher → "All circles" (the picker, even for a single-circle account). */
export async function openAllCircles(page: Page): Promise<void> {
  await page.getByRole('button', { name: /^Switch circle/ }).click();
  await page.getByRole('menuitem', { name: 'All circles' }).click();
  await expect(page).toHaveURL(/\/circles$/, { timeout: 15_000 });
}

/** The AI entry on the navigation this viewport renders (sidebar at xl+, pill below). */
export function aiEntrySurface(page: Page): { kind: string; navSignal: Locator; aiEntry: Locator } {
  const width = page.viewportSize()?.width ?? 1280;
  if (width >= 1024) {
    return {
      kind: 'desktop sidebar',
      navSignal: sidebarNew(page),
      aiEntry: page.getByRole('button', { name: 'Assistant', exact: true }),
    };
  }
  return {
    kind: 'mobile pill',
    navSignal: sidebarNew(page),
    aiEntry: page.getByRole('button', { name: 'AI', exact: true }),
  };
}

// ---------------------------------------------------------------------------
// The circle's scheduling day
// ---------------------------------------------------------------------------

/**
 * SQL for the circle's scheduling timezone — the SAME chain the backend hands
 * the client as `care_recipient_timezone` on GET /api/circles/:id, which is the
 * frame the calendar and `isDoseConfirmable` work in:
 *
 *   backend/src/routes/circles.ts:684-688
 *     careRecipient = the member row with `is_care_recipient`
 *     circleOwner   = the MEMBER row whose user id is `care_circles.owner_id`
 *     safeTimezone(careRecipient?.timezone || circleOwner?.timezone)
 *       (`||`: a null OR empty recipient zone falls through to the owner's)
 *   backend/src/utils/timezone.ts:157-160  safeTimezone
 *     a zone Intl cannot format (isValidTimezone, :63-75) → DEFAULT_TIMEZONE
 *     'America/New_York' (:14) — the owner is NOT consulted again — then
 *     TZ_SCHEDULING_SUBSTITUTES (:116-130).
 *
 * Intl validity is approximated by `pg_timezone_names` (the IANA set this
 * Postgres formats in). Times are naive local in this zone (project rule), so
 * the day is `now() at time zone <zone>`, never the runner's clock.
 */
export function circleTimezoneSql(circleId: string): string {
  const c = uuid(circleId);
  const picked = `coalesce(
      (select nullif(u.timezone, '') from circle_memberships m join users u on u.id = m.user_id
        where m.circle_id = ${c} and m.is_care_recipient = true limit 1),
      (select nullif(u.timezone, '') from care_circles cc
         join circle_memberships m on m.circle_id = cc.id and m.user_id = cc.owner_id
         join users u on u.id = m.user_id
        where cc.id = ${c} limit 1))`;
  const valid = `(select case when exists (select 1 from pg_timezone_names n where n.name = z.tz) then z.tz
                              else 'America/New_York' end
                    from (select ${picked} as tz) z)`;
  return `(select case v.tz
             when 'America/Vancouver' then 'America/Dawson_Creek'
             when 'Canada/Pacific' then 'America/Dawson_Creek'
             when 'America/Edmonton' then 'America/Regina'
             when 'America/Yellowknife' then 'America/Regina'
             when 'Canada/Mountain' then 'America/Regina'
             when 'Africa/Casablanca' then 'Africa/Abidjan'
             when 'Africa/El_Aaiun' then 'Africa/Abidjan'
             else v.tz end
            from (select ${valid} as tz) v)`;
}

/** SQL for "today" (a DATE) in the circle's scheduling timezone (`circleTimezoneSql`). */
export function circleTodaySql(circleId: string): string {
  return `((now() at time zone ${circleTimezoneSql(circleId)})::date)`;
}

// ---------------------------------------------------------------------------
// Seats
// ---------------------------------------------------------------------------

/** Write the stored seat flag the backend derives `can_edit` from (what applyCaregiverCap writes). */
export function setSeatViewOnly(circleId: string, userId: string, viewOnly: boolean): void {
  sqlExec(
    `update circle_memberships set view_only = ${viewOnly ? 'true' : 'false'}
      where circle_id = ${uuid(circleId)} and user_id = ${uuid(userId)};`
  );
}

/**
 * At the instant the browser SENDS the first matching request, downgrade the
 * persona's seat to view-only in the database, then pass the request on to the
 * next route handler (register this AFTER `failRequest`, so it runs first and
 * the fault still answers). The client's follow-up refetch then reads the real
 * backend's downgraded flags.
 */
export async function downgradeSeatWhenRequested(
  page: Page,
  method: HttpMethod,
  pattern: PathPattern,
  h: Pick<PersonaHandle, 'circleId' | 'userId'>
): Promise<void> {
  const match = pathMatcher(pattern);
  let done = false;
  await page.route(
    (url) => match(url.pathname),
    async (route) => {
      const req = route.request();
      if (!done && (method === '*' || req.method() === method) && req.resourceType() !== 'document') {
        done = true;
        setSeatViewOnly(h.circleId, h.userId, true);
      }
      await route.fallback();
    }
  );
}

// ---------------------------------------------------------------------------
// Surfaces: one definition per write surface, run by the gated specs AND the
// premium control.
// ---------------------------------------------------------------------------

export interface Affordance {
  label: string;
  locator: Locator;
  /** How the gated persona must see it. Default 'absent'. */
  gated?: 'absent' | 'disabled';
  /** How the control persona must see it. Default 'enabled'. */
  offered?: 'enabled' | 'visible';
}

export interface SurfaceData {
  circleId: string;
  ownerUserId: string;
  ownerEmail: string;
  taskTitle: string;
  medName: string;
  doctorName: string;
  careNoteBody: string | null;
  documentLabel: string | null;
  vitalText: string | null;
}

export interface Surface {
  name: string;
  /** Navigate, prove the data the controls act on is on screen, return the controls. */
  open(page: Page, data: SurfaceData): Promise<Affordance[]>;
}

function vitalTextOf(vitalId: string | null): string | null {
  if (!vitalId) return null;
  const [v] = dbQuery<{ vital_type: string; value1: number; value2: number | null; unit: string }>(
    `select vital_type, value1::float8 as value1, value2::float8 as value2, unit from health_vitals where id = ${uuid(vitalId)}`
  );
  if (!v) return null;
  return v.vital_type === 'blood_pressure'
    ? `${Number(v.value1)}/${Number(v.value2)} ${v.unit}`
    : `${Number(v.value1)} ${v.unit}`;
}

/** The on-screen text of the persona circle's records (from the database, never from the page). */
export function loadSurfaceData(h: PersonaHandle, overrides: Partial<SurfaceData> = {}): SurfaceData {
  const c = uuid(h.circleId);
  const taskTitle = one(
    `select title as v from calendar_events where circle_id = ${c} and event_type = 'task'
        and parent_event_id is null and recurrence_rule is null and completed_at is null
      order by scheduled_date, id limit 1`
  );
  const medName = one(
    `select coalesce(medication_name, title) as v from calendar_events where circle_id = ${c}
        and event_type = 'medication' and parent_event_id is null and discontinued_at is null
        and title <> ${sqlStr(PAST_DOSE_NAME)}
      order by coalesce(medication_name, title) limit 1`
  );
  const doctorName = one(`select primary_doctor_name as v from emergency_info where circle_id = ${c}`);
  if (!taskTitle || !medName || !doctorName) {
    throw new Error(`persona circle ${h.circleId} lacks an open task / medication / doctor to anchor on`);
  }
  return {
    circleId: h.circleId,
    ownerUserId: h.ownerUserId,
    ownerEmail: h.ownerEmail,
    taskTitle,
    medName,
    doctorName,
    careNoteBody: h.seeded.careNoteId
      ? one(`select body as v from care_notes where id = ${uuid(h.seeded.careNoteId)}`)
      : null,
    documentLabel: h.seeded.documentId
      ? one(`select label as v from circle_documents where id = ${uuid(h.seeded.documentId)}`)
      : null,
    vitalText: vitalTextOf(h.seeded.vitalId),
    ...overrides,
  };
}

/**
 * A care note AUTHORED by, and a document UPLOADED by, the persona itself
 * (idempotent: once per worker slot). Returns the `SurfaceData` overrides that
 * point the notes / document-menu surfaces at them.
 *
 * WHY. Row controls are gated by more than `canEdit`: note Edit needs
 * `canEdit && isOwn`, note Delete `canEdit && (isOwn || isCircleOwner)`
 * (webapp/src/pages/NotesPage.tsx:303-304), document Edit/Delete
 * `canEdit && (uploader || owner)` (DocumentsPage.tsx:67-68). The persona seed
 * rows are authored by the HOST (personas.ts:401), so a non-owner is never
 * offered those controls on them, view-only or not — an absence check there
 * stayed green with GET /circles/:id rewritten to `can_edit: true`. On the
 * persona's OWN rows only `canEdit` hides them.
 *
 * ROWS THE PRODUCT PRODUCES. A caregiver writes a note / uploads a file while
 * the seat is editable; a later downgrade caps the seat (`applyCaregiverCap`
 * flips `circle_memberships.view_only` only, never authored rows). Written the
 * way the routes write them: the note dated the circle's scheduling day, the
 * document with a REAL Storage object at the upload route's path.
 */
export async function ensureOwnAuthoredRows(
  h: PersonaHandle
): Promise<{ careNoteBody: string; documentLabel: string }> {
  const c = uuid(h.circleId);
  const me = uuid(h.userId);
  const ownNote = `select 1 from care_notes where circle_id = ${c} and author_id = ${me} and body = ${sqlStr(OWN_NOTE)}`;
  const ownDoc = `select 1 from circle_documents where circle_id = ${c} and uploaded_by = ${me} and label = ${sqlStr(OWN_DOC)}`;
  if (dbCount(ownNote) === 0) {
    sqlExec(
      `insert into care_notes (circle_id, author_id, note_date, body)
       values (${c}, ${me}, ${circleTodaySql(h.circleId)}, ${sqlStr(OWN_NOTE)});`
    );
  }
  if (dbCount(ownDoc) === 0) {
    const objectName = `${h.circleId.toLowerCase()}/${Date.now()}-own.pdf`;
    await adminUpload('circle-documents', objectName, new Uint8Array(MINIMAL_PDF), 'application/pdf');
    sqlExec(
      `insert into circle_documents (circle_id, uploaded_by, label, category, file_path, file_type, file_size)
       values (${c}, ${me}, ${sqlStr(OWN_DOC)}, 'medical_records', ${sqlStr(`circle-documents/${objectName}`)},
               'application/pdf', ${MINIMAL_PDF.byteLength});`
    );
  }
  expect(dbCount(ownNote), 'a care note authored by the persona').toBe(1);
  expect(dbCount(ownDoc), 'a document uploaded by the persona').toBe(1);
  return { careNoteBody: OWN_NOTE, documentLabel: OWN_DOC };
}

/**
 * Idempotently insert YESTERDAY's 08:00 dose (circle scheduling timezone,
 * authored by the owner, no confirmation). A timed dose from a past day that
 * nobody answered is confirmable at any hour (`isDoseConfirmable`:
 * scheduled_date < today), so the control's "Mark taken" does not depend on
 * when the suite runs. (A timeless dose would not do: the calendar modal
 * excludes doses without a `scheduled_time` because the confirm endpoint
 * requires one.)
 *
 * "Today" is `circleTodaySql`: the backend's exact fallback chain (recipient →
 * owner member → America/New_York). A Denver fallback here would put
 * "yesterday" on the wrong day for a circle without a recipient zone whenever
 * Denver and the backend's zone straddle midnight.
 *
 * `inPreviousWeek`: the week view starts on Sunday, so on a Sunday yesterday is
 * one "Previous week" away. Deterministic navigation, not a skip.
 */
export function ensurePastDoseYesterday(d: SurfaceData): { name: string; inPreviousWeek: boolean } {
  const c = uuid(d.circleId);
  const today = circleTodaySql(d.circleId);
  sqlExec(`
    insert into calendar_events (circle_id, event_type, title, medication_name, medication_dosage,
                                 scheduled_date, scheduled_time, created_by)
    select ${c}, 'medication', ${sqlStr(PAST_DOSE_NAME)}, ${sqlStr(PAST_DOSE_NAME)}, '1 tablet',
           ${today} - 1, '08:00:00', ${uuid(d.ownerUserId)}
     where not exists (select 1 from calendar_events where circle_id = ${c}
                         and title = ${sqlStr(PAST_DOSE_NAME)} and scheduled_date = ${today} - 1);
  `);
  const dow = Number(one(`select extract(dow from ${today})::int::text as v`));
  return { name: PAST_DOSE_NAME, inPreviousWeek: dow === 0 };
}

function need<T>(value: T | null, what: string): T {
  if (value === null) throw new Error(`surface data is missing ${what}`);
  return value;
}

async function openCalendar(page: Page, d: SurfaceData): Promise<void> {
  await gotoCirclePage(page, d.circleId, 'calendar');
  await expect(page.getByRole('grid')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('button', { name: /, (Appointment|Task|Medication), / }).first()).toBeVisible({
    timeout: 20_000,
  });
}

export const SURFACES: Surface[] = [
  {
    name: 'calendar',
    async open(page, d) {
      await openCalendar(page, d);
      return [
        { label: 'Add event (masthead)', locator: page.getByRole('button', { name: 'Add event', exact: true }) },
        { label: 'New (sidebar)', locator: sidebarNew(page), gated: 'disabled' },
      ];
    },
  },
  {
    name: 'calendar event detail',
    async open(page, d) {
      await openCalendar(page, d);
      const chip = page.getByRole('button', { name: /, (Appointment|Task), / }).first();
      const chipName = need(await chip.getAttribute('aria-label'), 'an event chip label');
      const title = chipName.split(', ')[0];
      await chip.click();
      const dialog = page.getByRole('dialog');
      await expect(dialog.getByText(title).first()).toBeVisible();
      return [
        {
          label: `edit / delete / complete actions for "${title}"`,
          locator: dialog.getByRole('button', { name: /^(More|Edit event|Delete|Mark complete)$/ }),
        },
      ];
    },
  },
  {
    name: 'calendar dose detail (confirm dose)',
    async open(page, d) {
      const { name, inPreviousWeek } = ensurePastDoseYesterday(d);
      await openCalendar(page, d);
      if (inPreviousWeek) await page.getByRole('button', { name: 'Previous week', exact: true }).click();
      const chip = page.getByRole('button', { name: new RegExp(`^${rx(name)}, Medication`) }).first();
      await expect(chip).toBeVisible({ timeout: 20_000 });
      await chip.click();
      const dialog = page.getByRole('dialog');
      await expect(dialog.getByText(name).first()).toBeVisible();
      return [
        {
          label: `Mark taken / Skip dose for "${name}"`,
          locator: dialog.getByRole('button', { name: /^(Mark taken|Skip dose)$/ }),
        },
      ];
    },
  },
  {
    name: 'medications',
    async open(page, d) {
      await gotoCirclePage(page, d.circleId, 'meds');
      await expect(page.getByRole('button', { name: `View details for ${d.medName}`, exact: true })).toBeVisible({
        timeout: 20_000,
      });
      return [
        { label: 'Add medication', locator: page.getByRole('button', { name: 'Add medication', exact: true }) },
        {
          label: `More actions for ${d.medName}`,
          locator: page.getByRole('button', { name: `More actions for ${d.medName}`, exact: true }),
        },
      ];
    },
  },
  {
    name: 'medication detail',
    async open(page, d) {
      await gotoCirclePage(page, d.circleId, 'meds');
      const details = page.getByRole('button', { name: `View details for ${d.medName}`, exact: true });
      await expect(details).toBeVisible({ timeout: 20_000 });
      await details.click();
      const dialog = page.getByRole('dialog');
      await expect(dialog.getByText(d.medName).first()).toBeVisible();
      return [
        { label: 'Edit / More in the medication modal', locator: dialog.getByRole('button', { name: /^(Edit|More.*)$/ }) },
      ];
    },
  },
  {
    name: 'tasks',
    async open(page, d) {
      await gotoCirclePage(page, d.circleId, 'tasks');
      // Not `exact`: the row's text node is "<title> (not done)".
      await expect(page.getByText(d.taskTitle).first()).toBeVisible({ timeout: 20_000 });
      return [
        { label: 'Add task', locator: page.getByRole('button', { name: 'Add task', exact: true }) },
        {
          label: `Mark "${d.taskTitle}" complete`,
          locator: page.getByRole('button', { name: `Mark "${d.taskTitle}" complete`, exact: true }),
        },
        {
          label: `Edit "${d.taskTitle}"`,
          locator: page.getByRole('button', { name: new RegExp(`^Edit "${rx(d.taskTitle)}"`) }),
        },
      ];
    },
  },
  {
    // Row actions are author/owner-gated as well as canEdit-gated: a NON-OWNER
    // gate spec must point `careNoteBody` at a note the viewer authored
    // (`ensureOwnAuthoredRows`), or the row check cannot fail.
    name: 'notes',
    async open(page, d) {
      await gotoCirclePage(page, d.circleId, 'notes');
      await expect(page.getByText(need(d.careNoteBody, 'a care note')).first()).toBeVisible({ timeout: 20_000 });
      return [
        { label: 'note composer', locator: page.getByLabel(/^Add a note/) },
        { label: 'Post', locator: page.getByRole('button', { name: 'Post', exact: true }), offered: 'visible' },
        { label: 'note row actions', locator: page.getByRole('button', { name: /^Actions for note by / }) },
      ];
    },
  },
  {
    name: 'documents',
    async open(page, d) {
      await gotoCirclePage(page, d.circleId, 'documents');
      await expect(page.getByText(need(d.documentLabel, 'a document')).first()).toBeVisible({ timeout: 20_000 });
      return [
        { label: 'Upload document', locator: page.getByRole('button', { name: 'Upload document', exact: true }) },
        { label: 'New (sidebar)', locator: sidebarNew(page), gated: 'disabled' },
      ];
    },
  },
  {
    // Edit/Delete are uploader-or-owner-gated as well as canEdit-gated: a
    // NON-OWNER gate spec must point `documentLabel` at a document the viewer
    // uploaded (`ensureOwnAuthoredRows`), or the menu check cannot fail.
    name: 'document actions menu',
    async open(page, d) {
      const label = need(d.documentLabel, 'a document');
      await gotoCirclePage(page, d.circleId, 'documents');
      const options = page.getByRole('button', { name: `Options for ${label}`, exact: true });
      await expect(options).toBeVisible({ timeout: 20_000 });
      await options.click();
      const menu = page.getByRole('menu');
      await expect(menu.getByRole('menuitem', { name: 'Preview', exact: true })).toBeVisible();
      return [{ label: 'Edit / Delete menu items', locator: menu.getByRole('menuitem', { name: /^(Edit|Delete)$/ }) }];
    },
  },
  {
    name: 'emergency info',
    async open(page, d) {
      await gotoCirclePage(page, d.circleId, 'emergency');
      await expect(page.getByText(d.doctorName).first()).toBeVisible({ timeout: 20_000 });
      return [
        {
          label: 'Edit medical information',
          locator: page.getByRole('button', { name: 'Edit medical information', exact: true }),
        },
        { label: 'row actions (doctor / contact / insurance)', locator: page.getByRole('button', { name: /^Actions for / }) },
        { label: 'Add doctor / contact / insurance', locator: page.getByRole('button', { name: /^Add (doctor|contact|insurance)$/ }) },
      ];
    },
  },
  {
    name: 'vitals',
    async open(page, d) {
      await gotoCirclePage(page, d.circleId, 'vitals');
      await expect(page.getByText(need(d.vitalText, 'a vital')).first()).toBeVisible({ timeout: 20_000 });
      return [
        { label: 'Add reading', locator: page.getByRole('button', { name: 'Add reading', exact: true }) },
        { label: 'reading row actions', locator: page.getByRole('button', { name: /^Actions for reading / }) },
      ];
    },
  },
  {
    // OWNER-gated (MembersPage.tsx `isOwner`, never `canEdit`): only meaningful
    // as the premium OWNER's control. A non-owner gate spec must leave it out —
    // the controls are absent for any non-owner, so the check cannot fail.
    name: 'members',
    async open(page, d) {
      await gotoCirclePage(page, d.circleId, 'members');
      await expect(page.getByText(d.ownerEmail, { exact: true }).first()).toBeVisible({ timeout: 20_000 });
      return [
        { label: 'Invite member', locator: page.getByRole('button', { name: 'Invite member', exact: true }) },
        { label: 'member manage actions', locator: page.getByRole('button', { name: /^(Actions for|Remove) / }) },
      ];
    },
  },
];

export async function expectGated(affordances: Affordance[]): Promise<void> {
  expect(affordances.length, 'a surface must name at least one affordance').toBeGreaterThan(0);
  for (const a of affordances) {
    if (a.gated === 'disabled') {
      await expect(a.locator, `${a.label}: rendered`).toBeVisible();
      await expect(a.locator, `${a.label}: disabled`).toBeDisabled();
    } else {
      await expect(a.locator, `${a.label}: not offered`).toHaveCount(0);
    }
  }
}

export async function expectOffered(affordances: Affordance[]): Promise<void> {
  expect(affordances.length, 'a surface must name at least one affordance').toBeGreaterThan(0);
  for (const a of affordances) {
    await expect(a.locator.first(), `${a.label}: offered`).toBeVisible();
    if (a.offered !== 'visible') await expect(a.locator.first(), `${a.label}: enabled`).toBeEnabled();
  }
}

/** The premium clone has no care note / vital / document: create one of each (once per worker slot) through the API. */
export async function ensureControlRows(request: APIRequestContext, h: PersonaHandle): Promise<SurfaceData> {
  const c = uuid(h.circleId);
  const api = await apiSession(request, h);
  const base = `/api/circles/${h.circleId}`;
  if (dbCount(`select 1 from care_notes where circle_id = ${c} and body = ${sqlStr(CONTROL_NOTE)}`) === 0) {
    const r = await api.post(`${base}/care-notes`, { body: CONTROL_NOTE });
    expect(r.status(), `seed control note: ${await r.text()}`).toBe(201);
  }
  if (dbCount(`select 1 from health_vitals where circle_id = ${c} and notes = ${sqlStr(CONTROL_VITAL_NOTE)}`) === 0) {
    const r = await api.post(`${base}/vitals`, {
      vital_type: 'blood_pressure',
      value1: 118,
      value2: 76,
      unit: 'mmHg',
      recorded_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      notes: CONTROL_VITAL_NOTE,
    });
    expect(r.status(), `seed control vital: ${await r.text()}`).toBe(201);
  }
  if (dbCount(`select 1 from circle_documents where circle_id = ${c} and label = ${sqlStr(CONTROL_DOC)}`) === 0) {
    const r = await uploadDocument(request, api.token, h.circleId, CONTROL_DOC);
    expect(r.status(), `seed control document: ${await r.text()}`).toBe(201);
  }
  const vitalId = one(`select id::text as v from health_vitals where circle_id = ${c} and notes = ${sqlStr(CONTROL_VITAL_NOTE)} limit 1`);
  return loadSurfaceData(h, {
    careNoteBody: CONTROL_NOTE,
    documentLabel: CONTROL_DOC,
    vitalText: vitalTextOf(vitalId),
  });
}

export function uploadDocument(
  request: APIRequestContext,
  token: string,
  circleId: string,
  label: string
): Promise<APIResponse> {
  return request.post(`/api/circles/${circleId}/documents/upload`, {
    headers: { Authorization: `Bearer ${token}` },
    multipart: {
      file: { name: 'e2e-access.pdf', mimeType: 'application/pdf', buffer: MINIMAL_PDF },
      label,
      category: 'medical_records',
      fileExtension: 'pdf',
    },
  });
}

// ---------------------------------------------------------------------------
// Server-side write matrix
// ---------------------------------------------------------------------------

export interface WriteOutcome {
  /**
   * Exact status AND (when set) exact `error.code`. There is deliberately no
   * "any 4xx" wildcard: a 400 VALIDATION_ERROR or a 404 is not a gate refusal,
   * and accepting one let a probe count a malformed call as "refused".
   */
  status: number;
  code?: string;
}

export interface WriteExpectations {
  /** Every `requireCircleEditAccess` route (events, confirmations, care notes, vitals, emergency info, event notes). */
  default: WriteOutcome;
  /** Document upload / rename / delete (`resolveEditAccess`). */
  documents: WriteOutcome;
  /** POST /circles/:id/invites. */
  invite: WriteOutcome;
}

/** The resource each probe writes — the unit a fix lands in, so specs can run one at a time. */
export const WRITE_RESOURCES = [
  'events',
  'medication confirmations',
  'event notes',
  'care notes',
  'vitals',
  'emergency info',
  'documents',
  'invites',
] as const;
export type WriteResource = (typeof WRITE_RESOURCES)[number];

interface WriteProbe {
  name: string;
  resource: WriteResource;
  kind: keyof WriteExpectations;
  call: () => Promise<APIResponse>;
  /** A snapshot of the rows the call would change; must be identical before and after. */
  state: () => string;
}

/**
 * Call every write endpoint of the persona's circle with a VALID body (so a
 * broken gate really writes), assert the refusal, and assert the database
 * snapshot the call would have changed is identical afterwards. Soft
 * assertions: one run reports the whole matrix.
 *
 * `opts.only` runs one resource's probes; `opts.tag` fixes the run-unique
 * label the creating probes write (so a caller can clean up what a broken gate
 * let through). The ids come from `h.seeded`, so a caller may pass a handle
 * whose `seeded` points at rows it created for this run.
 */
export async function runWriteProbes(
  request: APIRequestContext,
  h: PersonaHandle,
  exp: WriteExpectations,
  opts: { only?: WriteResource; tag?: string } = {}
): Promise<void> {
  const s = h.seeded;
  const ids = {
    appointmentId: need(s.appointmentId, 'an appointment'),
    taskId: need(s.taskId, 'a task'),
    medicationId: need(s.medicationId, 'a medication'),
    careNoteId: need(s.careNoteId, 'a care note'),
    vitalId: need(s.vitalId, 'a vital'),
    documentId: need(s.documentId, 'a document'),
  };
  const api = await apiSession(request, h);
  const base = `/api/circles/${h.circleId}`;
  const c = uuid(h.circleId);
  const tag = opts.tag ?? uniqueLabel('Probe');
  const today = new Date().toISOString().slice(0, 10);
  const n = (sql: string) => String(dbCount(sql));

  const probes: WriteProbe[] = [
    {
      name: 'POST events (create task)',
      resource: 'events',
      kind: 'default',
      call: () => api.post(`${base}/events`, { event_type: 'task', title: tag, scheduled_date: today }),
      state: () => n(`select 1 from calendar_events where circle_id = ${c} and title = ${sqlStr(tag)}`),
    },
    {
      name: 'PATCH events/:id (rename appointment)',
      resource: 'events',
      kind: 'default',
      call: () => api.patch(`${base}/events/${ids.appointmentId}`, { title: tag }),
      state: () => String(one(`select title || '|' || updated_at::text as v from calendar_events where id = ${uuid(ids.appointmentId)}`)),
    },
    {
      name: 'POST events/:id/complete',
      resource: 'events',
      kind: 'default',
      call: () => api.post(`${base}/events/${ids.taskId}/complete`, {}),
      state: () => String(one(`select coalesce(completed_at::text, 'open') as v from calendar_events where id = ${uuid(ids.taskId)}`)),
    },
    {
      name: 'POST medications/confirm',
      resource: 'medication confirmations',
      kind: 'default',
      call: () =>
        api.post(`${base}/medications/confirm`, { event_id: ids.medicationId, status: 'taken', scheduled_time: '08:00:00' }),
      state: () => n(`select 1 from medication_confirmations where circle_id = ${c} and confirmed_by = ${uuid(h.userId)}`),
    },
    {
      name: 'POST events/:id/notes',
      resource: 'event notes',
      kind: 'default',
      call: () => api.post(`${base}/events/${ids.appointmentId}/notes`, { body: tag }),
      state: () => n(`select 1 from event_notes where circle_id = ${c} and body = ${sqlStr(tag)}`),
    },
    {
      name: 'POST care-notes',
      resource: 'care notes',
      kind: 'default',
      call: () => api.post(`${base}/care-notes`, { body: tag }),
      state: () => n(`select 1 from care_notes where circle_id = ${c} and body = ${sqlStr(tag)}`),
    },
    {
      name: 'PATCH care-notes/:id',
      resource: 'care notes',
      kind: 'default',
      call: () => api.patch(`${base}/care-notes/${ids.careNoteId}`, { body: tag }),
      state: () => String(one(`select coalesce(body, '') || '|' || updated_at::text as v from care_notes where id = ${uuid(ids.careNoteId)}`)),
    },
    {
      name: 'POST vitals',
      resource: 'vitals',
      kind: 'default',
      call: () =>
        api.post(`${base}/vitals`, {
          vital_type: 'heart_rate',
          value1: 71,
          unit: 'bpm',
          recorded_at: new Date(Date.now() - 60_000).toISOString(),
          notes: tag,
        }),
      state: () => n(`select 1 from health_vitals where circle_id = ${c} and notes = ${sqlStr(tag)}`),
    },
    {
      name: 'PUT vitals/:id',
      resource: 'vitals',
      kind: 'default',
      call: () => api.put(`${base}/vitals/${ids.vitalId}`, { value1: 141 }),
      state: () => String(one(`select value1::text || '|' || updated_at::text as v from health_vitals where id = ${uuid(ids.vitalId)}`)),
    },
    {
      name: 'PUT emergency-info',
      resource: 'emergency info',
      kind: 'default',
      call: () => api.put(`${base}/emergency-info`, { blood_type: 'AB-' }),
      state: () => String(one(`select coalesce(blood_type, '') || '|' || coalesce(updated_at::text, '') as v from emergency_info where circle_id = ${c}`)),
    },
    {
      name: 'POST documents/upload',
      resource: 'documents',
      kind: 'documents',
      call: () => uploadDocument(request, api.token, h.circleId, tag),
      state: () => n(`select 1 from circle_documents where circle_id = ${c} and label = ${sqlStr(tag)}`),
    },
    {
      name: 'PATCH documents/:id',
      resource: 'documents',
      kind: 'documents',
      call: () => api.patch(`${base}/documents/${ids.documentId}`, { label: tag }),
      state: () => String(one(`select label || '|' || updated_at::text as v from circle_documents where id = ${uuid(ids.documentId)}`)),
    },
    {
      name: 'POST invites',
      resource: 'invites',
      kind: 'invite',
      call: () => api.post(`${base}/invites`, { email: `e2e-probe-${Date.now()}@example.com` }),
      state: () => n(`select 1 from invites where circle_id = ${c} and created_at > now() - interval '10 minutes'`),
    },
    // Destructive ones last, so a broken gate cannot hide the earlier probes' targets.
    {
      name: 'DELETE care-notes/:id',
      resource: 'care notes',
      kind: 'default',
      call: () => api.delete(`${base}/care-notes/${ids.careNoteId}`),
      state: () => n(`select 1 from care_notes where id = ${uuid(ids.careNoteId)}`),
    },
    {
      name: 'DELETE vitals/:id',
      resource: 'vitals',
      kind: 'default',
      call: () => api.delete(`${base}/vitals/${ids.vitalId}`),
      state: () => n(`select 1 from health_vitals where id = ${uuid(ids.vitalId)}`),
    },
    {
      name: 'DELETE documents/:id',
      resource: 'documents',
      kind: 'documents',
      call: () => api.delete(`${base}/documents/${ids.documentId}`),
      state: () => n(`select 1 from circle_documents where id = ${uuid(ids.documentId)}`),
    },
    {
      name: 'DELETE events/:id (task)',
      resource: 'events',
      kind: 'default',
      call: () => api.delete(`${base}/events/${ids.taskId}`),
      state: () => n(`select 1 from calendar_events where id = ${uuid(ids.taskId)}`),
    },
  ];

  const selected = opts.only ? probes.filter((p) => p.resource === opts.only) : probes;
  expect(selected.length, `write probes for ${opts.only ?? 'all resources'}`).toBeGreaterThan(0);

  for (const probe of selected) {
    const want = exp[probe.kind];
    const before = probe.state();
    const res = await probe.call();
    const after = probe.state();
    const status = res.status();
    const detail = `${probe.name} → ${status} ${(await res.text()).slice(0, 160)}`;
    expect.soft(status, `${detail}: status`).toBe(want.status);
    if (want.code) expect.soft(await errorCodeOf(res), `${detail}: error.code`).toBe(want.code);
    expect.soft(after, `${probe.name}: database unchanged`).toBe(before);
  }
}

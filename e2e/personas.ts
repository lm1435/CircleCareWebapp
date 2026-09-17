import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { sqlExec, sqlRows, sqlStr } from './db';
import {
  ACCOUNT_DOMAIN,
  ACCOUNT_PASSWORD,
  ACCOUNT_PREFIX,
  adminUpload,
  cloneCircle,
  createAccount,
  purgeAccountsWhere,
  resolveTemplate,
  runDir,
  runScopedEmail,
  type IsolatedAccount,
  type PlanTier,
  type Template,
} from './isolation';
import { currentRunId } from './runId';

// ===========================================================================
// PERSONAS — accounts in the states the paywall / permission gates branch on.
// ===========================================================================
//
// Every persona is a set of ROWS the product itself can produce. No derived
// flag (`can_edit`, `is_premium_circle`, `access_level`, `read_only`) is ever
// written; those are computed by the backend from three stored inputs, and the
// seed only sets those inputs:
//
//   users.plan_tier                   the CACHED tier getUserTier reads
//                                     (backend/src/services/tierService.ts:83-105)
//   care_circles.archived_at /        soft delete (routes/circles.ts:922-926) and
//     .selected_on_downgrade          the downgrade choice (tierService.ts:301-344)
//   circle_memberships.view_only      a STORED seat flag, written only by
//                                     applyCaregiverCap (tierService.ts:359-449)
//                                     and invite joins (services/inviteJoin.ts:151)
//
// DERIVATION (backend/src/services/circleAccess.ts getCircleAccessLevel):
//   :332  isViewOnlySeat(membership)          -> view, can_edit false, view_only true,
//                                                is_premium_circle HARDCODED false
//   :352  owner tier != 'free'                -> full, can_edit true, premium true
//   :367  free owner: count non-archived owned circles
//   :387  count <= 1 OR selected_on_downgrade -> edit, can_edit true, premium false
//   :401  otherwise (frozen)                  -> view, can_edit false, premium false
// `read_only` on GET /circles is the `frozen` flag (circleAccess.ts:72-81, 703-719,
// routes/circles.ts:243-251). GET /circles excludes archived circles
// (routes/circles.ts:130); GET /circles/:id does NOT check archived_at.
//
// Provisioned LAZILY per worker slot (only when a spec asks for the persona),
// under this run's id, and remembered in a marker file so a replacement worker
// in the same slot reuses the rows instead of racing a re-provision. Purged
// with the run.
// ===========================================================================

export const PERSONAS = [
  'premiumOwner',
  'freeOwner',
  'freeMember',
  'viewOnlyMember',
  'frozenCircleOwner',
  'archivedCircleOwner',
] as const;

export type PersonaName = (typeof PERSONAS)[number];

/** `src/lib/aiAccess.ts` resolveAiEntry: what the AI entry point does for the viewer. */
export type AiEntry = 'available' | 'upgrade' | 'hidden';

export interface ApiOutcome {
  status: number;
  /** `body.error.code` on a non-2xx. */
  code?: string;
}

/**
 * What the BACKEND must say for a persona, derived from code (file:line in the
 * header above). Constants on purpose: they are not computed from the seed, so
 * a wrongly seeded persona fails `personas.proof.spec.ts` instead of silently
 * redefining "correct".
 */
export interface PersonaExpectation {
  /** GET /api/circles/:circleId — `null` = not asserted (see archivedCircleOwner). */
  detail: {
    access_level: 'full' | 'edit' | 'view';
    can_edit: boolean;
    view_only: boolean;
    is_premium_circle: boolean;
  } | null;
  /** Is `circleId` in GET /api/circles? */
  listed: boolean;
  /** Its `read_only` there (`null` when not listed). */
  read_only: boolean | null;
  /** resolveAiEntry({ viewOnly, isPremiumCircle, isOwner }) — `null` = not asserted. */
  aiEntry: AiEntry | null;
  /** GET /api/circles/:circleId/ai/suggestions (gates before any OpenAI call). */
  aiSuggestions: ApiOutcome | null;
  /**
   * PUT /api/circles/:circleId/emergency-info with an empty body, asserted ONLY
   * where `requireCircleEditAccess` refuses (middleware/circleAccess.ts:59-89)
   * — a refusal writes nothing. `null` for editors (the call would write).
   */
  writeGate: ApiOutcome | null;
  /** GET /api/subscription-status `needsCircleSelection` (tierService.ts:504-533). */
  needsCircleSelection: boolean;
  isOwner: boolean;
  archived: boolean;
}

export const PERSONA_EXPECTATIONS: Record<PersonaName, PersonaExpectation> = {
  // Premium owner, 2 live circles (the pre-existing clone, unchanged).
  premiumOwner: {
    detail: { access_level: 'full', can_edit: true, view_only: false, is_premium_circle: true },
    listed: true,
    read_only: false,
    aiEntry: 'available',
    aiSuggestions: { status: 200 },
    writeGate: null,
    needsCircleSelection: false,
    isOwner: true,
    archived: false,
  },
  // Free owner of exactly ONE live circle, caregiver cap applied (owner + 1 active).
  // AI: 402 (routes/ai.ts:2743-2753); create circle: 402 (routes/circles.ts:438-447);
  // invite: 402 at the cap (routes/invites.ts:456-469).
  freeOwner: {
    detail: { access_level: 'edit', can_edit: true, view_only: false, is_premium_circle: false },
    listed: true,
    read_only: false,
    aiEntry: 'upgrade',
    aiSuggestions: { status: 402, code: 'SUBSCRIPTION_REQUIRED' },
    writeGate: null,
    needsCircleSelection: false,
    isOwner: true,
    archived: false,
  },
  // Non-owner editor: the EARLIEST non-owner caregiver of a free host's only circle.
  freeMember: {
    detail: { access_level: 'edit', can_edit: true, view_only: false, is_premium_circle: false },
    listed: true,
    read_only: false,
    aiEntry: 'hidden',
    aiSuggestions: { status: 402, code: 'SUBSCRIPTION_REQUIRED' },
    writeGate: null,
    needsCircleSelection: false,
    isOwner: false,
    archived: false,
  },
  // A LATER caregiver of a free host's only circle: applyCaregiverCap made the seat
  // view_only. AI: 403 VIEW_ONLY (routes/ai.ts:2655-2667); writes: 403 VIEW_ONLY.
  viewOnlyMember: {
    detail: { access_level: 'view', can_edit: false, view_only: true, is_premium_circle: false },
    listed: true,
    read_only: false,
    aiEntry: 'hidden',
    aiSuggestions: { status: 403, code: 'VIEW_ONLY' },
    writeGate: { status: 403, code: 'VIEW_ONLY' },
    needsCircleSelection: false,
    isOwner: false,
    archived: false,
  },
  // Free owner of TWO live circles, none selected on downgrade: both frozen.
  frozenCircleOwner: {
    detail: { access_level: 'view', can_edit: false, view_only: false, is_premium_circle: false },
    listed: true,
    read_only: true,
    aiEntry: 'upgrade',
    aiSuggestions: { status: 402, code: 'SUBSCRIPTION_REQUIRED' },
    writeGate: { status: 403, code: 'SUBSCRIPTION_REQUIRED' },
    needsCircleSelection: true,
    isOwner: true,
    archived: false,
  },
  // Premium owner; `circleId` is ARCHIVED (as DELETE /api/circles/:id leaves it),
  // plus one live circle. The detail route has no archived check, so its flags
  // are recorded by the proof, not asserted.
  archivedCircleOwner: {
    detail: null,
    listed: false,
    read_only: null,
    aiEntry: null,
    aiSuggestions: null,
    writeGate: null,
    needsCircleSelection: false,
    isOwner: true,
    archived: true,
  },
};

/** Rows a spec can act on in the persona's circle. `null` = the circle has none. */
export interface SeededRecords {
  /** A medication SERIES ROOT (`parent_event_id is null`). */
  medicationId: string | null;
  appointmentId: string | null;
  taskId: string | null;
  eventNoteId: string | null;
  careNoteId: string | null;
  vitalId: string | null;
  /** Backed by a real object in the `circle-documents` bucket. */
  documentId: string | null;
  emergencyInfoId: string | null;
}

/**
 * Everything a spec needs about the persona it runs as. Extends
 * `IsolatedAccount`, so it is also what the `account` fixture returns:
 * `email` / `password` / `userId` are the PERSONA's login.
 */
export interface PersonaHandle extends IsolatedAccount {
  persona: PersonaName;
  /** The circle the persona's gate applies to (= `circleIds[0]`). */
  circleId: string;
  /** Owner of `circleId` (the persona itself for owner personas). */
  ownerUserId: string;
  ownerEmail: string;
  /** Circles GET /api/circles lists for this persona. */
  liveCircleIds: string[];
  archivedCircleIds: string[];
  seeded: SeededRecords;
  expected: PersonaExpectation;
}

// ---------------------------------------------------------------------------
// Row builders
// ---------------------------------------------------------------------------

/**
 * Port of `applyCaregiverCap` (backend/src/services/tierService.ts:359-449),
 * minus the push notification: among NON-recipient members ordered by
 * `joined_at`, the owner stays active, the first non-owner stays active, every
 * later one becomes `view_only`. `id` breaks joined_at ties deterministically.
 */
export function applyCaregiverCap(circleId: string): void {
  const c = `${sqlStr(circleId)}::uuid`;
  sqlExec(`
    update circle_memberships m
       set view_only = false
      from care_circles c
     where c.id = m.circle_id and m.circle_id = ${c} and m.user_id = c.owner_id;
    with ranked as (
      select m.id, row_number() over (order by m.joined_at asc, m.id asc) as rn
        from circle_memberships m
        join care_circles c on c.id = m.circle_id
       where m.circle_id = ${c}
         and m.is_care_recipient = false
         and m.user_id <> c.owner_id
    )
    update circle_memberships t
       set view_only = (r.rn > 1)
      from ranked r
     where t.id = r.id;
  `);
}

/** Minimal valid PDF — the documents route only sniffs bytes on UPLOAD. */
const SEED_PDF = new TextEncoder().encode(
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n' +
    '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
    '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 72 72]>>endobj\n' +
    'trailer<</Root 1 0 R>>\n%%EOF\n'
);

function selectSeeded(circleId: string): SeededRecords {
  const c = `${sqlStr(circleId)}::uuid`;
  const firstEvent = (type: string) =>
    `(select id::text from calendar_events where circle_id = ${c} and event_type = ${sqlStr(type)}
       and parent_event_id is null order by id limit 1)`;
  const row = sqlRows<Record<string, string | null>>(`
    select ${firstEvent('medication')} as "medicationId",
           ${firstEvent('appointment')} as "appointmentId",
           ${firstEvent('task')} as "taskId",
           (select id::text from event_notes where circle_id = ${c} order by id limit 1) as "eventNoteId",
           (select id::text from care_notes where circle_id = ${c} order by id limit 1) as "careNoteId",
           (select id::text from health_vitals where circle_id = ${c} order by id limit 1) as "vitalId",
           (select id::text from circle_documents where circle_id = ${c} order by id limit 1) as "documentId",
           (select id::text from emergency_info where circle_id = ${c} order by id limit 1) as "emergencyInfoId"
  `)[0];
  return row as unknown as SeededRecords;
}

/**
 * The records the demo template does not carry (it has no care notes, vitals
 * or documents): one of each, authored by `authorId`, the way the app would
 * write them. The document gets a REAL Storage object at the path the upload
 * route builds (`routes/documents.ts:1108-1142`), so downloads work.
 */
async function seedMissingRecords(circleId: string, authorId: string): Promise<SeededRecords> {
  const c = `${sqlStr(circleId)}::uuid`;
  const a = `${sqlStr(authorId)}::uuid`;
  const objectName = `${circleId.toLowerCase()}/${Date.now()}.pdf`;
  await adminUpload('circle-documents', objectName, SEED_PDF, 'application/pdf');
  sqlExec(`
    insert into care_notes (circle_id, author_id, note_date, body, mood)
    select ${c}, ${a},
           (now() at time zone coalesce(
              (select u.timezone from circle_memberships m join users u on u.id = m.user_id
                where m.circle_id = ${c} and m.is_care_recipient = true limit 1),
              'America/Denver'))::date,
           'E2E persona seed note', 'good';
    insert into health_vitals (circle_id, vital_type, value1, value2, unit, recorded_at, recorded_by)
    values (${c}, 'blood_pressure', 120, 80, 'mmHg', now() - interval '1 hour', ${a});
    insert into circle_documents (circle_id, uploaded_by, label, category, file_path, file_type, file_size)
    values (${c}, ${a}, 'E2E persona seed document', 'medical_records',
            ${sqlStr(`circle-documents/${objectName}`)}, 'application/pdf', ${SEED_PDF.byteLength});
  `);
  return selectSeeded(circleId);
}

function clone(template: Template, index: number, ownerId: string): string {
  return cloneCircle({
    sourceCircleId: template.circles[index].id,
    sourceOwnerId: template.ownerId,
    newOwnerId: ownerId,
    newCircleId: randomUUID(),
  });
}

type JoinOrder = 'first' | 'last';

/**
 * Add `userId` as a plain caregiver ('member', not the recipient). `first`
 * joins before every existing non-owner caregiver, `last` after — which is
 * what decides the seat once `applyCaregiverCap` runs.
 */
function addCaregiver(circleId: string, userId: string, order: JoinOrder): void {
  const c = `${sqlStr(circleId)}::uuid`;
  const joinedAt =
    order === 'first'
      ? `(select coalesce(min(m.joined_at), now()) - interval '1 minute'
            from circle_memberships m join care_circles cc on cc.id = m.circle_id
           where m.circle_id = ${c} and m.is_care_recipient = false and m.user_id <> cc.owner_id)`
      : `greatest(now(), (select coalesce(max(m.joined_at), now()) + interval '1 minute'
            from circle_memberships m where m.circle_id = ${c}))`;
  sqlExec(`
    insert into circle_memberships (circle_id, user_id, role, is_care_recipient, joined_at, view_only)
    select ${c}, ${sqlStr(userId)}::uuid, 'member', false, ${joinedAt}, false;
  `);
}

// ---------------------------------------------------------------------------
// Provisioning
// ---------------------------------------------------------------------------

/** The e-mail token of each persona; host/helper accounts append `-host`. */
const PERSONA_TOKEN: Record<Exclude<PersonaName, 'premiumOwner'>, string> = {
  freeOwner: 'freeowner',
  freeMember: 'freemember',
  viewOnlyMember: 'viewonly',
  frozenCircleOwner: 'frozenowner',
  archivedCircleOwner: 'archivedowner',
};

function personaEmail(slot: string, token: string): string {
  return runScopedEmail(`${slot}-${token}`);
}

/** Every account of one persona group in one slot (the persona and its host). */
function personaGroupPredicate(slot: string, token: string): string {
  const base = `${ACCOUNT_PREFIX}${currentRunId()}-${slot}-${token}`;
  return `(email = ${sqlStr(`${base}@${ACCOUNT_DOMAIN}`)} or email like ${sqlStr(`${base}-%@${ACCOUNT_DOMAIN}`)})`;
}

function markerPath(slot: string, persona: PersonaName): string {
  return path.join(runDir(), 'personas', `${slot}-${persona}.json`);
}

async function account(email: string, tier: PlanTier): Promise<string> {
  return createAccount(email, tier);
}

async function provision(slot: string, persona: Exclude<PersonaName, 'premiumOwner'>): Promise<PersonaHandle> {
  const template = resolveTemplate();
  const token = PERSONA_TOKEN[persona];
  const email = personaEmail(slot, token);
  const expected = PERSONA_EXPECTATIONS[persona];
  const base = { persona, slot, email, password: ACCOUNT_PASSWORD, expected };

  switch (persona) {
    case 'freeOwner': {
      // Downgraded owner with a single circle: applyDowngrade applies the cap
      // immediately (tierService.ts:216-219).
      const userId = await account(email, 'free');
      const circleId = clone(template, 0, userId);
      applyCaregiverCap(circleId);
      const seeded = await seedMissingRecords(circleId, userId);
      return {
        ...base, userId, circleId, circleIds: [circleId], ownerUserId: userId, ownerEmail: email,
        liveCircleIds: [circleId], archivedCircleIds: [], seeded,
      };
    }
    case 'freeMember':
    case 'viewOnlyMember': {
      const hostEmail = personaEmail(slot, `${token}-host`);
      const hostId = await account(hostEmail, 'free');
      const circleId = clone(template, 0, hostId);
      const userId = await account(email, 'free');
      // freeMember joins FIRST (keeps the one free non-owner seat); the view-only
      // member joins LAST, after the template's cloned caregivers.
      addCaregiver(circleId, userId, persona === 'freeMember' ? 'first' : 'last');
      applyCaregiverCap(circleId);
      const seeded = await seedMissingRecords(circleId, hostId);
      return {
        ...base, userId, circleId, circleIds: [circleId], ownerUserId: hostId, ownerEmail: hostEmail,
        liveCircleIds: [circleId], archivedCircleIds: [], seeded,
      };
    }
    case 'frozenCircleOwner': {
      // Downgraded with 2+ circles and no selection yet: applyDowngrade writes
      // nothing else (tierService.ts:220-224); both circles derive frozen.
      const userId = await account(email, 'free');
      const circleId = clone(template, 0, userId);
      const other = clone(template, 1, userId);
      const seeded = await seedMissingRecords(circleId, userId);
      return {
        ...base, userId, circleId, circleIds: [circleId, other], ownerUserId: userId, ownerEmail: email,
        liveCircleIds: [circleId, other], archivedCircleIds: [], seeded,
      };
    }
    case 'archivedCircleOwner': {
      const userId = await account(email, 'premium');
      const circleId = clone(template, 0, userId);
      const live = clone(template, 1, userId);
      const seeded = await seedMissingRecords(circleId, userId);
      // Exactly what DELETE /api/circles/:circleId writes (routes/circles.ts:922-926).
      sqlExec(`
        update care_circles set archived_at = now(), archive_reason = 'user_deleted'
         where id = ${sqlStr(circleId)}::uuid;
      `);
      return {
        ...base, userId, circleId, circleIds: [circleId, live], ownerUserId: userId, ownerEmail: email,
        liveCircleIds: [live], archivedCircleIds: [circleId], seeded,
      };
    }
  }
}

/** The default persona's handle, built from its manifest account (no writes). */
export function premiumOwnerHandle(acct: IsolatedAccount): PersonaHandle {
  return {
    ...acct,
    persona: 'premiumOwner',
    circleId: acct.circleIds[0],
    ownerUserId: acct.userId,
    ownerEmail: acct.email,
    liveCircleIds: [...acct.circleIds],
    archivedCircleIds: [],
    seeded: selectSeeded(acct.circleIds[0]),
    expected: PERSONA_EXPECTATIONS.premiumOwner,
  };
}

/**
 * Provision `persona` for `slot` in this run, or return the rows a previous
 * worker in the same slot already provisioned. A missing marker means nothing
 * complete exists, so the persona's group is purged (a crashed half-provision)
 * and rebuilt.
 */
export async function ensurePersona(
  slot: string,
  persona: Exclude<PersonaName, 'premiumOwner'>
): Promise<PersonaHandle> {
  const marker = markerPath(slot, persona);
  if (fs.existsSync(marker)) {
    return JSON.parse(fs.readFileSync(marker, 'utf8')) as PersonaHandle;
  }
  await purgeAccountsWhere(personaGroupPredicate(slot, PERSONA_TOKEN[persona]));
  const handle = await provision(slot, persona);
  fs.mkdirSync(path.dirname(marker), { recursive: true });
  fs.writeFileSync(marker, JSON.stringify(handle, null, 2), 'utf8');
  return handle;
}

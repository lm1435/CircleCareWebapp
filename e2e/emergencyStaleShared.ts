import { expect } from '@playwright/test';
import type { Browser, BrowserContext, Locator, Page, Response } from '@playwright/test';
import { sqlExec, sqlStr } from './db';
import type { ApiSession } from './unhappy';
import {
  cookieLogin,
  createCircle,
  createInvite,
  createScopedAccount,
  membershipCount,
  ownerApi,
  uniq,
  type ScopedAccount,
} from './unhappy/auth-invites/_helpers';

// ===========================================================================
// Shared pieces of the PK5 "stale editor" specs for emergency CONTACTS,
// DOCTORS and INSURANCE plans (flows/emergency-stale-edit.spec.ts,
// flows/emergency-stale-delete.spec.ts). The Medical-info twin is
// flows/emergency-concurrent-edit.spec.ts; the world seeding, the two browser
// contexts and the PUT matcher are the same shapes it uses.
//
//   A = the OWNER, whose browser holds the stale view and edits/deletes through
//       the REAL UI.
//   B = a second caregiver; B's change is made through the API (a background
//       write is fine: the unit under test is A's UI).
//
// FALSIFY. PW_FALSIFY=emergency-stale (every test) or
// PW_FALSIFY=emergency-stale:<test id> skips B's background change, so A's save
// is NOT stale: the "A is refused" assertion must go red. Test ids are listed
// in the specs.
// ===========================================================================

export type Json = Record<string, unknown>;
export type ArrayField = 'emergency_contacts' | 'additional_doctors' | 'insurance_plans';
export type Lang = 'en' | 'es';

const FALSIFY = new Set((process.env.PW_FALSIFY ?? '').split(',').filter(Boolean));
export const falsify = (id: string): boolean =>
  FALSIFY.has('emergency-stale') || FALSIFY.has(`emergency-stale:${id}`);

export interface World {
  owner: ScopedAccount;
  member: ScopedAccount;
  circleId: string;
  /** A's API session (owner): used to READ the server, never to write the stale change. */
  ownerSession: ApiSession;
  /** B's API session (the other caregiver): used to make the background change. */
  memberSession: ApiSession;
}

/** What the circle holds before the test starts: two entries per array, so the second is the bystander. */
export const SEED = {
  emergency_contacts: [
    { name: 'Ana Seed', relationship: 'Daughter', phone: '(303) 555-0101', country_code: '+1' },
    { name: 'Ben Seed', relationship: 'Son', phone: '(303) 555-0102', country_code: '+1' },
  ],
  additional_doctors: [
    { name: 'Dr Cho Seed', specialty: 'Cardiology', phone: '(303) 555-0111', country_code: '+1', address: null },
    { name: 'Dr Diaz Seed', specialty: 'Neurology', phone: '(303) 555-0112', country_code: '+1', address: null },
  ],
  insurance_plans: [
    { carrier: 'Aetna Seed', label: 'Medical', policy_number: 'P-100', phone: '(303) 555-0131', country_code: '+1', is_primary: false },
    { carrier: 'Cigna Seed', label: 'Dental', policy_number: 'P-200', phone: '(303) 555-0132', country_code: '+1', is_primary: false },
  ],
  primary_doctor_name: 'Dr Prim Seed',
  primary_doctor_specialty: 'Family medicine',
  primary_doctor_phone: '(303) 555-0120',
  primary_doctor_country_code: '+1',
  primary_doctor_address: '1 Main St',
  blood_type: 'O+',
  allergies: ['Seeded'],
} as const;

export interface Kind {
  id: 'contact' | 'doctor' | 'insurance';
  field: ArrayField;
  /** The key that names an entry (the editor re-finds its entry by it). */
  nameKey: 'name' | 'carrier';
  /** The input holding the entry's name (it must still read the entry's name after a reload). */
  nameInput: string;
  /** The text input inside the editor that A and B both change. */
  input: string;
  /** The entry key that input maps to. */
  valueKey: string;
  /** B's value (written through the API) and A's two attempts (typed in the UI). */
  bValue: string;
  aValue: string;
  aValue2: string;
  /** An entry B inserts AHEAD of the seeded ones (the list "moves"). */
  inserted: Json;
  /** A THIRD entry (not in SEED) for the tests that need [first, second, third]. */
  third: Json;
}

export const KINDS: Kind[] = [
  {
    id: 'contact',
    field: 'emergency_contacts',
    nameKey: 'name',
    nameInput: '#contact-name',
    input: '#contact-relationship',
    valueKey: 'relationship',
    bValue: 'Sister B-wrote',
    aValue: 'Niece A-stale',
    aValue2: 'Niece A-again',
    inserted: { name: 'Zed Inserted', relationship: 'Cousin', phone: '(303) 555-0155', country_code: '+1' },
    third: { name: 'Cara Seed', relationship: 'Niece', phone: '(303) 555-0103', country_code: '+1' },
  },
  {
    id: 'doctor',
    field: 'additional_doctors',
    nameKey: 'name',
    nameInput: '#doctor-name',
    input: '#doctor-specialty',
    valueKey: 'specialty',
    bValue: 'Oncology B-wrote',
    aValue: 'Radiology A-stale',
    aValue2: 'Radiology A-again',
    inserted: { name: 'Dr Inserted', specialty: 'Dermatology', phone: '(303) 555-0156', country_code: '+1', address: null },
    third: { name: 'Dr Eze Seed', specialty: 'Oncology', phone: '(303) 555-0113', country_code: '+1', address: null },
  },
  {
    id: 'insurance',
    field: 'insurance_plans',
    nameKey: 'carrier',
    nameInput: '#insurance-carrier',
    input: '#insurance-policy',
    valueKey: 'policy_number',
    bValue: 'P-B-900',
    aValue: 'P-A-111',
    aValue2: 'P-A-222',
    inserted: { carrier: 'Humana Inserted', label: 'Vision', policy_number: 'P-300', phone: '(303) 555-0157', country_code: '+1', is_primary: false },
    third: { carrier: 'Humana Seed', label: 'Vision', policy_number: 'P-300', phone: '(303) 555-0133', country_code: '+1', is_primary: false },
  },
];

/** Every string the specs read, in both languages (src/i18n/{en,es}/emergency.json). */
export const COPY = {
  en: {
    heading: 'Emergency Info',
    save: 'Save',
    del: 'Delete',
    actionsFor: 'Actions for',
    edit: 'Edit',
    delete: 'Delete',
    noun: { contact: 'contact', doctor: 'doctor', insurance: 'insurance' },
    removeTitle: {
      contact: 'Remove contact',
      doctor: 'Remove doctor',
      insurance: 'Remove insurance',
      primary: 'Remove primary doctor',
    },
    primaryTitle: 'Primary doctor',
    toastTitle: 'Someone else updated this',
    toastBody: 'Another caregiver changed this section while you were editing. We loaded the latest version. Review it and make your change again.',
  },
  es: {
    heading: 'Información de emergencia',
    save: 'Guardar',
    del: 'Eliminar',
    actionsFor: 'Acciones para',
    edit: 'Editar',
    delete: 'Eliminar',
    noun: { contact: 'contacto', doctor: 'doctor', insurance: 'seguro' },
    removeTitle: {
      contact: 'Quitar contacto',
      doctor: 'Quitar doctor',
      insurance: 'Quitar seguro',
      primary: 'Quitar doctor principal',
    },
    primaryTitle: 'Doctor principal',
    toastTitle: 'Alguien más actualizó esto',
    toastBody: 'Otro cuidador cambió esta sección mientras la editabas. Cargamos la versión más reciente. Revísala y vuelve a hacer tu cambio.',
  },
} as const;
export type Copy = (typeof COPY)[Lang];

export const entryName = (kind: Kind, entry: Json): string => String(entry[kind.nameKey]);
export const seedOf = (kind: Kind): Json[] => SEED[kind.field].map((e) => ({ ...e }));

/** Owner + second caregiver in a fresh circle that already holds the SEED (so the row exists). */
export async function world(
  request: Parameters<typeof ownerApi>[0],
  opts: { ownerLanguage?: Lang } = {}
): Promise<World> {
  const owner = await createScopedAccount('pk5s-owner');
  if (opts.ownerLanguage && opts.ownerLanguage !== 'en') {
    sqlExec(
      `update public.users set language = ${sqlStr(opts.ownerLanguage)}, language_set_at = now() where id = ${sqlStr(owner.userId)}::uuid;`
    );
  }
  const ownerSession = await ownerApi(request, owner);
  const circleId = await createCircle(ownerSession, uniq('pk5s'));
  const member = await createScopedAccount('pk5s-member');
  const memberSession = await ownerApi(request, member);
  const invite = await createInvite(ownerSession, circleId);
  const acc = await memberSession.post(`/api/invites/code/${invite.code}/accept`);
  expect(acc.status(), await acc.text()).toBeLessThan(300);
  expect(membershipCount(circleId, member.userId)).toBe(1);
  const seed = await ownerSession.put(`/api/circles/${circleId}/emergency-info`, SEED);
  expect(seed.ok(), await seed.text()).toBe(true);
  return { owner, member, circleId, ownerSession, memberSession };
}

export async function loggedInPage(
  browser: Browser,
  account: ScopedAccount,
  baseURL: string | undefined,
  circleId: string,
  lang: Lang = 'en'
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ baseURL });
  await cookieLogin(context, account, baseURL);
  const page = await context.newPage();
  await page.goto(`/circles/${circleId}/emergency`, { waitUntil: 'domcontentloaded' });
  if (lang === 'es') await expect(page.locator('html')).toHaveAttribute('lang', /^es/, { timeout: 20_000 });
  await expect(page.getByRole('heading', { level: 1, name: COPY[lang].heading })).toBeVisible({ timeout: 20_000 });
  return { context, page };
}

export async function serverInfo(api: ApiSession, circleId: string): Promise<Json> {
  const res = await api.get(`/api/circles/${circleId}/emergency-info`);
  expect(res.ok(), `GET emergency-info -> ${res.status()}`).toBe(true);
  return ((await res.json()) as { data: { emergency_info: Json } }).data.emergency_info;
}

export async function serverArray(api: ApiSession, circleId: string, field: ArrayField): Promise<Json[]> {
  return ((await serverInfo(api, circleId))[field] as Json[] | null) ?? [];
}

/** B's background write: the whole array replaced (the same wholesale PUT the clients send). No `if_match`. */
export async function putAs(api: ApiSession, circleId: string, body: Json): Promise<void> {
  const res = await api.put(`/api/circles/${circleId}/emergency-info`, body);
  expect(res.ok(), `B's background PUT -> ${res.status()} ${await res.text()}`).toBe(true);
}

/** B changes ONE key of the entry at `index` (read-modify-write, like a client). */
export async function bChangesEntry(w: World, kind: Kind, index: number, patch: Json): Promise<void> {
  const current = await serverArray(w.memberSession, w.circleId, kind.field);
  const next = current.map((e, i) => (i === index ? { ...e, ...patch } : e));
  await putAs(w.memberSession, w.circleId, { [kind.field]: next });
}

/** B inserts `entry` AHEAD of everything, so every later entry moves down one position. */
export async function bInsertsFirst(w: World, kind: Kind, entry: Json): Promise<void> {
  const current = await serverArray(w.memberSession, w.circleId, kind.field);
  await putAs(w.memberSession, w.circleId, { [kind.field]: [entry, ...current] });
}

/** B removes the entry at `index`. */
export async function bRemovesEntry(w: World, kind: Kind, index: number): Promise<void> {
  const current = await serverArray(w.memberSession, w.circleId, kind.field);
  await putAs(w.memberSession, w.circleId, { [kind.field]: current.filter((_, i) => i !== index) });
}

export const isPut = (circleId: string) => (r: Response): boolean =>
  r.request().method() === 'PUT' && new URL(r.url()).pathname === `/api/circles/${circleId}/emergency-info`;

export const waitPut = (page: Page, circleId: string): Promise<Response> =>
  page.waitForResponse(isPut(circleId), { timeout: 30_000 });

export const names = (kind: Kind, list: Json[]): string[] => list.map((e) => entryName(kind, e));

/** Open an entry's "..." menu on the list and pick Edit or Delete (by the entry's NAME, never by position). */
export async function openEntryAction(
  page: Page,
  copy: Copy,
  noun: string,
  name: string,
  action: 'edit' | 'delete'
): Promise<void> {
  await page.getByRole('button', { name: `${copy.actionsFor} ${name}`, exact: true }).click();
  await page.getByRole('menuitem', { name: `${copy[action]} ${noun} ${name}`, exact: true }).click();
}

/** The conflict toast, in the language under test. */
export function conflictToast(page: Page, copy: Copy): Locator {
  return page.getByRole('alert').filter({ hasText: copy.toastTitle });
}

export async function expectConflictToast(page: Page, copy: Copy): Promise<void> {
  const toast = conflictToast(page, copy);
  await expect(toast).toBeVisible({ timeout: 15_000 });
  await expect(toast).toContainText(`${copy.toastTitle}.`);
  await expect(toast).toContainText(copy.toastBody);
}

/** The 409 body: code, the conflicting field(s) and the server's CURRENT versions. */
export async function expectRefused(res: Response, fields: string[]): Promise<{ versions: Record<string, string> }> {
  expect(res.status(), 'the stale save is refused (409), not applied').toBe(409);
  const body = (await res.json()) as {
    error: { code: string; details: { fields: string[]; versions: Record<string, string> } };
  };
  expect(body.error.code).toBe('EMERGENCY_INFO_CHANGED');
  expect(body.error.details.fields).toEqual(fields);
  return { versions: body.error.details.versions };
}

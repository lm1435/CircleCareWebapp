/**
 * ISOLATED demo data for the WEB how-to video (use-on-a-computer). Help-videos RECIPE.md, "Web video".
 *
 *   SEED_BACKEND_URL=http://localhost:4298/api node e2e/howto/seed-web.mjs en|es [--reset]   (from CircleCare-dark/webapp)
 *   SEED_BACKEND_URL=http://localhost:4298/api node e2e/howto/seed-web.mjs en|es --remove
 *
 * Why its own accounts: the iPhone takes (mobile/.maestro/howto: take.mjs -> baseline.mjs -> each video's reset.mjs)
 * reset the `howto.*@circlecare.test` circles before every take. This script NEVER reads or writes those accounts, their
 * circles, mobile/.maestro/howto/state/* or state/clock.json. It works only on its own five accounts
 * (sarah.mitchell@, tom.mitchell@, lisa.mitchell@, ana.garcia@, miguel.garcia@example.com; the :4298 backend blocks
 * example.com, so no email can leave) and writes its ids to e2e/howto/state/web-<lang>.json.
 *
 * Same cast as the phone videos:
 *   en: Margaret Mitchell, cared for by Sarah (owner, signs in on the web), Tom and Lisa.
 *   es: Carmen García, cared for by Ana (owner) and Miguel.
 * Same clean baseline as baseline.mjs (BANNER-AUDIT.md): a daytime demo zone on every member (the browser runs in the
 * same zone: Playwright timezoneId), owner = medication-responsible, one non-Expo push token per member (never sent),
 * the four baseline calendar entries, emergency info + two care notes, two doctors with past visits and notes. Plus two
 * evening medications (dose times still ahead today, so nothing reads Overdue). Creation activity rows are deleted.
 * --reset deletes ONLY the howto.web.* accounts of this language (and their circles) first; --remove deletes them.
 * Prints the state JSON on the last line.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { api, sbAdmin, dbSelect, dbUpdate, dbDelete, rest, signIn } from '../../../mobile/.maestro/parity/_harness/lib/local.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const lang = process.argv[2] === 'es' ? 'es' : 'en';
const RESET = process.argv.includes('--reset');
const REMOVE = process.argv.includes('--remove');
const PASSWORD = 'HowToDemo-2026!';
if (!/:4298\//.test(process.env.SEED_BACKEND_URL || '')) throw new Error('set SEED_BACKEND_URL=http://localhost:4298/api');

// ---- demo zone: daytime now (same rule as mobile/.maestro/howto/clock.mjs, but never writes its state file) ----
const ZONES = [
  'America/Denver', 'America/Chicago', 'America/New_York', 'America/Los_Angeles', 'America/Mexico_City',
  'Pacific/Pago_Pago', 'Pacific/Honolulu', 'America/Anchorage', 'America/Phoenix', 'America/Bogota', 'America/Halifax',
  'America/Sao_Paulo', 'Atlantic/Azores', 'Europe/London', 'Europe/Madrid', 'Europe/Athens', 'Asia/Dubai',
  'Asia/Karachi', 'Asia/Dhaka', 'Asia/Bangkok', 'Asia/Shanghai', 'Asia/Tokyo', 'Australia/Brisbane',
  'Pacific/Noumea', 'Pacific/Fiji', 'Pacific/Auckland', 'Pacific/Tongatapu',
];
export function nowIn(tz, at = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(at).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour) * 60 + Number(p.minute), hhmm: `${p.hour}:${p.minute}` };
}
function localIso(date, hhmm, tz) {
  const guess = Date.parse(`${date}T${hhmm}:00Z`);
  const wallAt = (t) => { const n = nowIn(tz, new Date(t)); return Date.parse(`${n.date}T${n.hhmm}:00Z`); };
  return new Date(guess - (wallAt(guess) - guess)).toISOString();
}
const addDays = (ymd, n) => { const d = new Date(`${ymd}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
function webZone() {
  const ok = (z) => { const m = nowIn(z).minutes; return m >= 9 * 60 + 30 && m < 15 * 60; };
  return ZONES.slice(0, 5).find(ok) || ZONES.map((z) => [z, Math.abs(nowIn(z).minutes - 11 * 60)]).sort((a, b) => a[1] - b[1])[0][0];
}

const SETS = {
  en: {
    recipient: 'Margaret Mitchell', dob: '1944-06-02',
    members: [
      { key: 'owner', first: 'Sarah', last: 'Mitchell' },
      { key: 'tom', first: 'Tom', last: 'Mitchell' },
      { key: 'lisa', first: 'Lisa', last: 'Mitchell' },
    ],
    primary: { name: 'Dr. Brooks', specialty: 'Primary care', phone: '(555) 010-0142', country_code: '+1', address: '88 Linden Avenue, Suite 2', is_primary: true },
    cardio: { name: 'Dr. Patel', specialty: 'Cardiology', phone: '(555) 010-0177', country_code: '+1', address: '1200 Heart Center Dr, Suite 410', is_primary: false },
    visits: [
      [-210, '09:30', 'Echocardiogram', ['tom', 'Echo done. Everything looks stable, no changes.']],
      [-15, '09:00', 'Blood pressure check', ['owner', 'BP looked good. Keep current dose.']],
    ],
    // [key, type, title, dayOffset, time, provider]  (= mobile/.maestro/howto/baseline.mjs CALENDAR)
    calendar: [
      ['task', 'Pick up prescriptions', 0, null, null],
      ['task', 'Short walk around the block', 1, '10:00', null],
      ['appointment', 'Cardiology follow-up', 6, '10:30', 'cardio'],
      ['appointment', 'Flu shot', 13, '09:30', 'primary'],
    ],
    meds: [['Lisinopril', '10 mg', '20:00'], ['Metformin', '500 mg', '21:00']],
    care: {
      medication_allergies: ['Penicillin'], allergies: [], medical_conditions: ['High blood pressure'], blood_type: 'A+',
      emergency_contacts: [{ name: 'Tom Mitchell', relationship: 'Son', phone: '(720) 555-0134', country_code: '+1', is_primary: true }],
    },
    notes: [
      ['lisa', 5, 'Good day. Walked to the mailbox and back, and ate a full lunch.', 'good'],
      ['tom', 2, 'A little tired this afternoon. Took a nap and felt better by dinner.', 'okay'],
    ],
  },
  es: {
    recipient: 'Carmen García', dob: '1946-02-11',
    members: [
      { key: 'owner', first: 'Ana', last: 'García' },
      { key: 'miguel', first: 'Miguel', last: 'García' },
    ],
    primary: { name: 'Dra. Ruiz', specialty: 'Medicina familiar', phone: '(555) 010-0163', country_code: '+52', address: 'Calle Robles 88, Consultorio 2', is_primary: true },
    cardio: { name: 'Dr. Herrera', specialty: 'Cardiología', phone: '(555) 010-0188', country_code: '+52', address: 'Av. del Corazón 1200, Consultorio 410', is_primary: false },
    visits: [
      [-210, '11:00', 'Ecocardiograma', ['miguel', 'Ya se hizo el eco. Todo se ve estable, sin cambios.']],
      [-15, '09:00', 'Revisión de la presión', ['owner', 'La presión salió bien. Seguir con la dosis actual.']],
    ],
    calendar: [
      ['task', 'Recoger medicamentos en la farmacia', 0, null, null],
      ['task', 'Caminata corta por la cuadra', 1, '10:00', null],
      ['appointment', 'Control de cardiología', 6, '10:30', 'cardio'],
      ['appointment', 'Vacuna contra la influenza', 13, '09:30', 'primary'],
    ],
    meds: [['Lisinopril', '10 mg', '20:00'], ['Metformina', '500 mg', '21:00']],
    care: {
      medication_allergies: ['Penicilina'], allergies: [], medical_conditions: ['Presión alta'], blood_type: 'O+',
      emergency_contacts: [{ name: 'Miguel García', relationship: 'Hijo', phone: '(555) 555-0147', country_code: '+52', is_primary: true }],
    },
    notes: [
      ['miguel', 5, 'Buen día. Caminó hasta la esquina y comió bien.', 'good'],
      ['owner', 2, 'Un poco cansada en la tarde. Durmió una siesta y se sintió mejor.', 'okay'],
    ],
  },
}[lang];
// Natural-looking addresses (they are typed on screen and listed on Members) on example.com, the reserved documentation
// domain, which the :4298 backend also blocks. Never tom@ / miguel@example.com: invite-family invites those.
const ascii = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const emailOf = (m) => `${ascii(m.first)}.${ascii(m.last)}@example.com`;
const J = (v) => JSON.stringify(v).slice(0, 300);
async function must(p, what) {
  const r = await p;
  if (!r || r.__status >= 300) throw new Error(`${what}: ${r?.__status} ${J(r)}`);
  return r;
}

async function removeAccounts() {
  let n = 0;
  for (const m of SETS.members) {
    const email = emailOf(m);
    for (const u of await dbSelect('users', `select=id&email=eq.${encodeURIComponent(email)}`)) {
      await dbDelete('care_circles', `owner_id=eq.${u.id}`).catch(() => {});
    }
  }
  for (const m of SETS.members) {
    for (const u of await dbSelect('users', `select=id&email=eq.${encodeURIComponent(emailOf(m))}`)) {
      await dbDelete('push_tokens', `user_id=eq.${u.id}`).catch(() => {});
      await dbDelete('circle_memberships', `user_id=eq.${u.id}`).catch(() => {});
      await dbDelete('users', `id=eq.${u.id}`).catch(() => {});
      await sbAdmin('DELETE', `/auth/v1/admin/users/${u.id}`, undefined, { allowFail: true });
      n++;
    }
  }
  return n;
}

if (REMOVE) { console.log(JSON.stringify({ lang, removed: await removeAccounts() })); process.exit(0); }
if (RESET) await removeAccounts();

// The web Calendar always prints "Times shown in <city>", so the zone must be believable for the cast: Los Angeles (EN)
// and Tijuana (ES) by default, the latest US / Mexican wall clocks. --tz overrides; webZone() is the any-zone fallback.
// Refuses outside 09:00-18:30 local (the Home daily-update "This evening" card starts at 19:00).
const tzArg = process.argv.includes('--tz') ? process.argv[process.argv.indexOf('--tz') + 1] : null;
const tz = tzArg === 'auto' ? webZone() : tzArg || { en: 'America/Los_Angeles', es: 'America/Tijuana' }[lang];
{ const m = nowIn(tz).minutes; if (m < 9 * 60 || m > 18 * 60 + 30) throw new Error(`${tz} is ${nowIn(tz).hhmm}: not daytime; pass --tz <zone> or --tz auto`); }
const today = nowIn(tz).date;
const people = {};
for (const m of SETS.members) {
  const email = emailOf(m);
  const created = await sbAdmin('POST', '/auth/v1/admin/users', {
    email, password: PASSWORD, email_confirm: true, user_metadata: { first_name: m.first, last_name: m.last },
  });
  if (!created?.id) throw new Error(`could not create ${email}: ${J(created)} (already there? use --reset)`);
  for (let i = 0; i < 20 && !(await dbSelect('users', `select=id&id=eq.${created.id}`)).length; i++) await new Promise((r) => setTimeout(r, 200));
  await dbUpdate('users', 'id', created.id, {
    first_name: m.first, last_name: m.last, timezone: tz, language: lang, language_set_at: new Date().toISOString(), plan_tier: 'premium',
  });
  people[m.key] = { ...m, email, id: created.id, token: await signIn(email, PASSWORD) };
}
const owner = people.owner;
const circleId = (await must(api('POST', '/circles', owner.token, { recipient_name: SETS.recipient, recipient_dob: SETS.dob }), 'circle')).data.circle.id;
for (const m of SETS.members.slice(1)) {
  const p = people[m.key];
  const inv = await must(api('POST', `/circles/${circleId}/invites`, owner.token, { email: p.email, role: 'member' }), `invite ${p.email}`);
  await must(api('POST', `/invites/${inv.data.invite.id}/accept`, p.token), `accept ${p.email}`);
}
const primaryId = (await must(api('POST', `/circles/${circleId}/providers`, owner.token, SETS.primary), 'primary')).data.provider.id;
const cardioId = (await must(api('POST', `/circles/${circleId}/providers`, owner.token, SETS.cardio), 'cardio')).data.provider.id;
for (const [off, time, title, [who, body]] of SETS.visits) {
  const date = addDays(today, off);
  const ev = await must(api('POST', `/circles/${circleId}/events`, owner.token, {
    event_type: 'appointment', title, scheduled_date: date, scheduled_time: time, duration_minutes: 30, location: SETS.cardio.address, provider_id: cardioId,
  }), `visit ${date}`);
  const id = ev.data.event.id;
  const n = await must(api('POST', `/circles/${circleId}/events/${id}/notes`, people[who].token, { body }), `note ${date}`);
  const noteId = n.data?.note?.id ?? n.data?.id;
  if (noteId) await dbUpdate('event_notes', 'id', noteId, { created_at: localIso(date, '14:30', tz) });
  await must(api('POST', `/circles/${circleId}/events/${id}/complete`, owner.token, {}), `complete ${date}`);
}
for (const [type, title, off, time, prov] of SETS.calendar) {
  const body = { event_type: type, title, scheduled_date: addDays(today, off), ...(time ? { scheduled_time: time } : {}) };
  if (type === 'appointment') Object.assign(body, { duration_minutes: 30, provider_id: prov === 'cardio' ? cardioId : primaryId });
  await must(api('POST', `/circles/${circleId}/events`, owner.token, body), title);
}
for (const [name, dose, time] of SETS.meds) {
  await must(api('POST', `/circles/${circleId}/events`, owner.token, {
    event_type: 'medication', title: name, medication_name: name, medication_dosage: dose, scheduled_date: today, scheduled_time: time, recurrence_rule: 'daily',
  }), name);
}
await must(api('PUT', `/circles/${circleId}/emergency-info`, owner.token, SETS.care), 'emergency info');
for (const [who, daysAgo, body, mood] of SETS.notes) {
  await must(api('POST', `/circles/${circleId}/care-notes`, people[who].token, { body, mood, note_date: addDays(today, -daysAgo) }), `care note ${who}`);
}
await must(api('PUT', `/circles/${circleId}/medication-responsible`, owner.token, { userId: owner.id }), 'medication-responsible');
await rest('POST', 'push_tokens?on_conflict=user_id,device_token',
  Object.values(people).map((p) => ({ user_id: p.id, device_token: `howto-web-demo-${p.key}`, platform: 'ios', is_active: true, updated_at: new Date().toISOString() })),
  { prefer: 'resolution=merge-duplicates,return=minimal' });
// Creation rows would crowd the Overview's activity with "X added Y" from one second ago.
await dbDelete('activity_feed', `circle_id=eq.${circleId}`);

const state = {
  lang, password: PASSWORD, tz, today, circleId, primaryId, cardioId, recipient: SETS.recipient,
  owner: { email: owner.email, id: owner.id }, members: Object.fromEntries(Object.values(people).map((p) => [p.key, p.email])),
};
mkdirSync(join(here, 'state'), { recursive: true });
writeFileSync(join(here, 'state', `web-${lang}.json`), JSON.stringify(state, null, 2));
console.log(JSON.stringify(state));

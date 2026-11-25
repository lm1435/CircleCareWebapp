import { test, expect } from '../fixtures';
import { sqlExec } from '../db';
import { ensurePersona } from '../personas';
import { apiSession, dbQuery, sqlStr } from '../unhappy';
import { cookieLogin } from '../unhappy/auth-invites/_helpers';

// A CARE RECIPIENT who joined a circle by invite (non-owner, is_care_recipient = true) may edit ONLY the
// circle's recipient name and date of birth (1.4.4). Persona `careRecipientMember`: a premium host's circle,
// the persona is its single recipient (name 'Rita Recipient', DOB 1950-03-15 seeded). The host is the OWNER of
// that same circle, so the owner regression logs in as the host. Every test resets name + DOB first, so reruns
// are idempotent. `persona` is a worker option and may only be set at file top level.

test.use({ persona: 'careRecipientMember' });
test.describe.configure({ mode: 'serial' });

const SEED_NAME = 'Rita Recipient';
const SEED_DOB = '1950-03-15';
const NEW_DOB = '1948-11-02';
const NEW_NAME = 'Rita R. Recipient';

interface Row {
  name: string;
  recipient_name: string;
  recipient_dob: string | null;
  timezone: string | null;
}
const circleRow = (circleId: string): Row =>
  dbQuery<Row>(
    `select name, recipient_name, recipient_dob::text as recipient_dob, timezone
       from care_circles where id = ${sqlStr(circleId)}::uuid`
  )[0];

function reset(circleId: string, dob: string | null = SEED_DOB): void {
  sqlExec(
    `update care_circles set recipient_name = ${sqlStr(SEED_NAME)},
            recipient_dob = ${dob ? `${sqlStr(dob)}::date` : 'null'}
      where id = ${sqlStr(circleId)}::uuid`
  );
}

test.beforeEach(({ circleId }) => reset(circleId));

test('POSITIVE: recipient at 390px sees the gear, edits name + DOB only, saves, and a reload keeps it', async ({
  page,
  circleId,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/circles/${circleId}`, { waitUntil: 'domcontentloaded' });
  const gear = page.getByTestId('today-circle-settings');
  await expect(gear).toBeVisible({ timeout: 20_000 });
  await gear.click();
  await expect(page).toHaveURL(new RegExp(`/circles/${circleId}/settings$`));

  const name = page.getByLabel('Care recipient name');
  const dob = page.getByLabel('Date of birth', { exact: true });
  await expect(name).toHaveValue(SEED_NAME, { timeout: 20_000 });
  await expect(dob).toHaveValue(SEED_DOB);
  // Recipient mode: name + DOB only.
  await expect(page.getByText('Time zone', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Danger zone')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Delete circle/ })).toHaveCount(0);
  await expect(page.getByText('Only the circle owner can edit this')).toHaveCount(0);

  await name.fill(NEW_NAME);
  await dob.fill(NEW_DOB);
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Circle updated.')).toBeVisible({ timeout: 20_000 });

  await expect.poll(() => circleRow(circleId).recipient_dob, { timeout: 15_000 }).toBe(NEW_DOB);
  expect(circleRow(circleId).recipient_name).toBe(NEW_NAME);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByLabel('Care recipient name')).toHaveValue(NEW_NAME, { timeout: 20_000 });
  await expect(page.getByLabel('Date of birth', { exact: true })).toHaveValue(NEW_DOB);
});

test('POSITIVE: at xl the sidebar "Circle Settings" link reaches the same recipient form', async ({
  page,
  circleId,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/circles/${circleId}`, { waitUntil: 'domcontentloaded' });
  // The header gear is a below-xl affordance.
  await expect(page.getByTestId('today-circle-settings')).toBeHidden();
  const link = page.getByRole('link', { name: 'Circle Settings' });
  await expect(link).toBeVisible({ timeout: 20_000 });
  await link.click();
  await expect(page).toHaveURL(new RegExp(`/circles/${circleId}/settings$`));
  await expect(page.getByLabel('Care recipient name')).toHaveValue(SEED_NAME, { timeout: 20_000 });
  await expect(page.getByLabel('Date of birth', { exact: true })).toHaveValue(SEED_DOB);
  await expect(page.getByText('Time zone', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Danger zone')).toHaveCount(0);
});

test('POSITIVE: Emergency info offers "Add date of birth" to the recipient when the DOB is empty; saving works', async ({
  page,
  circleId,
}) => {
  reset(circleId, null);
  expect(circleRow(circleId).recipient_dob).toBeNull();
  await page.goto(`/circles/${circleId}/emergency`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Add date of birth' }).click({ timeout: 20_000 });
  const dialog = page.getByRole('dialog', { name: 'Add date of birth' });
  await dialog.getByLabel('Date of birth', { exact: true }).fill(NEW_DOB);
  await dialog.getByTestId('recipient-dob-save').click();
  await expect(dialog).toBeHidden({ timeout: 20_000 });
  await expect.poll(() => circleRow(circleId).recipient_dob, { timeout: 15_000 }).toBe(NEW_DOB);
  await expect(page.getByRole('button', { name: 'Add date of birth' })).toHaveCount(0);
});

test('NEGATIVE: Emergency info does not offer "Add date of birth" to the recipient when a DOB exists', async ({
  page,
  circleId,
}) => {
  await page.goto(`/circles/${circleId}/emergency`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('March 15, 1950')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('button', { name: 'Add date of birth' })).toHaveCount(0);
});

test('NEGATIVE: a plain member sees no gear and gets the owner-only notice (no form, no Save)', async ({
  page,
  context,
  personaHandle,
  baseURL,
}) => {
  const member = await ensurePersona(personaHandle.slot, 'freeMember');
  await context.clearCookies();
  await cookieLogin(context, member, baseURL);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/circles/${member.circleId}`, { waitUntil: 'domcontentloaded' });
  // The header's other action renders in the same row, so the absence below is not vacuous.
  await expect(page.getByTestId('today-account-settings')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('today-circle-settings')).toHaveCount(0);

  await page.goto(`/circles/${member.circleId}/settings`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('Only the circle owner can edit this')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByLabel('Care recipient name')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Save changes' })).toHaveCount(0);
});

test('NEGATIVE: API refuses the recipient PATCH of timezone and name with 403 and the circle is unchanged', async ({
  request,
  personaHandle,
  circleId,
}) => {
  const before = circleRow(circleId);
  const api = await apiSession(request, personaHandle);
  const tz = await api.patch(`/api/circles/${circleId}`, { timezone: 'Asia/Tokyo' });
  expect(tz.status()).toBe(403);
  const nm = await api.patch(`/api/circles/${circleId}`, { name: 'Hijacked circle' });
  expect(nm.status()).toBe(403);
  // A mixed body is refused whole: the allowed field must not slip through.
  const mixed = await api.patch(`/api/circles/${circleId}`, {
    recipient_dob: NEW_DOB,
    timezone: 'Asia/Tokyo',
  });
  expect(mixed.status()).toBe(403);
  expect(circleRow(circleId)).toEqual(before);
});

test('REGRESSION: the premium owner still gets the full form (time zone card + danger zone)', async ({
  page,
  context,
  personaHandle,
  circleId,
  baseURL,
}) => {
  await context.clearCookies();
  await cookieLogin(context, { email: personaHandle.ownerEmail, password: personaHandle.password }, baseURL);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/circles/${circleId}`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('today-circle-settings')).toBeVisible({ timeout: 20_000 });
  await page.goto(`/circles/${circleId}/settings`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByLabel('Care recipient name')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('Time zone', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Danger zone')).toBeVisible();
  await expect(page.getByText('Only the circle owner can edit this')).toHaveCount(0);
});

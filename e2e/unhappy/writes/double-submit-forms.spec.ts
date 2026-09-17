import { test, expect, uniqueLabel } from '../../fixtures';
import { sqlExec } from '../../db';
import { dbCount, dbQuery, sqlStr } from '../../unhappy';
import { doubleSubmitWhileHeld, successToast } from './_helpers';

// DOUBLE SUBMIT WHILE PENDING — modal/page forms: vital add (VitalFormModal),
// emergency info (EditMedicalInfoModal + EditContactModal), circle settings
// (EditCirclePage) and invite member (InviteMemberModal).
//
// A duplicate vital is indistinguishable from a real second measurement; a
// duplicate invite burns rate limit and answers itself with a pending-seat
// error; the emergency/settings PUT/PATCH is a wasted premium write and a
// second activity entry. Each test: hold, double-activate (same tick and while
// pending), release, exactly ONE request, and the row state in the database.

test.use({ persona: 'premiumOwner' });

test('vital add: double save while the POST is pending logs one reading', async ({ page, circleId }) => {
  const note = uniqueLabel('DS vital');
  const bpm = 240 + Math.floor(Math.random() * 50);
  try {
    await page.goto(`/circles/${circleId}/vitals`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Add reading' }).first().click();
    const dialog = page.getByRole('dialog', { name: 'Add reading' });
    await expect(dialog).toBeVisible({ timeout: 20_000 });
    await dialog.locator('#vital_type').selectOption('heart_rate');
    await dialog.locator('#value1').fill(String(bpm));
    await dialog.locator('#notes').fill(note);
    await doubleSubmitWhileHeld(page, {
      method: 'POST',
      path: '/api/circles/:id/vitals',
      submit: dialog.getByRole('button', { name: 'Save reading', exact: true }),
      form: page.locator('#vital-form'),
    });
    await expect(dialog).toBeHidden({ timeout: 20_000 });
    expect(
      dbCount(`select 1 from health_vitals where circle_id = ${sqlStr(circleId)}::uuid and notes = ${sqlStr(note)}`)
    ).toBe(1);
  } finally {
    sqlExec(`delete from health_vitals where circle_id = ${sqlStr(circleId)}::uuid and notes = ${sqlStr(note)};`);
  }
});

test('emergency medical info: double save while the PUT is pending sends one PUT', async ({ page, circleId }) => {
  const allergy = uniqueLabel('DS allergy');
  const c = `${sqlStr(circleId)}::uuid`;
  try {
    await page.goto(`/circles/${circleId}/emergency`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Emergency Info' })).toBeVisible({ timeout: 20_000 });
    await page.getByRole('button', { name: 'Edit medical information' }).first().click();
    const dialog = page.getByRole('dialog', { name: 'Medical information' });
    await expect(dialog).toBeVisible({ timeout: 20_000 });
    const input = dialog.locator('#allergies-input');
    await input.fill(allergy);
    await input.press('Enter');
    await expect(dialog.getByRole('button', { name: `Remove ${allergy}` })).toBeVisible();
    await doubleSubmitWhileHeld(page, {
      method: 'PUT',
      path: '/api/circles/:id/emergency-info',
      submit: dialog.getByRole('button', { name: 'Save', exact: true }),
      form: page.locator('#edit-medical-form'),
    });
    await expect(dialog).toBeHidden({ timeout: 20_000 });
    expect(dbCount(`select 1 from emergency_info where circle_id = ${c}`)).toBe(1);
    expect(dbCount(`select 1 from emergency_info where circle_id = ${c} and ${sqlStr(allergy)} = any(allergies)`)).toBe(1);
  } finally {
    sqlExec(`update emergency_info set allergies = array_remove(allergies, ${sqlStr(allergy)}) where circle_id = ${c};`);
  }
});

test('emergency contact add: double save while the PUT is pending adds one contact', async ({ page, circleId }) => {
  const name = uniqueLabel('DS contact');
  const c = `${sqlStr(circleId)}::uuid`;
  const contactsNamed = `select 1 from emergency_info e, jsonb_array_elements(coalesce(e.emergency_contacts, '[]'::jsonb)) x
     where e.circle_id = ${c} and x->>'name' = ${sqlStr(name)}`;
  try {
    await page.goto(`/circles/${circleId}/emergency`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Emergency Info' })).toBeVisible({ timeout: 20_000 });
    await page.getByRole('button', { name: 'Add contact' }).first().click();
    const dialog = page.getByRole('dialog', { name: 'Add emergency contact' });
    await expect(dialog).toBeVisible({ timeout: 20_000 });
    await dialog.locator('#contact-name').fill(name);
    await dialog.locator('#contact-relationship').fill('Friend');
    await dialog.locator('#contact-phone').fill('5555550100');
    await doubleSubmitWhileHeld(page, {
      method: 'PUT',
      path: '/api/circles/:id/emergency-info',
      submit: dialog.getByRole('button', { name: 'Save', exact: true }),
      form: page.locator('#edit-contact-form'),
    });
    await expect(dialog).toBeHidden({ timeout: 20_000 });
    expect(dbCount(contactsNamed)).toBe(1);
  } finally {
    sqlExec(`update emergency_info set emergency_contacts = (
               select coalesce(jsonb_agg(x), '[]'::jsonb) from jsonb_array_elements(coalesce(emergency_contacts, '[]'::jsonb)) x
                where x->>'name' <> ${sqlStr(name)})
             where circle_id = ${c};`);
  }
});

test('circle settings: double save while the PATCH is pending sends one PATCH', async ({ page, circleId }) => {
  const c = `${sqlStr(circleId)}::uuid`;
  const [{ recipient_name: original }] = dbQuery<{ recipient_name: string }>(
    `select recipient_name from care_circles where id = ${c}`
  );
  const renamed = uniqueLabel('DS circle');
  try {
    await page.goto(`/circles/${circleId}/settings`, { waitUntil: 'domcontentloaded' });
    const nameField = page.locator('#recipient_name');
    await expect(nameField).toHaveValue(original, { timeout: 20_000 });
    await nameField.fill(renamed);
    const form = page.locator('form').filter({ has: nameField });
    await doubleSubmitWhileHeld(page, {
      method: 'PATCH',
      path: '/api/circles/:id',
      submit: form.getByRole('button', { name: 'Save changes', exact: true }),
      form,
    });
    await expect(successToast(page, 'Circle updated.')).toHaveCount(1, { timeout: 20_000 });
    expect(dbCount(`select 1 from care_circles where id = ${c} and recipient_name = ${sqlStr(renamed)}`)).toBe(1);
  } finally {
    sqlExec(`update care_circles set recipient_name = ${sqlStr(original)} where id = ${c};`);
  }
});

test('invite member: double send while the POST is pending creates one invite', async ({ page, circleId }) => {
  const email = `e2e-ds-invite-${Date.now()}-${Math.floor(Math.random() * 1e4)}@example.com`;
  const invites = `select 1 from invites where circle_id = ${sqlStr(circleId)}::uuid and invited_email = ${sqlStr(email)}`;
  try {
    await page.goto(`/circles/${circleId}/members`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Members' })).toBeVisible({ timeout: 20_000 });
    await page.getByRole('button', { name: 'Invite member' }).first().click();
    const dialog = page.getByRole('dialog', { name: 'Invite a member' });
    await expect(dialog).toBeVisible({ timeout: 20_000 });
    await dialog.locator('#invite-email').fill(email);
    await doubleSubmitWhileHeld(page, {
      method: 'POST',
      path: '/api/circles/:id/invites',
      submit: dialog.getByRole('button', { name: 'Send invite', exact: true }),
      form: page.locator('#invite-member-form'),
    });
    await expect(dialog.getByText('Invitation sent')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('alert')).toHaveCount(0);
    expect(dbCount(invites)).toBe(1);
  } finally {
    sqlExec(`delete from invites where circle_id = ${sqlStr(circleId)}::uuid and invited_email = ${sqlStr(email)};`);
  }
});

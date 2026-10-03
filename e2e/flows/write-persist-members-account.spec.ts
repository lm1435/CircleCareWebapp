import type { Locator, Page } from '@playwright/test';
import { test, expect, uniqueLabel } from '../fixtures';
import { sqlExec } from '../db';
import { purgeAccount, purgeAccountsWhere } from '../isolation';
import { dbCount, dbQuery, sqlStr } from '../unhappy';
import { MINIMAL_PDF, circleNameOf, gotoCirclePage, rx } from '../unhappy/access/_helpers';
import {
  authUserCount,
  cookieLogin,
  createCircle,
  createInvite,
  createScopedAccount,
  expireInvite,
  hasRefreshCookie,
  ownerApi,
  uniq,
} from '../unhappy/auth-invites/_helpers';

// ===========================================================================
// WRITE PERSISTENCE — members, documents, downgrade selection, account deletion.
//
// A database write gate is about to be armed, so every web write needs one test
// that performs it FOR REAL through the UI (no stubbing of the write) and then
// proves it PERSISTED two ways: the database row (dbQuery, polled) and a page
// reload / fresh API read. These paths had no such test:
//
//   1. cancel an invite         DELETE /api/invites/:id
//                               -> invites.status = 'cancelled' (the row is kept)
//   2. resend an expired invite POST   /api/invites/:id/resend
//                               -> invites.expires_at moved ~7 days out, same row + code
//   3. rename + delete a document   PATCH/DELETE /api/circles/:c/documents/:d
//                               -> circle_documents.label / row gone + Storage object gone
//   4. keep one circle on downgrade POST /api/subscription-status/select-downgrade-circle
//                               -> care_circles.selected_on_downgrade on exactly that circle
//   5. delete the account       DELETE /api/users/me (routes/users.ts performAccountDeletion)
//                               -> auth user gone, public.users anonymised in place, owned
//                                  circle hard-deleted (cascade), signed out, login refused
//
// Every test uses its OWN run-scoped account (createScopedAccount: purged by
// globalTeardown) and its own circles, so nothing touches the shared worker
// clones. Every "now" is the database clock, never the runner's. Invite
// addresses are @example.com (the backend never mails them).
//
// FALSIFY: PW_FALSIFY=write-persist-members-account answers EVERY write above
// with a fake 2xx at the browser (the backend never sees it), so the UI behaves
// as if it saved. Under it the post-write assertions are SOFT, so one run
// reports every database and reload assertion going red. Narrower hooks fake a
// single write: write-persist-members-account:<cancel-invite | resend-invite |
// doc-rename | doc-delete | keep-circle | delete-account>.
// ===========================================================================

test.use({ storageState: { cookies: [], origins: [] } });
test.setTimeout(120_000);

const HOOK = 'write-persist-members-account';
const FALSIFY_SET = new Set((process.env.PW_FALSIFY ?? '').split(',').filter(Boolean));
const FALSIFYING = [...FALSIFY_SET].some((n) => n === HOOK || n.startsWith(`${HOOK}:`));
const faked = (write: string) => FALSIFY_SET.has(HOOK) || FALSIFY_SET.has(`${HOOK}:${write}`);

/** Post-write assertions: hard normally; soft under PW_FALSIFY so every one of them gets to go red. */
const after = expect.configure({ soft: FALSIFYING });
/** Wait for the app to reflect a result (shorter under PW_FALSIFY, where it never will). */
const SETTLE = FALSIFYING ? 4_000 : 20_000;
const POLL = FALSIFYING ? 4_000 : 15_000;

/** FALSIFY only: answer `method` + path with a canned 200 and let nothing through to the backend. */
async function pretendSaved(
  page: Page,
  write: string,
  method: string,
  path: RegExp,
  body: unknown
): Promise<void> {
  if (!faked(write)) return;
  await page.route(
    (url) => path.test(url.pathname),
    async (route) => {
      if (route.request().method() !== method) {
        await route.fallback();
        return;
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    }
  );
}

const uuid = (id: string) => `${sqlStr(id)}::uuid`;

/** The browser's response to `method` + `path`, started BEFORE the click that fires it. */
function responseTo(page: Page, method: string, path: RegExp) {
  return page.waitForResponse(
    (r) => r.request().method() === method && path.test(new URL(r.url()).pathname),
    { timeout: 20_000 }
  );
}

interface InviteRow {
  id: string;
  status: string;
  invite_code: string;
  invited_email: string;
  /** Computed by the database clock. */
  lapsed: boolean;
  /** expires_at is more than 6 days away (a fresh invite lives 7). */
  renewed: boolean;
}

function inviteRows(circleId: string, email: string): InviteRow[] {
  return dbQuery<InviteRow>(
    `select id::text as id, status, invite_code, invited_email,
            (expires_at < now()) as lapsed,
            (expires_at > now() + interval '6 days') as renewed
       from invites
      where circle_id = ${uuid(circleId)} and invited_email = ${sqlStr(email)}`
  );
}

function inviteRow(circleId: string, email: string): InviteRow {
  const rows = inviteRows(circleId, email);
  expect(rows, `exactly one invite row for ${email}`).toHaveLength(1);
  return rows[0];
}

async function openMembers(page: Page, circleId: string): Promise<void> {
  await page.goto(`/circles/${circleId}/members`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Members' })).toBeVisible({ timeout: 20_000 });
}

function inviteActions(page: Page, email: string): Locator {
  return page.getByRole('button', { name: `Actions for invite to ${email}` });
}

const INVITE_RE = /^\/api\/invites\/[^/]+$/;
const RESEND_RE = /^\/api\/invites\/[^/]+\/resend$/;
const DOC_RE = /^\/api\/circles\/[^/]+\/documents\/[^/]+$/;
const SELECT_RE = /^\/api\/subscription-status\/select-downgrade-circle$/;
const ME_RE = /^\/api\/users\/me$/;

// ---------------------------------------------------------------------------
// 1. Cancel an invite
// ---------------------------------------------------------------------------

test('cancel an invite through the Members page: invites.status = cancelled, and it is gone after a reload', async ({
  page,
  request,
  context,
  baseURL,
}) => {
  const acct = await createScopedAccount('wp-cancel');
  const api = await ownerApi(request, acct);
  const circleId = await createCircle(api, uniq('wp-cancel'));
  const email = `e2e-wp-cancel-${Date.now().toString(36)}@example.com`;
  await cookieLogin(context, acct, baseURL);
  await openMembers(page, circleId);

  // Send a real invite through the modal, so the row under test is the one the
  // product itself wrote (and the cancel below has something real to retire).
  await page.getByRole('button', { name: 'Invite member' }).first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible({ timeout: 20_000 });
  await dialog.locator('#invite-email').fill(email);
  await dialog.getByRole('button', { name: 'Send invite' }).click();
  await expect(dialog.getByText('Invitation sent')).toBeVisible({ timeout: 20_000 });
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(dialog).toBeHidden({ timeout: 20_000 });
  await expect(inviteActions(page, email)).toBeVisible({ timeout: 20_000 });

  const before = inviteRow(circleId, email);
  expect(before.status, 'the invite starts pending').toBe('pending');

  await pretendSaved(page, 'cancel-invite', 'DELETE', INVITE_RE, {
    success: true,
    data: { message: 'Invite cancelled successfully' },
  });

  // --- Cancel it in the UI (menu -> confirm) ---
  await inviteActions(page, email).click();
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  await menu.getByRole('menuitem', { name: 'Cancel invite', exact: true }).click();
  const confirm = page.getByRole('dialog');
  await expect(confirm).toBeVisible({ timeout: 10_000 });
  const cancelled = responseTo(page, 'DELETE', INVITE_RE);
  await confirm.getByRole('button', { name: 'Cancel invite', exact: true }).click();
  expect((await cancelled).status(), 'DELETE /api/invites/:id').toBe(200);

  // --- (1) the database: the backend retires the row (status), it does not delete it ---
  await after
    .poll(() => inviteRow(circleId, email).status, { message: 'invites.status after the cancel', timeout: POLL })
    .toBe('cancelled');
  after(inviteRow(circleId, email).id, 'the same row, not a new one').toBe(before.id);
  await after(inviteActions(page, email)).toHaveCount(0, { timeout: SETTLE });

  // --- (2) a fresh API read and a reload: it does not come back ---
  const detail = await api.get(`/api/circles/${circleId}`);
  expect(detail.status()).toBe(200);
  const pending = ((await detail.json()) as { data: { circle: { pending_invites?: Array<{ invited_email: string }> } } })
    .data.circle.pending_invites;
  after((pending ?? []).map((i) => i.invited_email), 'pending_invites from GET /api/circles/:id').not.toContain(email);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Members' })).toBeVisible({ timeout: 20_000 });
  // Positive control first: the roster rendered (the owner is listed), so the absence
  // below is about the invite and not about a page that has not loaded yet.
  await expect(page.getByText(acct.email, { exact: true }).first()).toBeVisible({ timeout: 20_000 });
  await after(inviteActions(page, email)).toHaveCount(0, { timeout: SETTLE });
  await after(page.getByText(email)).toHaveCount(0, { timeout: SETTLE });
});

// ---------------------------------------------------------------------------
// 2. Resend an expired invite
// ---------------------------------------------------------------------------

test('resend an expired invite through the Members page: expires_at moves ~7 days out, same pending row and code, no longer Expired after a reload', async ({
  page,
  request,
  context,
  baseURL,
}) => {
  const acct = await createScopedAccount('wp-resend');
  const api = await ownerApi(request, acct);
  const circleId = await createCircle(api, uniq('wp-resend'));
  const invite = await createInvite(api, circleId);
  const email = dbQuery<{ invited_email: string }>(
    `select invited_email from invites where id = ${uuid(invite.id)}`
  )[0].invited_email;

  // There is no endpoint that ages an invite, so lapse the REAL row in the
  // database (no response is rewritten anywhere): the backend itself reports
  // it as expired, and the Resend that follows is its genuine answer.
  expireInvite(invite.id);
  const lapsed = inviteRow(circleId, email);
  expect(lapsed.lapsed, 'the invite is expired in the database').toBe(true);
  expect(lapsed.renewed).toBe(false);
  expect(lapsed.status).toBe('pending');

  await cookieLogin(context, acct, baseURL);
  await openMembers(page, circleId);
  const row = page.locator('li', { hasText: email });
  await expect(row.getByText('Expired', { exact: true })).toBeVisible({ timeout: 20_000 });

  await pretendSaved(page, 'resend-invite', 'POST', RESEND_RE, {
    success: true,
    data: {
      invite: {
        id: invite.id,
        invited_email: email,
        member_type: 'caregiver',
        expires_at: new Date(Date.now() + 7 * 864e5).toISOString(),
        is_expired: false,
      },
      email_sent: false,
    },
  });

  await inviteActions(page, email).click();
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  const resend = responseTo(page, 'POST', RESEND_RE);
  await menu.getByRole('menuitem', { name: 'Resend', exact: true }).click();
  expect((await resend).status(), 'POST /api/invites/:id/resend').toBe(200);

  // --- (1) the database: a new expiry ~7 days out, everything else untouched ---
  await after
    .poll(() => inviteRow(circleId, email).renewed, {
      message: 'invites.expires_at moved 6+ days into the future after the resend',
      timeout: POLL,
    })
    .toBe(true);
  const now = inviteRow(circleId, email);
  after(now.lapsed, 'no longer expired in the database').toBe(false);
  expect(now.id, 'the same invite row (resend revives it, it does not create another)').toBe(invite.id);
  expect(now.status).toBe('pending');
  expect(now.invite_code, 'the invite code is NOT rotated (the original email link keeps working)').toBe(
    invite.code
  );
  expect(dbCount(`select 1 from invites where circle_id = ${uuid(circleId)}`), 'no second invite row').toBe(1);

  // --- (2) a fresh API read and a reload: the backend reports it live, the badge is gone ---
  const detail = await api.get(`/api/circles/${circleId}`);
  expect(detail.status()).toBe(200);
  const listed = (
    (await detail.json()) as {
      data: { circle: { pending_invites: Array<{ invited_email: string; is_expired: boolean }> } };
    }
  ).data.circle.pending_invites.find((i) => i.invited_email === email);
  expect(listed, 'the invite is still listed as pending').toBeTruthy();
  after(listed!.is_expired, 'is_expired from GET /api/circles/:id').toBe(false);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Members' })).toBeVisible({ timeout: 20_000 });
  await expect(inviteActions(page, email)).toBeVisible({ timeout: 20_000 });
  await after(page.locator('li', { hasText: email }).getByText('Expired', { exact: true })).toHaveCount(0, {
    timeout: SETTLE,
  });
  // Resend is offered only while an invite is expired, so its absence is the reload proof.
  await inviteActions(page, email).click();
  const liveMenu = page.getByRole('menu');
  await expect(liveMenu.getByRole('menuitem', { name: 'Cancel invite', exact: true })).toBeVisible();
  await after(liveMenu.getByRole('menuitem', { name: 'Resend', exact: true })).toHaveCount(0, { timeout: SETTLE });
});

// ---------------------------------------------------------------------------
// 3. Rename and delete a document
// ---------------------------------------------------------------------------

test('rename then delete a document through the Documents page: label and row persisted, Storage object removed', async ({
  page,
  request,
  context,
  baseURL,
}) => {
  const acct = await createScopedAccount('wp-doc');
  const circleId = await createCircle(await ownerApi(request, acct), uniq('wp-doc'));
  const name = uniqueLabel('Doc');
  const renamed = `${name} renamed`;
  await cookieLogin(context, acct, baseURL);

  const docRows = (label: string) =>
    dbQuery<{ id: string; label: string; category: string; file_path: string; uploaded_by: string }>(
      `select id::text as id, label, category, file_path, uploaded_by::text as uploaded_by
         from circle_documents where circle_id = ${uuid(circleId)} and label = ${sqlStr(label)}`
    );
  const objectCount = (filePath: string) =>
    dbCount(
      `select 1 from storage.objects
        where bucket_id = 'circle-documents' and name = ${sqlStr(filePath.replace(/^circle-documents\//, ''))}`
    );
  const openMenu = async (label: string) => {
    await page.getByRole('button', { name: new RegExp(`Options for ${rx(label)}`) }).click();
    const menu = page.getByRole('menu');
    await expect(menu).toBeVisible();
    return menu;
  };
  const heading = page.getByRole('heading', { name: 'Documents', exact: true });

  await page.goto(`/circles/${circleId}/documents`, { waitUntil: 'domcontentloaded' });
  await expect(heading).toBeVisible({ timeout: 20_000 });

  // --- Upload (setup, and itself checked: a row + a real Storage object) ---
  await page.getByRole('button', { name: 'Upload document' }).first().click();
  const upload = page.getByRole('dialog');
  await expect(upload).toBeVisible();
  await upload.locator('input[type="file"]').setInputFiles({
    name: `e2e-wp-doc-${Date.now()}.pdf`,
    mimeType: 'application/pdf',
    buffer: MINIMAL_PDF,
  });
  await upload.locator('#document-upload-label').fill(name);
  await upload.locator('#document-upload-category').selectOption('medical_records');
  await upload.getByRole('button', { name: 'Upload', exact: true }).click();
  await expect(upload).toBeHidden({ timeout: 30_000 });
  await expect(page.getByText(name).first()).toBeVisible({ timeout: 30_000 });

  const uploaded = docRows(name);
  expect(uploaded, 'the uploaded document row').toHaveLength(1);
  expect(uploaded[0].uploaded_by).toBe(acct.userId);
  expect(uploaded[0].category).toBe('medical_records');
  const filePath = uploaded[0].file_path;
  expect(objectCount(filePath), 'the uploaded file is in Storage').toBe(1);

  // --- Rename ---
  await pretendSaved(page, 'doc-rename', 'PATCH', DOC_RE, {
    success: true,
    data: { document: { id: uploaded[0].id, label: renamed } },
  });
  await (await openMenu(name)).getByRole('menuitem', { name: 'Edit', exact: true }).click();
  const edit = page.getByRole('dialog');
  await expect(edit).toBeVisible();
  await edit.locator('#document-edit-label').fill(renamed);
  const patched = responseTo(page, 'PATCH', DOC_RE);
  await edit.getByRole('button', { name: 'Save', exact: true }).click();
  expect((await patched).status(), 'PATCH document').toBe(200);

  // (1) the database
  await after
    .poll(() => docRows(renamed).length, { message: 'circle_documents.label after the rename', timeout: POLL })
    .toBe(1);
  after(docRows(renamed)[0]?.id, 'renamed in place (same row)').toBe(uploaded[0].id);
  after(docRows(name), 'nothing left under the old label').toHaveLength(0);
  after(docRows(renamed)[0]?.file_path, 'the file itself is untouched').toBe(filePath);

  // (2) a reload
  await expect(edit).toBeHidden({ timeout: 20_000 });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(heading).toBeVisible({ timeout: 20_000 });
  await after(page.getByText(renamed).first()).toBeVisible({ timeout: SETTLE });
  await after(page.getByText(name, { exact: true })).toHaveCount(0, { timeout: SETTLE });

  // --- Delete ---
  await pretendSaved(page, 'doc-delete', 'DELETE', DOC_RE, {
    success: true,
    data: { message: 'Document deleted successfully' },
  });
  // (Differs from `renamed` only when the rename itself was faked.)
  const current = docRows(renamed).length === 1 ? renamed : name;
  await (await openMenu(current)).getByRole('menuitem', { name: 'Delete', exact: true }).click();
  const confirm = page.getByRole('dialog');
  await expect(confirm).toBeVisible();
  const deleted = responseTo(page, 'DELETE', DOC_RE);
  await confirm.getByRole('button', { name: 'Delete', exact: true }).click();
  expect((await deleted).status(), 'DELETE document').toBe(200);

  // (1) the database + Storage
  await after
    .poll(() => docRows(current).length, { message: 'circle_documents row after the delete', timeout: POLL })
    .toBe(0);
  after(dbCount(`select 1 from circle_documents where id = ${uuid(uploaded[0].id)}`), 'the row is gone by id').toBe(0);
  await after
    .poll(() => objectCount(filePath), { message: 'Storage object after the delete', timeout: POLL })
    .toBe(0);

  // (2) a reload
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(heading).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('button', { name: 'Upload document' }).first()).toBeVisible({ timeout: 20_000 });
  await after(page.getByText(current)).toHaveCount(0, { timeout: SETTLE });
});

// ---------------------------------------------------------------------------
// 4. Downgrade circle selection
// ---------------------------------------------------------------------------

test('keep one circle on downgrade through the picker banner: selected_on_downgrade persisted, kept circle editable, the other frozen after a reload', async ({
  page,
  request,
  context,
  baseURL,
}) => {
  const acct = await createScopedAccount('wp-keep');
  const api = await ownerApi(request, acct);
  // Two circles are created while the owner is still premium (a free owner cannot create a
  // second one), then the account is downgraded exactly as e2e/personas.ts seeds
  // frozenCircleOwner: plan_tier free, neither circle selected.
  const keepId = await createCircle(api, uniq('wp-keep'));
  const otherId = await createCircle(api, uniq('wp-other'));
  sqlExec(`update public.users set plan_tier = 'free' where id = ${uuid(acct.userId)};`);
  const keepName = circleNameOf(keepId);
  const otherName = circleNameOf(otherId);

  const selected = (id: string) =>
    dbQuery<{ selected_on_downgrade: boolean }>(
      `select selected_on_downgrade from care_circles where id = ${uuid(id)}`
    )[0].selected_on_downgrade;
  expect([selected(keepId), selected(otherId)], 'neither circle is selected before').toEqual([false, false]);

  await cookieLogin(context, acct, baseURL);
  await page.goto('/circles', { waitUntil: 'domcontentloaded' });
  const banner = page
    .getByRole('status')
    .filter({ hasText: 'Your subscription ended. Choose which circle to keep with free access.' });
  await expect(banner).toBeVisible({ timeout: 20_000 });
  for (const name of [keepName, otherName]) {
    await expect(
      page.getByRole('link', { name: new RegExp(`^Open ${rx(name)} .*Read-only`) }),
      `${name} starts frozen`
    ).toBeVisible({ timeout: 20_000 });
  }

  await pretendSaved(page, 'keep-circle', 'POST', SELECT_RE, { success: true });

  // --- Choose, confirm ---
  await banner.getByRole('button', { name: 'Choose circle' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('radio', { name: new RegExp(rx(keepName)) }).check();
  await dialog.getByRole('button', { name: 'Confirm selection' }).click();
  await expect(dialog.getByText(keepName, { exact: true })).toBeVisible();
  const chosen = responseTo(page, 'POST', SELECT_RE);
  await dialog.getByRole('button', { name: 'Keep this circle' }).click();
  expect((await chosen).status(), 'POST select-downgrade-circle').toBe(200);

  // --- (1) the database: exactly the chosen circle, nothing else touched ---
  await after
    .poll(() => selected(keepId), {
      message: 'care_circles.selected_on_downgrade of the kept circle',
      timeout: POLL,
    })
    .toBe(true);
  after(selected(otherId), 'the other circle is NOT selected').toBe(false);
  after(
    dbCount(`select 1 from care_circles where owner_id = ${uuid(acct.userId)} and selected_on_downgrade`),
    'exactly one selected circle'
  ).toBe(1);
  expect(
    dbQuery<{ plan_tier: string }>(`select plan_tier from public.users where id = ${uuid(acct.userId)}`)[0].plan_tier,
    'still a free account'
  ).toBe('free');
  await after(dialog).toBeHidden({ timeout: SETTLE });
  await after(banner).toHaveCount(0, { timeout: SETTLE });

  // --- (2) a reload: the prompt is gone, the kept circle is no longer read-only, the other still is ---
  await page.reload({ waitUntil: 'domcontentloaded' });
  const keptCard = page.getByRole('link', { name: new RegExp(`^Open ${rx(keepName)}`) });
  const otherCard = page.getByRole('link', { name: new RegExp(`^Open ${rx(otherName)} .*Read-only`) });
  await expect(keptCard).toBeVisible({ timeout: 20_000 });
  await expect(otherCard).toBeVisible({ timeout: 20_000 });
  await after(keptCard).not.toHaveAccessibleName(/Read-only/, { timeout: SETTLE });
  await after(page.getByRole('status').filter({ hasText: 'Choose which circle to keep' })).toHaveCount(0, {
    timeout: SETTLE,
  });

  const canEdit = async (id: string) => {
    const res = await api.get(`/api/circles/${id}`);
    expect(res.status(), `GET /api/circles/${id}`).toBe(200);
    return ((await res.json()) as { data: { circle: { can_edit: boolean } } }).data.circle.can_edit;
  };
  after(await canEdit(keepId), 'kept circle: can_edit').toBe(true);
  after(await canEdit(otherId), 'other circle: can_edit').toBe(false);

  // The same facts as the user sees them, after the reload: a write control in the kept
  // circle, none in the frozen one (gotoCirclePage proves the gating flags were applied
  // before it lets an absence count).
  const addEvent = page.getByRole('button', { name: 'Add event', exact: true });
  await gotoCirclePage(page, keepId, 'calendar');
  await after(addEvent).toBeVisible({ timeout: SETTLE });
  await gotoCirclePage(page, otherId, 'calendar');
  await expect(page.getByRole('heading', { name: 'Calendar', exact: true }).first()).toBeVisible({ timeout: 20_000 });
  await expect(addEvent).toHaveCount(0);
});

// ---------------------------------------------------------------------------
// 5. Delete the account
// ---------------------------------------------------------------------------

test('delete the account through the Profile page: auth user gone, public.users anonymised, owned circle deleted, signed out, old credentials refused', async ({
  page,
  request,
  context,
  baseURL,
}) => {
  const acct = await createScopedAccount('wp-acct');
  const api = await ownerApi(request, acct);
  const circleId = await createCircle(api, uniq('wp-acct'));
  const invite = await createInvite(api, circleId);
  const anonymisedEmail = `deleted-${acct.userId}@removed.local`;

  try {
    // Preconditions, from the database: a live account that owns one circle with one member.
    expect(authUserCount(acct.email), 'auth user exists').toBe(1);
    expect(dbCount(`select 1 from care_circles where id = ${uuid(circleId)} and owner_id = ${uuid(acct.userId)}`)).toBe(1);
    expect(dbCount(`select 1 from circle_memberships where circle_id = ${uuid(circleId)}`)).toBe(1);
    expect(dbCount(`select 1 from invites where id = ${uuid(invite.id)}`)).toBe(1);

    await cookieLogin(context, acct, baseURL);
    await page.goto('/profile', { waitUntil: 'domcontentloaded' });
    await expect(page.getByText(acct.email, { exact: true })).toBeVisible({ timeout: 20_000 });

    await pretendSaved(page, 'delete-account', 'DELETE', ME_RE, {
      success: true,
      data: { message: 'Account deleted successfully' },
    });

    // --- The full UI flow: danger-zone button -> confirmation dialog -> confirm ---
    await page.getByRole('button', { name: 'Delete my account' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('Delete your account?')).toBeVisible();
    await expect(dialog.getByText(/every care circle you own/)).toBeVisible();
    // Backing out writes nothing. (The × close button carries the same accessible name, so
    // the footer button is picked by its text.)
    await dialog.locator('button', { hasText: 'Keep my account' }).click();
    await expect(dialog).toBeHidden();
    expect(authUserCount(acct.email), 'cancelling the dialog deletes nothing').toBe(1);

    await page.getByRole('button', { name: 'Delete my account' }).click();
    await expect(dialog).toBeVisible();
    const deleted = responseTo(page, 'DELETE', ME_RE);
    await dialog.getByRole('button', { name: 'Delete account', exact: true }).click();
    expect((await deleted).status(), 'DELETE /api/users/me').toBe(200);

    // --- (1) the database, as performAccountDeletion (routes/users.ts) leaves it ---
    await after
      .poll(() => authUserCount(acct.email), { message: 'auth.users row for the deleted account', timeout: POLL })
      .toBe(0);
    after(dbCount(`select 1 from auth.users where id = ${uuid(acct.userId)}`), 'auth user gone by id').toBe(0);
    // public.users is ANONYMISED in place (FK integrity), not deleted.
    const user = dbQuery<{ email: string; first_name: string; last_name: string; withdrawn: boolean }>(
      `select email, first_name, last_name, (analytics_consent_withdrawn_at is not null) as withdrawn
         from public.users where id = ${uuid(acct.userId)}`
    );
    expect(user, 'the public.users row survives (anonymised, not deleted)').toHaveLength(1);
    after(user[0], 'public.users anonymised in place').toEqual({
      email: anonymisedEmail,
      first_name: 'Deleted',
      last_name: 'User',
      withdrawn: true,
    });
    // The owned circle is HARD-deleted and everything hanging off it cascades.
    after(dbCount(`select 1 from care_circles where id = ${uuid(circleId)}`), 'owned circle deleted').toBe(0);
    after(dbCount(`select 1 from care_circles where owner_id = ${uuid(acct.userId)}`), 'no circle owned').toBe(0);
    after(dbCount(`select 1 from circle_memberships where circle_id = ${uuid(circleId)}`), 'memberships cascade').toBe(0);
    after(dbCount(`select 1 from invites where circle_id = ${uuid(circleId)}`), 'its invites cascade').toBe(0);

    // --- (2) the browser: signed out, and the old credentials do not work ---
    await after(page).toHaveURL(/\/login$/, { timeout: SETTLE });
    await after(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible({ timeout: SETTLE });
    await after
      .poll(() => hasRefreshCookie(context), { message: 'the refresh cookie was cleared', timeout: SETTLE })
      .toBe(false);
    await page.goto('/circles', { waitUntil: 'domcontentloaded' });
    await after(page).toHaveURL(/\/login/, { timeout: SETTLE });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await after(page).toHaveURL(/\/login/, { timeout: SETTLE });

    const relogin = await request.post('/api/auth/login', {
      data: { email: acct.email, password: acct.password },
    });
    after(relogin.ok(), 'login with the deleted account credentials').toBe(false);
    after([400, 401], `login status ${relogin.status()}`).toContain(relogin.status());
    const body = (await relogin.json()) as { data?: { session?: unknown } };
    after(body.data?.session !== undefined, 'a session is issued').toBe(false);
  } finally {
    // The anonymised public.users row is not matched by the run-scoped e-mail sweep, so remove it
    // here (best effort), together with anything the deletion did not take.
    await purgeAccountsWhere(`email = ${sqlStr(anonymisedEmail)}`).catch(() => undefined);
    await purgeAccount(acct.email).catch(() => undefined);
  }
});

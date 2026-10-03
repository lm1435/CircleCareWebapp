import type { APIRequestContext, Locator, Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { sqlExec, sqlStr } from '../db';
import { countRequests, dbCount, dbQuery } from '../unhappy';
import {
  cookieLogin,
  createCircle,
  createInvite,
  createScopedAccount,
  expireInvite,
  inviteStatus,
  membershipCount,
  ownerApi,
  uniq,
  type ScopedAccount,
} from '../unhappy/auth-invites/_helpers';
import { successToast } from '../unhappy/writes/_helpers';

// W6 (row "W6 accept names and opens the circle"): JOIN BY CODE FROM THE CIRCLE
// PICKER (`JoinCircleModal`, src/components/circles/JoinCircleModal.tsx). The
// landing-page and pending-invite accept paths are covered by
// unhappy/auth-invites/invites.spec.ts; the code-entry modal was not driven.
//
//   (1) HAPPY, a user with NO circle: picker empty state -> "Join with an invite
//       code" -> type the code (lower case: the field upper-cases it) -> "Find
//       circle" -> preview names the circle, the recipient, the inviter and the
//       role -> "Join circle" -> toast "You've joined <circle>." and the circle is
//       open with its NAME in the header switcher. One lookup, one accept; the
//       membership and the accepted invite are checked in the DB.
//   (2) ERRORS (EN and ES), a user who already has TWO circles (so the picker
//       stays and the header "Join a circle" button is the way in):
//         - a code nobody issued              -> "couldn't find that invite code"
//         - an EXPIRED invite                 -> "This invite has expired"
//         - an invite the owner CANCELLED     -> "already been used"
//         - an invite addressed to someone who then DELETED their account, lapsed:
//           before the deletion it reads "expired"; afterwards the backend has
//           cancelled it (routes/users.ts scrubDeletedUserLeftovers: a lapsed
//           pending invite is set to 'cancelled'), and the code answers
//           INVITE_ALREADY_USED, so the modal says "already been used"
//         - an invite cancelled BETWEEN look-up and join (accept-time error, the
//           preview stays and says so)
//         - then a good code in the same session lands in the circle.
//       Editing the code clears the message.
//   (3) RE-TYPING over a filled code (`OtpInput`, the shared six-box field). A rejected code stays in
//       the boxes; the person clicks the first box and types the whole code again with one
//       character fixed. Every other position EQUALS the old character, and a keystroke equal to
//       the box's own character used to fire no change event, so the field neither advanced nor took
//       the rest of the code (11 of 60 random re-types lost keystrokes). Covered: the realistic
//       reject -> re-type -> preview flow, the bare ABC234 -> ABC235 re-type, and a keyboard that
//       inserts text without key events (IME / dictation / soft keyboard).
//
// People are located by NAME and role; nothing relies on member order.
//
// Run-scoped accounts only (`runScopedEmail`, purged at teardown). Invites go to
// @example.com (never mailed); the lapsed-invite case re-addresses ONE invite in
// the DB to the account that then deletes itself, so no mail can leave.
//
// FALSIFY: PW_FALSIFY=join-by-code removes the precondition of every case (the
// invite is never cancelled / expired / deleted-for, the code is a live one), so
// each error assertion and the happy path (whose invite is cancelled before use)
// must go red. PW_FALSIFY=join-by-code:<step> targets one step:
//   happy | unknown | expired | cancelled | deleted | accept
// Proven against the app too (JoinCircleModal.tsx edited in place, then restored
// byte-identical, 10-02): with the INVITE_EXPIRED and INVITE_ALREADY_USED cases
// removed from joinErrorMessage both ERROR tests go red (the happy path stays
// green); with the `onJoined(joined.id)` hand-off removed all three go red.

test.use({ storageState: { cookies: [], origins: [] } });
test.setTimeout(150_000);

const FALSIFY = (process.env.PW_FALSIFY ?? '').split(',').filter(Boolean);
const falsify = (step: string): boolean =>
  FALSIFY.includes('join-by-code') || FALSIFY.includes(`join-by-code:${step}`);

type Lang = 'en' | 'es';

const COPY = {
  en: {
    pickerJoinEmpty: 'Join with an invite code',
    pickerJoinHeader: 'Join a circle',
    dialog: 'Join a circle',
    find: 'Find circle',
    join: 'Join circle',
    different: 'Enter a different code',
    char: (n: number) => `Character ${n} of 6`,
    invalid: "We couldn't find that invite code. Double-check it and try again.",
    expired: 'This invite has expired. Ask the person who invited you for a new one.',
    used: 'This invite has already been used. Ask the person who invited you to send you a new one.',
    joined: (name: string) => `You've joined ${name}.`,
    switcher: (name: string) => `Switch circle: ${name}`,
    caregiver: 'Caregiver',
  },
  es: {
    pickerJoinEmpty: 'Unirte con un código de invitación',
    pickerJoinHeader: 'Unirte a un círculo',
    dialog: 'Unirte a un círculo',
    find: 'Buscar círculo',
    join: 'Unirte al círculo',
    different: 'Ingresar otro código',
    char: (n: number) => `Carácter ${n} de 6`,
    invalid: 'No encontramos ese código de invitación. Verifícalo e intenta de nuevo.',
    expired: 'Esta invitación venció. Pídele a quien te invitó una nueva.',
    used: 'Esta invitación ya fue utilizada. Pídele a quien te invitó que te envíe una nueva.',
    joined: (name: string) => `Te uniste a ${name}.`,
    switcher: (name: string) => `Cambiar de círculo: ${name}`,
    caregiver: 'Cuidador',
  },
} as const;

// `language_set_at` is stamped: with a NULL stamp the backend treats the language as "never decided"
// and overwrites it with the device's on the next sign-in (routes/auth.ts).
const setLanguage = (account: ScopedAccount, lang: Lang) =>
  sqlExec(
    `update public.users set language = ${sqlStr(lang)}, language_set_at = now() ` +
      `where id = ${sqlStr(account.userId)}::uuid;`
  );

const setName = (account: ScopedAccount, first: string, last: string) =>
  sqlExec(
    `update public.users set first_name = ${sqlStr(first)}, last_name = ${sqlStr(last)} ` +
      `where id = ${sqlStr(account.userId)}::uuid;`
  );

/** An owner with a circle whose NAME differs from its recipient, so the preview shows both rows. */
async function ownerWithCircle(request: APIRequestContext, label: string) {
  const suffix = uniq('x').replace(/[^a-z0-9]/gi, '');
  const owner = await createScopedAccount(`${label}-owner`);
  const inviterLast = `Anfitriona${suffix}`;
  setName(owner, 'Ofelia', inviterLast);
  const session = await ownerApi(request, owner);
  const circleId = await createCircle(session, uniq(label));
  const circleName = `Rivera Family ${suffix}`;
  const patched = await session.patch(`/api/circles/${circleId}`, { name: circleName });
  expect(patched.status(), await patched.text()).toBeLessThan(300);
  const recipient = dbQuery<{ recipient_name: string; name: string }>(
    `select recipient_name, name from care_circles where id = ${sqlStr(circleId)}::uuid`
  )[0];
  expect(recipient.name, 'circle renamed').toBe(circleName);
  expect(recipient.recipient_name, 'recipient differs from the circle name').not.toBe(circleName);
  return {
    owner,
    session,
    circleId,
    circleName,
    recipientName: recipient.recipient_name,
    inviterName: `Ofelia ${inviterLast}`,
  };
}

type OwnerCircle = Awaited<ReturnType<typeof ownerWithCircle>>;

async function cancelInvite(oc: OwnerCircle, inviteId: string): Promise<void> {
  const res = await oc.session.delete(`/api/invites/${inviteId}`);
  expect(res.status(), await res.text()).toBe(200);
  expect(inviteStatus(inviteId)).toBe('cancelled');
}

const codeBoxes = (dialog: Locator, lang: Lang): Locator[] =>
  Array.from({ length: 6 }, (_, i) => dialog.getByLabel(COPY[lang].char(i + 1), { exact: true }));

/**
 * Type `code` into the six-box field from the first box. It types OVER whatever the boxes hold, as a
 * person fixing a rejected code does: no clearing first. Lower case by default, on purpose: the field
 * upper-cases. A lower-case letter typed over its own upper-case twin is a REAL change to the DOM, so
 * pass `lower: false` when equal characters are the point (the re-typing tests below).
 */
async function typeCode(
  page: Page,
  dialog: Locator,
  lang: Lang,
  code: string,
  { lower = true }: { lower?: boolean } = {}
): Promise<void> {
  const boxes = codeBoxes(dialog, lang);
  await boxes[0].click();
  await page.keyboard.type(lower ? code.toLowerCase() : code, { delay: 15 });
  for (let i = 0; i < 6; i++) await expect(boxes[i]).toHaveValue(code[i]);
}

async function lookUp(dialog: Locator, lang: Lang): Promise<void> {
  await dialog.getByRole('button', { name: COPY[lang].find, exact: true }).click();
}

/** Open the picker as `account` and the join modal through `entry` (the button that opens it). */
async function openJoinModal(
  page: Page,
  lang: Lang,
  entry: 'empty-state' | 'header'
): Promise<Locator> {
  await page.goto('/circles', { waitUntil: 'domcontentloaded' });
  const label = entry === 'empty-state' ? COPY[lang].pickerJoinEmpty : COPY[lang].pickerJoinHeader;
  const button = page.getByRole('button', { name: label, exact: true });
  await expect(button).toBeVisible({ timeout: 30_000 });
  await button.click();
  const dialog = page.getByRole('dialog', { name: COPY[lang].dialog, exact: true });
  await expect(dialog).toBeVisible({ timeout: 10_000 });
  return dialog;
}

// ---------------------------------------------------------------------------

test('join by code from the picker: a user with no circle enters the code and lands in the named circle', async ({
  page,
  context,
  request,
  baseURL,
}) => {
  const oc = await ownerWithCircle(request, 'jbc-happy');
  const invite = await createInvite(oc.session, oc.circleId);
  // Precondition: a live invite for this circle. FALSIFY: cancelled before use.
  if (falsify('happy')) await cancelInvite(oc, invite.id);

  const joiner = await createScopedAccount('jbc-joiner');
  setLanguage(joiner, 'en');
  expect(
    dbCount(`select 1 from circle_memberships where user_id = ${sqlStr(joiner.userId)}::uuid`),
    'the joiner starts with no circle'
  ).toBe(0);
  await cookieLogin(context, joiner, baseURL);

  const lookups = countRequests(page, 'GET', '/api/invites/code/:code');
  const accepts = countRequests(page, 'POST', '/api/invites/code/:code/accept');
  const dialog = await openJoinModal(page, 'en', 'empty-state');

  // The submit is gated on a COMPLETE code.
  const find = dialog.getByRole('button', { name: COPY.en.find, exact: true });
  await expect(find).toBeDisabled();
  await typeCode(page, dialog, 'en', invite.code);
  await expect(find).toBeEnabled();
  await lookUp(dialog, 'en');

  // Step 2: the preview names the circle, the person cared for, the inviter and the role.
  await expect(dialog.getByText(oc.circleName, { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(dialog.getByText(oc.recipientName, { exact: true })).toBeVisible();
  await expect(dialog.getByText(oc.inviterName, { exact: true })).toBeVisible();
  await expect(dialog.getByText(COPY.en.caregiver, { exact: true })).toBeVisible();
  await expect(dialog.getByRole('alert')).toHaveCount(0);
  await lookups.expectCount(1);
  await accepts.expectCount(0);

  await dialog.getByRole('button', { name: COPY.en.join, exact: true }).click();

  // Lands in the joined circle and names it.
  await expect(successToast(page, COPY.en.joined(oc.circleName))).toBeVisible({ timeout: 25_000 });
  await expect(page).toHaveURL(new RegExp(`/circles/${oc.circleId}(/|\\?|$)`), { timeout: 25_000 });
  await expect(page.getByRole('button', { name: COPY.en.switcher(oc.circleName), exact: true })).toBeVisible({
    timeout: 25_000,
  });
  await expect(page.getByRole('dialog', { name: COPY.en.dialog, exact: true })).toHaveCount(0);
  await accepts.expectCount(1);
  await lookups.expectCount(1);

  // The write really happened: a caregiver membership, the invite spent.
  expect(membershipCount(oc.circleId, joiner.userId)).toBe(1);
  expect(
    dbQuery<{ role: string; is_care_recipient: boolean }>(
      `select role, is_care_recipient from circle_memberships
        where circle_id = ${sqlStr(oc.circleId)}::uuid and user_id = ${sqlStr(joiner.userId)}::uuid`
    )
  ).toEqual([{ role: 'member', is_care_recipient: false }]);
  expect(inviteStatus(invite.id)).toBe('accepted');
});

for (const lang of ['en', 'es'] as const) {
  test(`join by code errors (${lang.toUpperCase()}): unknown, expired, cancelled and deleted-user codes each say the right thing; a good code then joins`, async ({
    page,
    context,
    request,
    baseURL,
  }) => {
    const c = COPY[lang];
    const oc = await ownerWithCircle(request, `jbc-err-${lang}`);

    // The joiner already has TWO circles of their own: the picker stays (no single-circle
    // redirect) and the header "Join a circle" button is the way in.
    const joiner = await createScopedAccount(`jbc-errj-${lang}`);
    setLanguage(joiner, lang);
    const joinerApi = await ownerApi(request, joiner);
    await createCircle(joinerApi, uniq('own-a'));
    await createCircle(joinerApi, uniq('own-b'));
    await cookieLogin(context, joiner, baseURL);

    const dialog = await openJoinModal(page, lang, 'header');
    const alert = dialog.getByRole('alert');
    const codeBoxesVisible = async () =>
      expect(dialog.getByLabel(c.char(1), { exact: true })).toBeVisible();

    // --- (a) a code nobody issued ---
    const unknownCode = 'ZZZ9Q7';
    expect(dbCount(`select 1 from invites where invite_code = ${sqlStr(unknownCode)}`)).toBe(0);
    // FALSIFY: the code is a real, live invite.
    const unknownEntry = falsify('unknown') ? (await createInvite(oc.session, oc.circleId)).code : unknownCode;
    await typeCode(page, dialog, lang, unknownEntry);
    await lookUp(dialog, lang);
    await expect(alert).toHaveText(c.invalid, { timeout: 20_000 });
    await codeBoxesVisible(); // still on the code step
    // Editing the code clears the message.
    await dialog.getByLabel(c.char(6), { exact: true }).click();
    await page.keyboard.press('Backspace');
    await expect(alert).toHaveCount(0);

    // --- (b) an EXPIRED invite ---
    const expired = await createInvite(oc.session, oc.circleId);
    if (!falsify('expired')) expireInvite(expired.id);
    await typeCode(page, dialog, lang, expired.code);
    await lookUp(dialog, lang);
    await expect(alert).toHaveText(c.expired, { timeout: 20_000 });
    await codeBoxesVisible();
    expect(inviteStatus(expired.id), 'a lapsed invite is still "pending" in the DB').toBe('pending');

    // --- (c) an invite the OWNER cancelled ---
    const cancelled = await createInvite(oc.session, oc.circleId);
    if (!falsify('cancelled')) await cancelInvite(oc, cancelled.id);
    await typeCode(page, dialog, lang, cancelled.code);
    await lookUp(dialog, lang);
    await expect(alert).toHaveText(c.used, { timeout: 20_000 });
    await codeBoxesVisible();

    // --- (d) an invite addressed to someone who then DELETED their account, lapsed ---
    const gone = await createScopedAccount(`jbc-gone-${lang}`);
    const goneInvite = await createInvite(oc.session, oc.circleId);
    // Re-address this one invite to the account about to delete itself (the real flow is "the owner
    // invited that person's address"); created for @example.com so nothing could be mailed.
    sqlExec(
      `update invites set invited_email = ${sqlStr(gone.email.toLowerCase())}
        where id = ${sqlStr(goneInvite.id)}::uuid;`
    );
    expireInvite(goneInvite.id);
    // BEFORE the deletion: a lapsed pending invite reads "expired".
    await typeCode(page, dialog, lang, goneInvite.code);
    await lookUp(dialog, lang);
    await expect(alert).toHaveText(c.expired, { timeout: 20_000 });
    expect(inviteStatus(goneInvite.id)).toBe('pending');
    // The addressee deletes their account. The backend now CANCELS the lapsed invite.
    if (!falsify('deleted')) {
      const goneApi = await ownerApi(request, gone);
      const del = await goneApi.delete('/api/users/me');
      expect(del.status(), `DELETE /api/users/me: ${await del.text()}`).toBe(200);
      expect(inviteStatus(goneInvite.id), 'the lapsed invite was cancelled by the deletion').toBe('cancelled');
    }
    // AFTER: same code, now INVITE_ALREADY_USED -> "already been used", not "expired".
    await typeCode(page, dialog, lang, goneInvite.code);
    await lookUp(dialog, lang);
    await expect(alert).toHaveText(c.used, { timeout: 20_000 });
    await codeBoxesVisible();

    // --- (e) accept-time error: cancelled between look-up and join ---
    const racing = await createInvite(oc.session, oc.circleId);
    await typeCode(page, dialog, lang, racing.code);
    await lookUp(dialog, lang);
    await expect(dialog.getByText(oc.circleName, { exact: true })).toBeVisible({ timeout: 20_000 });
    await expect(alert).toHaveCount(0);
    if (!falsify('accept')) await cancelInvite(oc, racing.id);
    await dialog.getByRole('button', { name: c.join, exact: true }).click();
    await expect(alert).toHaveText(c.used, { timeout: 20_000 });
    // The preview is still there, nothing was joined.
    await expect(dialog.getByText(oc.circleName, { exact: true })).toBeVisible();
    expect(membershipCount(oc.circleId, joiner.userId)).toBe(0);

    // --- (f) a good code in the same session joins ---
    await dialog.getByRole('button', { name: c.different, exact: true }).click();
    await expect(alert).toHaveCount(0);
    const good = await createInvite(oc.session, oc.circleId);
    await typeCode(page, dialog, lang, good.code);
    await lookUp(dialog, lang);
    await expect(dialog.getByText(oc.inviterName, { exact: true })).toBeVisible({ timeout: 20_000 });
    await dialog.getByRole('button', { name: c.join, exact: true }).click();
    await expect(successToast(page, c.joined(oc.circleName))).toBeVisible({ timeout: 25_000 });
    await expect(page).toHaveURL(new RegExp(`/circles/${oc.circleId}(/|\\?|$)`), { timeout: 25_000 });
    await expect(page.getByRole('button', { name: c.switcher(oc.circleName), exact: true })).toBeVisible({
      timeout: 25_000,
    });
    expect(membershipCount(oc.circleId, joiner.userId)).toBe(1);
    expect(inviteStatus(good.id)).toBe('accepted');
    // The three failed look-ups and the failed accept spent no invite.
    expect(inviteStatus(cancelled.id)).toBe('cancelled');
    expect(inviteStatus(expired.id)).toBe('pending');
  });
}

// RE-TYPING OVER A FILLED CODE (OtpInput). The boxes are maxLength=1 and select their character on
// focus. A keystroke that EQUALS the character already in the box leaves the DOM value unchanged, so
// React fired no change event, focus did not advance, the selection collapsed and maxLength swallowed
// every following key. The usual way in: a wrong code is rejected, the person clicks the first box
// and types the whole code again with one character fixed (every other position is equal). Found by
// a probe that re-typed random codes over random codes: 11 of 60 rounds lost keystrokes, each at a
// position where the old and new character matched. Fixed in OtpInput (typed characters are applied
// on keydown; an input-event fallback covers keyboards without usable keys).
// FALSIFY (10-02): with the old OtpInput.tsx put back, the three tests below go red. The tests above
// now re-type over rejected codes without clearing first (typeCode no longer does), which only stalls
// when two random codes happen to share a character in the same position, so they are not the pin.

test('re-typing a rejected code over itself with one character fixed ends on the fixed code and finds the circle', async ({
  page,
  context,
  request,
  baseURL,
}) => {
  const oc = await ownerWithCircle(request, 'jbc-retype');
  const invite = await createInvite(oc.session, oc.circleId);
  const joiner = await createScopedAccount('jbc-retypej');
  setLanguage(joiner, 'en');
  await cookieLogin(context, joiner, baseURL);
  const dialog = await openJoinModal(page, 'en', 'empty-state');
  const boxes = codeBoxes(dialog, 'en');
  const alert = dialog.getByRole('alert');

  // The same code with only its LAST character changed: a code nobody issued.
  const wrong = [...'Q7ZK9W'].map((ch) => invite.code.slice(0, 5) + ch).find(
    (candidate) =>
      candidate !== invite.code &&
      dbCount(`select 1 from invites where invite_code = ${sqlStr(candidate)}`) === 0
  );
  expect(wrong, 'a one-character-off code that no invite owns').toBeTruthy();
  // Upper case on purpose: a lower-case letter over its upper-case twin is a real DOM change, an equal
  // character is not, and the first five characters here are equal by construction.
  await typeCode(page, dialog, 'en', wrong!, { lower: false });
  await lookUp(dialog, 'en');
  await expect(alert).toHaveText(COPY.en.invalid, { timeout: 20_000 });

  // The person fixes it: click the first box and type the real code from the start.
  await typeCode(page, dialog, 'en', invite.code, { lower: false });
  expect((await Promise.all(boxes.map((b) => b.inputValue()))).join('')).toBe(invite.code);
  await expect(boxes[5]).toBeFocused();
  // Editing the code (its last character changed) cleared the message.
  await expect(alert).toHaveCount(0);

  await lookUp(dialog, 'en');
  await expect(dialog.getByText(oc.circleName, { exact: true })).toBeVisible({ timeout: 20_000 });
  expect(inviteStatus(invite.id), 'a look-up spends nothing').toBe('pending');
});

test('re-typing a code over the same characters takes every keystroke, however many positions match', async ({
  page,
  context,
  baseURL,
}) => {
  const joiner = await createScopedAccount('jbc-otpbug');
  setLanguage(joiner, 'en');
  await cookieLogin(context, joiner, baseURL);
  const dialog = await openJoinModal(page, 'en', 'empty-state');
  const boxes = codeBoxes(dialog, 'en');
  const value = async () => (await Promise.all(boxes.map((b) => b.inputValue()))).join('');

  await boxes[0].click();
  await page.keyboard.type('ABC234', { delay: 40 });
  await expect(boxes[5]).toHaveValue('4');

  // The person fixes the last character by typing the whole code again from the first box.
  await boxes[0].click();
  await page.keyboard.type('ABC235', { delay: 40 });
  expect(await value(), 'the re-typed code').toBe('ABC235');
  await expect(boxes[5]).toBeFocused();

  // The same code again (every position equal), then one that differs in the middle, lower case.
  await boxes[0].click();
  await page.keyboard.type('ABC235', { delay: 40 });
  expect(await value(), 'the same code typed over itself').toBe('ABC235');
  await expect(boxes[5]).toBeFocused();
  await boxes[0].click();
  await page.keyboard.type('abx235', { delay: 40 });
  expect(await value(), 'a code that differs only at position 3').toBe('ABX235');
  await expect(boxes[5]).toBeFocused();
});

test('a keyboard that inserts text without key events (IME, dictation, soft keyboard) also advances over an equal character', async ({
  page,
  context,
  baseURL,
}) => {
  const joiner = await createScopedAccount('jbc-otpins');
  setLanguage(joiner, 'en');
  await cookieLogin(context, joiner, baseURL);
  const dialog = await openJoinModal(page, 'en', 'empty-state');
  const boxes = codeBoxes(dialog, 'en');

  await boxes[0].click();
  await page.keyboard.type('ABC234', { delay: 40 });
  await expect(boxes[5]).toHaveValue('4');

  // insertText fires beforeinput + input with no keydown/keypress: how a soft keyboard commits a key.
  // focus() (not a click) so the box's own select-on-focus selection is what the text replaces.
  await boxes[0].focus();
  for (const ch of 'ABC235') await page.keyboard.insertText(ch);
  expect((await Promise.all(boxes.map((b) => b.inputValue()))).join('')).toBe('ABC235');
  await expect(boxes[5]).toBeFocused();
});

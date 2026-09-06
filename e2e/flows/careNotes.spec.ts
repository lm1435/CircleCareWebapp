import { test, expect, uniqueLabel } from '../fixtures';

// Daily Care Notes write flow: compose a note (body + mood chip + category
// chip) on the Notes page → verify it appears in Today with its pills → edit
// the body inline → delete it (cleanup) and verify it is gone. Run-unique
// body text; self-cleaning; PHI-safe (synthetic content only).

const RE_ESCAPE = /[.*+?^${}()|[\]\\]/g;
function escapeRe(value: string): string {
  return value.replace(RE_ESCAPE, '\\$&');
}

test('compose, edit, and delete a daily care note', async ({ page, circleId }) => {
  const body = uniqueLabel('Note');
  const editedBody = `${body} edited`;

  await page.goto(`/circles/${circleId}/notes`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Notes', exact: false })).toBeVisible({
    timeout: 20_000,
  });

  // --- Compose: body + mood + one category, then post.
  const composer = page.getByLabel(/^Add a note/);
  await expect(composer).toBeVisible({ timeout: 20_000 });
  await composer.fill(body);
  // Mood is a ChipSelect — single-select, so it's role="radio" (aria-checked).
  // Category stays a plain aria-pressed button (multi-select, NoteComposer.tsx).
  await page.getByRole('radio', { name: 'Good day' }).click();
  await page.getByRole('button', { name: 'Meal' }).click();
  const postBtn = page.getByRole('button', { name: 'Post', exact: true });
  await expect(postBtn).toBeEnabled();
  await postBtn.click();

  // Entry appears (optimistic + server-confirmed) with its display pills.
  const entry = page.getByText(new RegExp(escapeRe(body))).first();
  await expect(entry).toBeVisible({ timeout: 20_000 });

  // Reload: persisted server-side, still under Today with pills.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByText(new RegExp(escapeRe(body))).first()).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByText('Good day').first()).toBeVisible();
  await expect(page.getByText('Meal').first()).toBeVisible();

  // --- Edit inline: row actions are a MoreMenu now (author-only trigger ->
  // Edit/Delete menuitems), not plain "Edit"/"Delete" buttons (NoteRow.tsx).
  // Scope to the row containing our unique body text via its own MoreMenu
  // trigger — the same leaf-row disambiguation the old "Edit" button filter
  // used to do.
  // Scoped to `li` ONLY (not "li, article, div"): NoteRow.tsx's root is always
  // `<Card as="li">`, and including ancestor divs let the outer feed container
  // (which also "hasText" the body and "has" *some* row's trigger) win a
  // `.last()` tie-break, resolving to every row's trigger instead of one.
  // The trigger's accessible name is per-author ("Actions for note by
  // <author>", notes.json row.actionsFor), not a plain "More" — NoteRow.tsx
  // passes that as MoreMenu's `label` override.
  const rowActions = /^Actions for note by /;
  const row = () =>
    page
      .locator('li')
      .filter({ hasText: new RegExp(`^(?=[\\s\\S]*${escapeRe(body)})`) })
      .filter({ has: page.getByRole('button', { name: rowActions }) })
      .last();
  await row().getByRole('button', { name: rowActions }).click();
  const editMenu = page.getByRole('menu');
  await expect(editMenu).toBeVisible();
  await editMenu.getByRole('menuitem', { name: 'Edit', exact: true }).click();
  const editField = page.getByRole('textbox').last();
  await editField.fill(editedBody);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText(new RegExp(escapeRe(editedBody))).first()).toBeVisible({
    timeout: 20_000,
  });

  // --- Delete (cleanup) with confirm; verify gone after reload.
  const editedRow = page
    .locator('li')
    .filter({ hasText: new RegExp(escapeRe(editedBody)) })
    .filter({ has: page.getByRole('button', { name: rowActions }) })
    .last();
  await editedRow.getByRole('button', { name: rowActions }).click();
  const deleteMenu = page.getByRole('menu');
  await expect(deleteMenu).toBeVisible();
  await deleteMenu.getByRole('menuitem', { name: 'Delete', exact: true }).click();
  const confirm = page.getByRole('dialog').or(page.getByRole('alertdialog'));
  await confirm.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.getByText(new RegExp(escapeRe(editedBody)))).toHaveCount(0, {
    timeout: 20_000,
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByText(new RegExp(escapeRe(editedBody)))).toHaveCount(0, {
    timeout: 20_000,
  });
});

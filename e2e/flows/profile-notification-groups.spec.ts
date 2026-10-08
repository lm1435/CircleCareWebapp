import { test, expect } from '../fixtures';
import { assertLocalDbTargets, sqlExec } from '../db';
import { dbQuery, sqlStr } from '../unhappy';
import { checkA11y } from '../helpers';
import { setProfileLanguage } from '../notesFirstClassShared';

// docs/plans/notification-settings-4-groups.md: the eight per-key switches are
// four GROUPS (Medications, Tasks & appointments, Notes, Daily update & tips).
// Storage is unchanged. A group is ON if ANY child is on (absent key = ON); a
// tap sets every child. The Tasks write also pins `event_notes` to its stored
// value so the backend's note_nudges -> event_notes legacy shim
// (backend/src/routes/users.ts ~357-381) cannot flip Notes. Medications OFF
// asks first. Twin of mobile/.maestro/parity/profile/notification-groups.yaml.
// (Replaces profile-note-switches.spec.ts, the three-note-switch spec.)

type Prefs = Record<string, unknown>;

function readPrefs(userId: string): Prefs {
  return dbQuery<{ prefs: Prefs }>(
    `select notification_preferences as prefs from users where id = ${sqlStr(userId)}::uuid`
  )[0].prefs;
}

/** Test-only seeding of the stored JSON (local DB only; the API cannot delete a key). */
function writePrefs(userId: string, prefs: Prefs): void {
  assertLocalDbTargets('profile-notification-groups seed');
  sqlExec(
    `update users set notification_preferences = ${sqlStr(JSON.stringify(prefs))}::jsonb where id = ${sqlStr(userId)}::uuid`
  );
}

const without = (prefs: Prefs, ...keys: string[]): Prefs =>
  Object.fromEntries(Object.entries(prefs).filter(([k]) => !keys.includes(k)));

test.describe('Profile: notification groups', () => {
  test('Notes, Tasks & appointments and Medications write their whole group; absent note keys read ON', async ({
    page,
    account,
  }, testInfo) => {
    test.slow();
    const original = readPrefs(account.userId);
    try {
      // Seed: every note key ABSENT (the backend contract: absent = ON), the
      // rest explicitly on.
      const base: Prefs = {
        ...without(original, 'event_notes', 'care_notes', 'note_nudges'),
        medication_confirmations: true,
        missed_medications: true,
        task_assignments: true,
        appointment_reminders: true,
        tips_and_suggestions: true,
      };
      writePrefs(account.userId, base);

      await page.goto('/profile', { waitUntil: 'domcontentloaded' });
      const meds = page.getByRole('switch', { name: 'Medications', exact: true });
      const tasks = page.getByRole('switch', { name: 'Tasks & appointments', exact: true });
      const notes = page.getByRole('switch', { name: 'Notes', exact: true });
      const tips = page.getByRole('switch', { name: 'Daily update & tips', exact: true });
      await expect(meds).toBeVisible({ timeout: 15_000 });

      // The eight retired labels are gone.
      for (const old of [
        'Medication confirmations',
        'Unmarked medications',
        'Task assignments',
        'Appointment reminders',
        'Notes on events',
        'After-visit reminders',
        'Daily care notes',
      ]) {
        await expect(page.getByRole('switch', { name: old })).toHaveCount(0);
      }

      await checkA11y(page, '/profile', testInfo);

      for (const sw of [meds, tasks, notes, tips]) await expect(sw).toHaveAttribute('aria-checked', 'true');
      await expect(page.getByText('Some turned off')).toHaveCount(0);

      // --- Tasks off FIRST, while Notes is still ON: its three keys false and
      // event_notes pinned TRUE. Without the pin the backend shim mirrors
      // note_nudges=false onto event_notes and Notes silently turns off. ---
      await tasks.click();
      await expect
        .poll(() => readPrefs(account.userId), { timeout: 10_000 })
        .toEqual({
          ...base,
          task_assignments: false,
          appointment_reminders: false,
          note_nudges: false,
          event_notes: true,
        });
      await expect(tasks).toHaveAttribute('aria-checked', 'false');
      await expect(notes).toHaveAttribute('aria-checked', 'true');

      // --- Notes off: both note keys written, note_nudges untouched (still false) ---
      await notes.click();
      await expect
        .poll(() => readPrefs(account.userId), { timeout: 10_000 })
        .toEqual({
          ...base,
          task_assignments: false,
          appointment_reminders: false,
          note_nudges: false,
          event_notes: false,
          care_notes: false,
        });
      await expect(notes).toHaveAttribute('aria-checked', 'false');

      // --- Tasks back ON with Notes OFF: event_notes STAYS false (a missing pin
      // lets the shim mirror note_nudges=true onto it, re-enabling Notes) ---
      await tasks.click();
      await expect
        .poll(() => readPrefs(account.userId), { timeout: 10_000 })
        .toEqual({
          ...base,
          task_assignments: true,
          appointment_reminders: true,
          note_nudges: true,
          event_notes: false,
          care_notes: false,
        });
      await expect(notes).toHaveAttribute('aria-checked', 'false');

      // --- Tasks off again with Notes off: event_notes stays false ---
      await tasks.click();
      await expect
        .poll(() => readPrefs(account.userId), { timeout: 10_000 })
        .toEqual({
          ...base,
          event_notes: false,
          care_notes: false,
          task_assignments: false,
          appointment_reminders: false,
          note_nudges: false,
        });
      await expect(notes).toHaveAttribute('aria-checked', 'false');
      await expect(tasks).toHaveAttribute('aria-checked', 'false');

      // --- Medications: the confirm comes first; "Keep on" changes nothing ---
      const beforeMeds = readPrefs(account.userId);
      await meds.click();
      const dialog = page.getByRole('dialog');
      await expect(dialog.getByText('Turn off medication alerts?')).toBeVisible();
      await dialog.getByText('Keep on', { exact: true }).click();
      await expect(dialog).toHaveCount(0);
      expect(readPrefs(account.userId)).toEqual(beforeMeds);
      await expect(meds).toHaveAttribute('aria-checked', 'true');

      await meds.click();
      await expect(dialog).toBeVisible();
      await dialog.getByText('Turn off', { exact: true }).click();
      await expect
        .poll(() => readPrefs(account.userId), { timeout: 10_000 })
        .toEqual({ ...beforeMeds, medication_confirmations: false, missed_medications: false });
      await expect(meds).toHaveAttribute('aria-checked', 'false');

      // Persisted: a reload shows the stored state.
      await page.reload({ waitUntil: 'domcontentloaded' });
      for (const sw of [meds, tasks, notes]) await expect(sw).toHaveAttribute('aria-checked', 'false');
      await expect(tips).toHaveAttribute('aria-checked', 'true');

      // --- Turning Medications back on never asks ---
      await meds.click();
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await expect
        .poll(() => readPrefs(account.userId), { timeout: 10_000 })
        .toMatchObject({ medication_confirmations: true, missed_medications: true });
    } finally {
      writePrefs(account.userId, original);
    }
  });

  test('a mixed stored state reads ON with "Some turned off"; one tap turns the whole group off', async ({
    page,
    account,
  }) => {
    test.slow();
    const original = readPrefs(account.userId);
    try {
      writePrefs(account.userId, { ...original, event_notes: true, care_notes: false });
      await page.goto('/profile', { waitUntil: 'domcontentloaded' });
      const notes = page.getByRole('switch', { name: 'Notes', exact: true });
      await expect(notes).toBeVisible({ timeout: 15_000 });
      await expect(notes).toHaveAttribute('aria-checked', 'true');
      await expect(page.getByText('Some turned off')).toHaveCount(1);
      await expect(notes).toHaveAccessibleDescription(/Some turned off/);

      await notes.click();
      await expect
        .poll(() => readPrefs(account.userId), { timeout: 10_000 })
        .toMatchObject({ event_notes: false, care_notes: false });
      await expect(notes).toHaveAttribute('aria-checked', 'false');
      await expect(page.getByText('Some turned off')).toHaveCount(0);
    } finally {
      writePrefs(account.userId, original);
    }
  });

  test('Spanish: group names and "Algunas desactivadas" with a mixed seed', async ({ page, account }) => {
    test.slow();
    const original = readPrefs(account.userId);
    try {
      writePrefs(account.userId, { ...original, medication_confirmations: true, missed_medications: false });
      await setProfileLanguage(page, 'es');

      await expect(page.getByRole('switch', { name: 'Medicamentos', exact: true })).toBeVisible({ timeout: 15_000 });
      await expect(page.getByRole('switch', { name: 'Tareas y citas', exact: true })).toBeVisible();
      await expect(page.getByRole('switch', { name: 'Notas', exact: true })).toBeVisible();
      await expect(page.getByRole('switch', { name: 'Resumen del día y consejos', exact: true })).toBeVisible();
      await expect(page.getByText('Algunas desactivadas')).toHaveCount(1);
      await expect(page.getByText('Dosis tomadas, omitidas o sin marcar')).toBeVisible();
    } finally {
      writePrefs(account.userId, original);
      await setProfileLanguage(page, 'en').catch(() => {});
    }
  });
});

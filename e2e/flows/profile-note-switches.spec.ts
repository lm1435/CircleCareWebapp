import { test, expect } from '../fixtures';
import { dbQuery, sqlStr } from '../unhappy';
import { checkA11y } from '../helpers';
import { setProfileLanguage } from '../notesFirstClassShared';

// docs/plans/notes-first-class.md, Slice 1 (Decision 5): three notification
// switches — "Notes on events" (new key `event_notes`), "After-visit
// reminders" (existing key `note_nudges`, relabelled), "Daily care notes"
// (existing key `care_notes`, newly exposed). An ABSENT key means ON (the
// backend's own default-merge contract, `raw !== false`). The plan's Decision
// 5 frames these as three INDEPENDENT switches, and they now really are:
// `ProfilePage.tsx`'s `handleNotif` pins `event_notes` to its current
// displayed value on every `note_nudges` PATCH, so the backend's legacy shim
// (`backend/src/routes/users.ts` ~357-370 — mirrors `note_nudges` onto
// `event_notes` when a PATCH omits `event_notes`, for OLD single-switch
// clients) can no longer cross-flip "Notes on events". The Spanish labels
// render the plan's exact copy.

interface Prefs {
  event_notes: string | null;
  note_nudges: string | null;
  care_notes: string | null;
  medication_confirmations: string | null;
}

function readPrefs(userId: string): Prefs {
  const rows = dbQuery<Prefs>(
    `select
       notification_preferences->>'event_notes' as event_notes,
       notification_preferences->>'note_nudges' as note_nudges,
       notification_preferences->>'care_notes' as care_notes,
       notification_preferences->>'medication_confirmations' as medication_confirmations
     from users where id = ${sqlStr(userId)}`
  );
  return rows[0];
}

/** `defaultOn` read: absent means ON. */
function expectedChecked(raw: string | null): boolean {
  return raw !== 'false';
}

test.describe('Profile: notes notification switches', () => {
  test('Notes on events / After-visit reminders / Daily care notes toggle independently, absent = ON', async ({
    page,
    account,
  }, testInfo) => {
    test.slow();
    const before = readPrefs(account.userId);

    await page.goto('/profile', { waitUntil: 'domcontentloaded' });

    const eventNotesSwitch = page.getByRole('switch', { name: 'Notes on events' });
    const noteNudgesSwitch = page.getByRole('switch', { name: 'After-visit reminders' });
    const careNotesSwitch = page.getByRole('switch', { name: 'Daily care notes' });

    await expect(eventNotesSwitch).toBeVisible({ timeout: 15_000 });
    await expect(noteNudgesSwitch).toBeVisible();
    await expect(careNotesSwitch).toBeVisible();

    // New UI state: the three notes notification switches on Profile.
    await checkA11y(page, '/profile', testInfo);

    await expect(eventNotesSwitch).toHaveAttribute('aria-checked', String(expectedChecked(before.event_notes)));
    await expect(noteNudgesSwitch).toHaveAttribute('aria-checked', String(expectedChecked(before.note_nudges)));
    await expect(careNotesSwitch).toHaveAttribute('aria-checked', String(expectedChecked(before.care_notes)));

    // --- Toggle "Notes on events" OFF, then back ON — fully independent ---
    await eventNotesSwitch.click();
    await expect
      .poll(() => readPrefs(account.userId).event_notes, { timeout: 10_000 })
      .toBe(expectedChecked(before.event_notes) ? 'false' : 'true');
    const afterFirstToggle = readPrefs(account.userId);
    expect(afterFirstToggle.note_nudges).toBe(before.note_nudges);
    expect(afterFirstToggle.care_notes).toBe(before.care_notes);
    expect(afterFirstToggle.medication_confirmations).toBe(before.medication_confirmations);

    await eventNotesSwitch.click();
    await expect
      .poll(() => readPrefs(account.userId).event_notes, { timeout: 10_000 })
      .toBe(before.event_notes ?? 'true');
    // The round trip can turn an ABSENT key into an explicit 'true' (same
    // meaning, different JSON) — later "untouched" checks must compare
    // against this CURRENT value, not the original (possibly-absent) one.
    const eventNotesAfterRoundTrip = readPrefs(account.userId).event_notes;

    // --- Toggle "Daily care notes" OFF, then back ON — fully independent ---
    await careNotesSwitch.click();
    await expect
      .poll(() => readPrefs(account.userId).care_notes, { timeout: 10_000 })
      .toBe(expectedChecked(before.care_notes) ? 'false' : 'true');
    const afterSecondToggle = readPrefs(account.userId);
    expect(afterSecondToggle.event_notes).toBe(before.event_notes ?? 'true');
    expect(afterSecondToggle.note_nudges).toBe(before.note_nudges);
    expect(afterSecondToggle.medication_confirmations).toBe(before.medication_confirmations);

    await careNotesSwitch.click();
    await expect
      .poll(() => readPrefs(account.userId).care_notes, { timeout: 10_000 })
      .toBe(before.care_notes ?? 'true');
    // The round trip can turn an ABSENT key into an explicit 'true' (same
    // meaning, different JSON) — later "untouched" checks must compare
    // against this CURRENT value, not the original (possibly-absent) one.
    const careNotesAfterRoundTrip = readPrefs(account.userId).care_notes;

    // --- Toggle "After-visit reminders" OFF, then back ON — fully independent ---
    //
    // FIXED (evidenced 2026-09-27): `ProfilePage.tsx`'s `handleNotif` now
    // pins `event_notes` to its current displayed value whenever the key
    // being changed is `note_nudges`, so the backend's legacy shim
    // (`backend/src/routes/users.ts` ~357-370, which mirrors `note_nudges`
    // onto `event_notes` for OLD single-switch clients that omit
    // `event_notes` entirely) never fires here. "After-visit reminders" must
    // move alone.
    await noteNudgesSwitch.click();
    await expect
      .poll(() => readPrefs(account.userId).note_nudges, { timeout: 10_000 })
      .toBe(expectedChecked(before.note_nudges) ? 'false' : 'true');
    const afterThirdToggle = readPrefs(account.userId);
    expect(afterThirdToggle.event_notes).toBe(eventNotesAfterRoundTrip); // independent — unchanged
    expect(afterThirdToggle.care_notes).toBe(careNotesAfterRoundTrip);
    expect(afterThirdToggle.medication_confirmations).toBe(before.medication_confirmations);

    await noteNudgesSwitch.click();
    await expect
      .poll(() => readPrefs(account.userId).note_nudges, { timeout: 10_000 })
      .toBe(before.note_nudges ?? 'true');

    // Final: every key restored, and "Notes on events" was never touched by
    // the "After-visit reminders" round trip.
    const restored = readPrefs(account.userId);
    expect(restored.event_notes).toBe(eventNotesAfterRoundTrip);
    expect(expectedChecked(restored.note_nudges)).toBe(expectedChecked(before.note_nudges));
    expect(expectedChecked(restored.care_notes)).toBe(expectedChecked(before.care_notes));
    expect(restored.medication_confirmations).toBe(before.medication_confirmations);
  });

  test('Spanish labels for the three switches', async ({ page }) => {
    test.slow();
    try {
      await setProfileLanguage(page, 'es');

      await expect(page.getByRole('switch', { name: 'Notas en eventos' })).toBeVisible({ timeout: 15_000 });
      await expect(page.getByRole('switch', { name: 'Recordatorios después de citas' })).toBeVisible();
      await expect(page.getByRole('switch', { name: 'Notas de cuidado diarias' })).toBeVisible();
    } finally {
      await setProfileLanguage(page, 'en').catch(() => {});
    }
  });
});

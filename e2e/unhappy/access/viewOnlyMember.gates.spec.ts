import { test, expect } from '../../fixtures';
import {
  SURFACES,
  VIEW_ONLY_BANNER,
  ensureOwnAuthoredRows,
  expectGated,
  gotoCirclePage,
  loadSurfaceData,
  runWriteProbes,
} from './_helpers';

// ===========================================================================
// VIEW-ONLY SEAT — every write affordance is withheld, and the SERVER refuses
// every write on its own.
//
// Persona: a caregiver who joined a free host's only circle LAST, so the
// caregiver cap made the seat `view_only` (GET /circles/:id → can_edit false).
//
// UI: each surface in `SURFACES` first proves the page loaded the record it
// would otherwise act on (a seeded row, the open modal's own title, the open
// menu's read-only item), and only then asserts that the write controls are
// absent (or, for the sidebar New button, disabled). The SAME surface
// definitions run for the premium owner in `premiumOwner.controls.spec.ts`,
// where every one of those controls must be present — so an absence here can
// never be an artefact of a page that renders the control for nobody.
//
// ROW CONTROLS NEED THE VIEWER'S OWN ROWS. Note row actions are author-gated
// (delete also for the owner, NotesPage.tsx:303-304) and document Edit/Delete
// are uploader-or-owner-gated (DocumentsPage.tsx:67-68). On the host-authored
// seed rows a non-owner never sees them, view-only or not — rewriting GET
// /circles/:id to `can_edit: true` left those absence checks green. So the
// notes and document-menu surfaces run on a note AUTHORED and a document
// UPLOADED by this persona (`ensureOwnAuthoredRows`), where `canEdit` is the
// only thing hiding the controls; `freeMember.ownRows.controls.spec.ts` shows
// an editor non-owner IS offered them on such rows.
//
// MEMBERS IS NOT HERE. Invite / remove / manage are OWNER-only throughout
// MembersPage.tsx (`isOwner`, never `canEdit`), so for a non-owner they are
// absent whatever the seat says; the check could not fail on a broken view-only
// gate. It stays in `SURFACES` for the premium owner's control.
//
// SERVER: the view-only seat calls each write endpoint with a VALID body (so a
// broken gate would really write) and the database is checked afterwards.
// Codes are what the backend sends today: VIEW_ONLY for the
// `requireCircleEditAccess` routes, READ_ONLY_MEMBER for documents
// (`resolveEditAccess`), FORBIDDEN for invites (owner-only).
// ===========================================================================

test.use({ persona: 'viewOnlyMember' });

for (const surface of SURFACES.filter((s) => s.name !== 'members')) {
  test(`${surface.name}: no write affordance is offered to a view-only seat`, async ({
    page,
    personaHandle,
  }) => {
    const own = await ensureOwnAuthoredRows(personaHandle);
    const data = loadSurfaceData(personaHandle, own);
    const affordances = await surface.open(page, data);
    await expectGated(affordances);
  });
}

test('notes: the view-only banner explains why writing is off', async ({ page, personaHandle }) => {
  const data = loadSurfaceData(personaHandle);
  await gotoCirclePage(page, data.circleId, 'notes');
  await expect(page.getByText(data.careNoteBody!).first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(VIEW_ONLY_BANNER)).toBeVisible();
});

test('server refuses every write from the view-only seat, and nothing is written', async ({
  request,
  personaHandle,
}) => {
  await runWriteProbes(request, personaHandle, {
    default: { status: 403, code: 'VIEW_ONLY' },
    documents: { status: 403, code: 'READ_ONLY_MEMBER' },
    invite: { status: 403, code: 'FORBIDDEN' },
  });
});

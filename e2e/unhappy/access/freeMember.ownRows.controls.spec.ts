import { test } from '../../fixtures';
import { SURFACES, ensureOwnAuthoredRows, expectOffered, loadSurfaceData } from './_helpers';

// ===========================================================================
// NEGATIVE CONTROL for the row controls in `viewOnlyMember.gates.spec.ts`.
//
// The view-only gate spec asserts note row actions and document Edit/Delete
// away on rows the view-only persona itself authored / uploaded. Those controls
// are gated by authorship (NotesPage.tsx:303-304) and uploader-or-owner
// (DocumentsPage.tsx:67-68) AS WELL AS `canEdit`, and the premium owner's
// control (`premiumOwner.controls.spec.ts`) reaches them through ownership, not
// authorship. This file closes that gap: an EDITOR NON-OWNER (freeMember), on
// rows it authored / uploaded the same way (`ensureOwnAuthoredRows`), through
// the SAME surface flows, IS offered every one of those controls. So the only
// difference between this persona and the view-only one on those rows is the
// seat's `canEdit`.
// ===========================================================================

test.use({ persona: 'freeMember' });

for (const name of ['notes', 'document actions menu']) {
  test(`${name}: an editor non-owner IS offered the controls on rows it authored (control)`, async ({
    page,
    personaHandle,
  }) => {
    const surface = SURFACES.find((s) => s.name === name);
    if (!surface) throw new Error(`no surface named "${name}"`);
    const own = await ensureOwnAuthoredRows(personaHandle);
    const affordances = await surface.open(page, loadSurfaceData(personaHandle, own));
    await expectOffered(affordances);
  });
}

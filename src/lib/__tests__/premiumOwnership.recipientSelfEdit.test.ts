import { viewerCanEditOwnRecipientDetails } from '@/lib/premiumOwnership';

// 1.4.4: a care RECIPIENT edits only their own name + date of birth. The client READS the server's
// `viewer_can_edit_recipient_details` and fails closed on anything but a literal `true`.
const OWNER = 'u-owner';
const REC = 'u-recipient';

describe('viewerCanEditOwnRecipientDetails (fails closed)', () => {
  it('POSITIVE: a non-owner with the flag === true may', () => {
    expect(
      viewerCanEditOwnRecipientDetails({ owner_id: OWNER, viewer_can_edit_recipient_details: true }, REC)
    ).toBe(true);
  });

  it.each([
    ['flag absent (older backend)', { owner_id: OWNER }],
    ['flag false', { owner_id: OWNER, viewer_can_edit_recipient_details: false }],
    ['flag undefined', { owner_id: OWNER, viewer_can_edit_recipient_details: undefined }],
    ['flag a truthy non-boolean', { owner_id: OWNER, viewer_can_edit_recipient_details: 'true' as never }],
  ])('NEGATIVE: %s -> false', (_label, circle) => {
    expect(viewerCanEditOwnRecipientDetails(circle, REC)).toBe(false);
  });

  it('NEGATIVE: no circle, or a signed-out viewer with the flag on -> still gated by ownership rules, never opens for null circle', () => {
    expect(viewerCanEditOwnRecipientDetails(null, REC)).toBe(false);
    expect(viewerCanEditOwnRecipientDetails(undefined, REC)).toBe(false);
  });

  it('NEGATIVE: the OWNER is never in recipient mode (they get the full form), flag or not', () => {
    expect(
      viewerCanEditOwnRecipientDetails({ owner_id: OWNER, viewer_can_edit_recipient_details: true }, OWNER)
    ).toBe(false);
  });

  it('NEGATIVE: absent owner_id and a signed-out viewer are never read as an owner match', () => {
    // Both nullish: viewerOwnsCircle is false, so the flag alone decides (true here is the server's word).
    expect(viewerCanEditOwnRecipientDetails({ viewer_can_edit_recipient_details: false }, null)).toBe(false);
  });
});

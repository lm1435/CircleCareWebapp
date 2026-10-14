import { pickHomeNudge } from '../homeNudge';

// Home shows at most ONE nudge card: the checklist first, the solo invite card
// only once the checklist is finished or dismissed.
describe('pickHomeNudge', () => {
  it('picks the checklist while it is active, even for an owner who is alone', () => {
    expect(pickHomeNudge({ checklist: 'active', soloEligible: true })).toBe('checklist');
    expect(pickHomeNudge({ checklist: 'active', soloEligible: false })).toBe('checklist');
  });

  it('picks the solo invite only after the checklist is finished or dismissed', () => {
    expect(pickHomeNudge({ checklist: 'inactive', soloEligible: true })).toBe('soloInvite');
  });

  it('picks nothing once the checklist is gone and the owner is not alone', () => {
    expect(pickHomeNudge({ checklist: 'inactive', soloEligible: false })).toBeNull();
  });

  it('picks nothing while the checklist is still working out its state', () => {
    expect(pickHomeNudge({ checklist: 'unknown', soloEligible: true })).toBeNull();
    expect(pickHomeNudge({ checklist: 'unknown', soloEligible: false })).toBeNull();
  });
});

import {
  memberRowActions,
  viewerCanAssignManager,
  viewerCanManageMembers,
  viewerCanSuggestManager,
  viewerCircleRole,
  type CircleOwnershipFields,
  type MemberTargetFields,
} from '@/lib/premiumOwnership';

// Manager role (docs/plans/manager-role.md): the client READS the server's
// `viewer_role` / `viewer_permissions` and never derives permissions itself;
// absent fields (an older backend) fall back to the owner test.

const OWNER = 'u-owner';
const MGR = 'u-mgr';
const MEMBER = 'u-mem';

const base: CircleOwnershipFields = { owner_id: OWNER };
const ownerOn: CircleOwnershipFields = {
  ...base,
  viewer_role: 'owner',
  viewer_permissions: ['manage_members', 'assign_manager'],
};
const ownerOff: CircleOwnershipFields = { ...base, viewer_role: 'owner', viewer_permissions: ['manage_members'] };
const manager: CircleOwnershipFields = { ...base, viewer_role: 'manager', viewer_permissions: ['manage_members'] };
const member: CircleOwnershipFields = { ...base, viewer_role: 'member', viewer_permissions: [] };
const demoted: CircleOwnershipFields = { ...base, viewer_role: 'manager', viewer_permissions: [] };

const row = (over: Partial<MemberTargetFields> & { id: string }): MemberTargetFields => ({
  role: 'member',
  is_care_recipient: false,
  view_only: false,
  ...over,
});

const ownerRow = row({ id: OWNER, role: 'owner' });
const managerRow = row({ id: 'u-mgr2', role: 'manager' });
const plainRow = row({ id: 'u-plain' });
const viewOnlyRow = row({ id: 'u-vo', view_only: true });
const recipientRow = row({ id: 'u-rose', is_care_recipient: true });

describe('viewerCanManageMembers', () => {
  it('reads manage_members from viewer_permissions', () => {
    expect(viewerCanManageMembers(ownerOn, OWNER)).toBe(true);
    expect(viewerCanManageMembers(manager, MGR)).toBe(true);
    expect(viewerCanManageMembers(member, MEMBER)).toBe(false);
    expect(viewerCanManageMembers(demoted, MGR)).toBe(false);
  });

  it('an EMPTY array is a real "no", even for the owner id (the server decides)', () => {
    expect(viewerCanManageMembers({ ...base, viewer_permissions: [] }, OWNER)).toBe(false);
  });

  it('falls back to owner_id === me when the backend predates the fields', () => {
    expect(viewerCanManageMembers(base, OWNER)).toBe(true);
    expect(viewerCanManageMembers(base, MGR)).toBe(false);
  });

  it('fails closed with no circle or no user', () => {
    expect(viewerCanManageMembers(undefined, OWNER)).toBe(false);
    expect(viewerCanManageMembers(base, undefined)).toBe(false);
  });
});

describe('viewerCanAssignManager', () => {
  it('only the owner, only with assign_manager', () => {
    expect(viewerCanAssignManager(ownerOn, OWNER)).toBe(true);
    expect(viewerCanAssignManager(ownerOff, OWNER)).toBe(false);
    expect(viewerCanAssignManager(base, OWNER)).toBe(false); // older backend: no endpoint
    // A non-owner is never offered it, whatever the payload says.
    expect(viewerCanAssignManager({ ...ownerOn }, MGR)).toBe(false);
  });
});

describe('viewerCircleRole', () => {
  it('owner / manager / member / demoted manager', () => {
    expect(viewerCircleRole(ownerOn, OWNER)).toBe('owner');
    expect(viewerCircleRole(base, OWNER)).toBe('owner');
    expect(viewerCircleRole(manager, MGR)).toBe('manager');
    expect(viewerCircleRole(member, MEMBER)).toBe('member');
    expect(viewerCircleRole(demoted, MGR)).toBe('member');
    expect(viewerCircleRole(undefined, MGR)).toBe('member');
  });
});

describe('memberRowActions', () => {
  it('owner (switch on): med + remove on every non-owner, non-recipient row; role toggle unless view-only', () => {
    expect(memberRowActions(ownerOn, OWNER, plainRow)).toEqual({
      remove: true,
      medResponsible: true,
      managerRole: true,
    });
    expect(memberRowActions(ownerOn, OWNER, managerRow)).toEqual({
      remove: true,
      medResponsible: true,
      managerRole: true,
    });
    expect(memberRowActions(ownerOn, OWNER, viewOnlyRow)).toEqual({
      remove: true,
      medResponsible: true,
      managerRole: false,
    });
  });

  it('owner (switch off / older backend): exactly today — med + remove, no role item', () => {
    for (const c of [ownerOff, base]) {
      expect(memberRowActions(c, OWNER, plainRow)).toEqual({
        remove: true,
        medResponsible: true,
        managerRole: false,
      });
    }
  });

  it('nobody acts on the owner row, the care recipient, or themselves', () => {
    const none = { remove: false, medResponsible: false, managerRole: false };
    expect(memberRowActions(ownerOn, OWNER, ownerRow)).toEqual(none);
    expect(memberRowActions(ownerOn, OWNER, recipientRow)).toEqual(none);
    expect(memberRowActions(manager, MGR, ownerRow)).toEqual(none);
    expect(memberRowActions(manager, MGR, recipientRow)).toEqual(none);
    expect(memberRowActions(manager, MGR, row({ id: MGR, role: 'manager' }))).toEqual(none);
  });

  it('manager: Remove on plain members only — never another manager; never med or role', () => {
    expect(memberRowActions(manager, MGR, plainRow)).toEqual({
      remove: true,
      medResponsible: false,
      managerRole: false,
    });
    expect(memberRowActions(manager, MGR, viewOnlyRow).remove).toBe(true);
    expect(memberRowActions(manager, MGR, managerRow).remove).toBe(false);
  });

  it('member and demoted manager: nothing', () => {
    const none = { remove: false, medResponsible: false, managerRole: false };
    expect(memberRowActions(member, MEMBER, plainRow)).toEqual(none);
    expect(memberRowActions(demoted, MGR, plainRow)).toEqual(none);
    expect(memberRowActions(base, MGR, plainRow)).toEqual(none);
  });
});

describe('viewerCanSuggestManager (invite-form manager hint)', () => {
  it('is true for a PREMIUM owner the server offers assign_manager', () => {
    expect(viewerCanSuggestManager({ ...ownerOn, is_premium_circle: true }, OWNER)).toBe(true);
  });

  it('is false for a FREE owner, even though assign_manager is served (no upsell)', () => {
    expect(viewerCanSuggestManager({ ...ownerOn, is_premium_circle: false }, OWNER)).toBe(false);
    expect(viewerCanSuggestManager(ownerOn, OWNER)).toBe(false);
  });

  it('is false for an owner without assign_manager (switch off / older backend)', () => {
    expect(viewerCanSuggestManager({ ...ownerOff, is_premium_circle: true }, OWNER)).toBe(false);
    expect(viewerCanSuggestManager({ ...base, is_premium_circle: true }, OWNER)).toBe(false);
  });

  it('is false for a manager or a plain member, and when signed out', () => {
    const premiumOn = { ...ownerOn, is_premium_circle: true };
    expect(viewerCanSuggestManager({ ...manager, is_premium_circle: true }, MGR)).toBe(false);
    expect(viewerCanSuggestManager({ ...member, is_premium_circle: true }, MEMBER)).toBe(false);
    // Even a payload that (wrongly) carried assign_manager never shows it to a non-owner.
    expect(viewerCanSuggestManager(premiumOn, MGR)).toBe(false);
    expect(viewerCanSuggestManager(premiumOn, null)).toBe(false);
    expect(viewerCanSuggestManager(undefined, OWNER)).toBe(false);
  });
});

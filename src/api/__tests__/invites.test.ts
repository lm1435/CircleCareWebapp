import { apiClient } from '@/lib/api';
import {
  createInvite,
  cancelInvite,
  acceptInvite,
  getPendingInvites,
  lookupInviteByCode,
  acceptInviteByCode,
} from '@/api/invites';
import {
  removeMember,
  leaveCircle,
  setMedicationResponsible,
} from '@/api/circleMembers';

// `@/lib/api` is mocked globally in src/test/setup.ts — apiClient.{post,delete,put,get}
// are vi.fn()s whose resolved value is the unwrapped `{ success, data }` envelope.

const mockGet = vi.mocked(apiClient.get);
const mockPost = vi.mocked(apiClient.post);
const mockPut = vi.mocked(apiClient.put);
const mockDelete = vi.mocked(apiClient.delete);

const CIRCLE_ID = 'circle-1';
const INVITE_ID = 'invite-1';
const USER_ID = 'user-9';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('createInvite', () => {
  it('POSTs to /circles/:cid/invites with the email + member_type body', async () => {
    mockPost.mockResolvedValue({
      success: true,
      data: {
        invite: {
          id: INVITE_ID,
          invited_email: 'a@b.com',
          member_type: 'caregiver',
          invite_code: 'ABC123',
          expires_at: '2026-07-01T00:00:00Z',
        },
        message: 'Invite sent',
      },
    });

    const body = { email: 'a@b.com', member_type: 'caregiver' as const };
    const result = await createInvite(CIRCLE_ID, body);

    expect(mockPost).toHaveBeenCalledWith(`/circles/${CIRCLE_ID}/invites`, body);
    expect(result.invite.invite_code).toBe('ABC123');
  });
});

describe('cancelInvite', () => {
  it('DELETEs /invites/:inviteId', async () => {
    mockDelete.mockResolvedValue({ success: true, data: {} });
    await cancelInvite(INVITE_ID);
    expect(mockDelete).toHaveBeenCalledWith(`/invites/${INVITE_ID}`);
  });
});

describe('acceptInvite', () => {
  it('POSTs /invites/:inviteId/accept', async () => {
    mockPost.mockResolvedValue({ success: true, data: {} });
    await acceptInvite(INVITE_ID);
    expect(mockPost).toHaveBeenCalledWith(`/invites/${INVITE_ID}/accept`);
  });
});

describe('getPendingInvites', () => {
  it('GETs /invites/pending and unwraps the invites array', async () => {
    const invites = [{ id: INVITE_ID, member_type: 'caregiver' }];
    mockGet.mockResolvedValue({ success: true, data: { invites } });
    const result = await getPendingInvites();
    expect(mockGet).toHaveBeenCalledWith('/invites/pending');
    expect(result).toEqual(invites);
  });
});

describe('lookupInviteByCode', () => {
  it('GETs /invites/code/:code (normalized) and unwraps data.invite', async () => {
    const invite = {
      id: INVITE_ID,
      invite_code: 'ABC123',
      member_type: 'caregiver',
      circle: { id: CIRCLE_ID, name: "Rose's Circle", recipient_name: 'Rose' },
      invited_by: { email: 'a@b.com', first_name: 'Ada', last_name: null },
      expires_at: '2026-07-01T00:00:00Z',
    };
    mockGet.mockResolvedValue({ success: true, data: { invite } });

    // Lowercase + surrounding whitespace must be normalized before the request.
    const result = await lookupInviteByCode('  abc123  ');

    expect(mockGet).toHaveBeenCalledWith('/invites/code/ABC123');
    expect(result).toEqual(invite);
  });
});

describe('acceptInviteByCode', () => {
  it('POSTs /invites/code/:code/accept (normalized)', async () => {
    mockPost.mockResolvedValue({ success: true, data: {} });

    await acceptInviteByCode('abc123');

    expect(mockPost).toHaveBeenCalledWith('/invites/code/ABC123/accept');
  });
});

describe('removeMember', () => {
  it('DELETEs /circles/:cid/members/:uid', async () => {
    mockDelete.mockResolvedValue({ success: true, data: { message: 'ok' } });
    await removeMember(CIRCLE_ID, USER_ID);
    expect(mockDelete).toHaveBeenCalledWith(`/circles/${CIRCLE_ID}/members/${USER_ID}`);
  });
});

describe('leaveCircle', () => {
  it('POSTs /circles/:cid/leave', async () => {
    mockPost.mockResolvedValue({ success: true, data: { message: 'ok' } });
    await leaveCircle(CIRCLE_ID);
    expect(mockPost).toHaveBeenCalledWith(`/circles/${CIRCLE_ID}/leave`);
  });
});

describe('setMedicationResponsible', () => {
  it('PUTs /circles/:cid/medication-responsible with { userId }', async () => {
    mockPut.mockResolvedValue({ success: true, data: {} });
    await setMedicationResponsible(CIRCLE_ID, USER_ID);
    expect(mockPut).toHaveBeenCalledWith(`/circles/${CIRCLE_ID}/medication-responsible`, {
      userId: USER_ID,
    });
  });

  it('PUTs { userId: null } to clear the assignment', async () => {
    mockPut.mockResolvedValue({ success: true, data: {} });
    await setMedicationResponsible(CIRCLE_ID, null);
    expect(mockPut).toHaveBeenCalledWith(`/circles/${CIRCLE_ID}/medication-responsible`, {
      userId: null,
    });
  });
});

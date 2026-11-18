import { createCircle, getCircles, type Circle } from '@/api/circles';
import { createFirstCircleOnce, resetFirstCircleCreateForTests } from '../firstRunCreate';

vi.mock('@/api/circles', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/circles')>();
  return { ...actual, getCircles: vi.fn(), createCircle: vi.fn() };
});

const mockGet = vi.mocked(getCircles);
const mockCreate = vi.mocked(createCircle);
const circle = { id: 'c1', role: 'owner', recipient_name: 'Rosa' } as unknown as Circle;

beforeEach(() => {
  vi.clearAllMocks();
  resetFirstCircleCreateForTests();
});

describe('createFirstCircleOnce (the automatic POST /circles)', () => {
  it('POSITIVE: a name creates one circle with that name', async () => {
    mockGet.mockResolvedValue([]);
    mockCreate.mockResolvedValue(circle);
    const out = await createFirstCircleOnce({ recipient_name: 'Rosa', is_self_care: false });
    expect(out).toEqual({ circle, existed: false });
    expect(mockCreate).toHaveBeenCalledWith({ recipient_name: 'Rosa', is_self_care: false }, {});
  });

  it('POSITIVE: the draft key is sent as the Idempotency-Key option', async () => {
    mockGet.mockResolvedValue([]);
    mockCreate.mockResolvedValue(circle);
    await createFirstCircleOnce({ recipient_name: 'Rosa', is_self_care: false }, 'key-0123456789abcdef');
    expect(mockCreate).toHaveBeenCalledWith(
      { recipient_name: 'Rosa', is_self_care: false },
      { idempotencyKey: 'key-0123456789abcdef' }
    );
  });

  it('NEGATIVE: a double create (double mount / two calls in one tick) sends ONE POST and returns one circle', async () => {
    mockGet.mockResolvedValue([]);
    let resolve!: (c: Circle) => void;
    mockCreate.mockReturnValue(new Promise<Circle>((r) => (resolve = r)));
    const a = createFirstCircleOnce({ recipient_name: 'Rosa', is_self_care: false });
    const b = createFirstCircleOnce({ recipient_name: 'Rosa', is_self_care: false });
    await vi.waitFor(() => expect(mockCreate).toHaveBeenCalled());
    resolve(circle);
    const [ra, rb] = await Promise.all([a, b]);
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(ra.circle.id).toBe(rb.circle.id);
  });

  it('NEGATIVE: a retry whose first request DID land reuses that circle (GET /circles first), no second POST', async () => {
    mockGet.mockResolvedValue([circle]);
    const out = await createFirstCircleOnce({ recipient_name: 'Rosa', is_self_care: false });
    expect(out).toEqual({ circle, existed: true });
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('NEGATIVE: a circle the person only JOINS (member, not owner) is not taken as theirs', async () => {
    mockGet.mockResolvedValue([{ ...circle, id: 'other', role: 'member' } as Circle]);
    mockCreate.mockResolvedValue(circle);
    const out = await createFirstCircleOnce({ recipient_name: 'Rosa', is_self_care: false });
    expect(out.existed).toBe(false);
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it('POSITIVE: after a failure the next attempt really runs (Try again)', async () => {
    mockGet.mockResolvedValue([]);
    mockCreate.mockRejectedValueOnce(new Error('timeout')).mockResolvedValueOnce(circle);
    await expect(createFirstCircleOnce({ recipient_name: 'Rosa', is_self_care: false })).rejects.toThrow();
    await expect(createFirstCircleOnce({ recipient_name: 'Rosa', is_self_care: false })).resolves.toEqual({
      circle,
      existed: false,
    });
    expect(mockCreate).toHaveBeenCalledTimes(2);
  });
});

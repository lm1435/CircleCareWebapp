import { apiClient } from '@/lib/api';
import {
  deleteMedicationPhoto,
  getMedicationFormDetails,
  medicationPhotoProblem,
  uploadMedicationPhoto,
  MEDICATION_PHOTO_MAX_BYTES,
} from '@/api/medicationPhoto';

// `@/lib/api` is mocked globally (src/test/setup.ts); the envelope comes back already unwrapped.
const mockPost = vi.mocked(apiClient.post);
const mockGet = vi.mocked(apiClient.get);
const mockDelete = vi.mocked(apiClient.delete);
const fetchMock = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockResolvedValue({ ok: true });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const file = (name: string, type: string, bytes = 16) => new File([new Uint8Array(bytes)], name, { type });

describe('uploadMedicationPhoto', () => {
  it('asks for a signed URL with the extension, PUTs BYTES with an explicit Content-Type, returns the path', async () => {
    mockPost.mockResolvedValue({
      success: true,
      data: { uploadUrl: 'https://storage.example/upload?token=t', token: 't', path: 'medication-photos/c/e/1.png' },
    } as never);
    const result = await uploadMedicationPhoto('c', 'e', file('pill.png', 'image/png'));
    expect(mockPost).toHaveBeenCalledWith('/circles/c/medications/e/photo/upload-url', { fileExtension: 'png' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://storage.example/upload?token=t');
    expect(init.method).toBe('PUT');
    expect(init.headers).toEqual({ 'Content-Type': 'image/png' });
    // Never a Blob/File body: its own type could replace the header (the mobile 1.1.11 outage).
    expect(init.body).toBeInstanceOf(Uint8Array);
    expect(init.body).not.toBeInstanceOf(Blob);
    expect(init.signal).toBeDefined();
    expect(result).toEqual({ storagePath: 'medication-photos/c/e/1.png' });
  });

  it('a typeless .jpg still goes out as image/jpeg', async () => {
    mockPost.mockResolvedValue({ success: true, data: { uploadUrl: 'https://u', token: 't', path: 'p' } } as never);
    await uploadMedicationPhoto('c', 'e', file('IMG_1.JPG', ''));
    expect(mockPost).toHaveBeenCalledWith(expect.any(String), { fileExtension: 'jpg' });
    expect(fetchMock.mock.calls[0][1].headers).toEqual({ 'Content-Type': 'image/jpeg' });
  });

  it('local dev (no upload URL): nothing is PUT, the path comes back', async () => {
    mockPost.mockResolvedValue({ success: true, data: { uploadUrl: null, token: null, path: 'p' } } as never);
    expect(await uploadMedicationPhoto('c', 'e', file('a.webp', 'image/webp'))).toEqual({ storagePath: 'p' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('a refused PUT throws', async () => {
    mockPost.mockResolvedValue({ success: true, data: { uploadUrl: 'https://u', token: 't', path: 'p' } } as never);
    fetchMock.mockResolvedValue({ ok: false, status: 400 });
    await expect(uploadMedicationPhoto('c', 'e', file('a.png', 'image/png'))).rejects.toThrow();
  });
});

describe('medicationPhotoProblem', () => {
  it('matches the bucket: jpeg/png/webp up to 2 MB', () => {
    expect(medicationPhotoProblem(file('a.png', 'image/png'))).toBeNull();
    expect(medicationPhotoProblem(file('a.gif', 'image/gif'))).toBe('type');
    expect(medicationPhotoProblem(file('a.heic', 'image/heic'))).toBe('type');
    expect(medicationPhotoProblem(file('a.png', 'image/png', MEDICATION_PHOTO_MAX_BYTES))).toBeNull();
    expect(medicationPhotoProblem(file('a.png', 'image/png', MEDICATION_PHOTO_MAX_BYTES + 1))).toBe('size');
  });
});

describe('deleteMedicationPhoto / getMedicationFormDetails', () => {
  it('DELETEs the photo route', async () => {
    mockDelete.mockResolvedValue({ success: true } as never);
    await deleteMedicationPhoto('c', 'e');
    expect(mockDelete).toHaveBeenCalledWith('/circles/c/medications/e/photo');
  });

  it('narrows the single-event GET to the More details columns; the signed URL is returned apart', async () => {
    mockGet.mockResolvedValue({
      success: true,
      data: {
        event: {
          id: 'e',
          title: 'X',
          track_refills: true,
          quantity_in_bottle: 30,
          prescriber_name: 'Dr. Lee',
          medication_photo_url: 'https://signed.example/p.png',
        },
      },
    } as never);
    const { details, photoUrl } = await getMedicationFormDetails('c', 'e');
    expect(mockGet).toHaveBeenCalledWith('/circles/c/events/e');
    expect(photoUrl).toBe('https://signed.example/p.png');
    expect(details).toMatchObject({ track_refills: true, quantity_in_bottle: 30, prescriber_name: 'Dr. Lee' });
    expect(details).not.toHaveProperty('title');
    // The details never carry the signed URL itself.
    expect(details.medication_photo_url).toBe('stored');
  });
});

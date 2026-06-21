import { apiClient } from '@/lib/api';
import {
  uploadDocument,
  updateDocument,
  deleteDocument,
  documentFormSchema,
  documentEditSchema,
  validateDocumentFile,
  MAX_DOCUMENT_FILE_BYTES,
  type StorageUsage,
} from '@/api/documents';

// `@/lib/api` is mocked globally in src/test/setup.ts — apiClient.{post,patch,delete}
// are vi.fn()s. The response interceptor (unwrapping the envelope) is bypassed,
// so we resolve each mock with the already-unwrapped `{ success, data }` shape.
const mockPost = vi.mocked(apiClient.post);
const mockPatch = vi.mocked(apiClient.patch);
const mockDelete = vi.mocked(apiClient.delete);

const CIRCLE_ID = 'circle-1';
const DOC_ID = 'doc-1';
const document = { id: DOC_ID, circle_id: CIRCLE_ID, label: 'X' };

function makeFile(name = 'scan.pdf', bytes = 1024, type = 'application/pdf'): File {
  return new File([new Uint8Array(bytes)], name, { type });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('uploadDocument', () => {
  it('POSTs multipart FormData with the right fields + lets the browser set the boundary', async () => {
    mockPost.mockResolvedValue({ success: true, data: { document } } as never);
    const file = makeFile();

    const result = await uploadDocument(CIRCLE_ID, {
      file,
      label: 'Lab results',
      category: 'medical_records',
      fileExtension: 'pdf',
      note: 'fasting glucose',
    });

    expect(result).toEqual(document);
    expect(mockPost).toHaveBeenCalledTimes(1);

    const [url, body, config] = mockPost.mock.calls[0];
    expect(url).toBe(`/circles/${CIRCLE_ID}/documents/upload`);

    // Must be a real FormData with each appended field.
    expect(body).toBeInstanceOf(FormData);
    const form = body as FormData;
    expect(form.get('file')).toBe(file);
    expect(form.get('label')).toBe('Lab results');
    expect(form.get('category')).toBe('medical_records');
    expect(form.get('fileExtension')).toBe('pdf');
    expect(form.get('note')).toBe('fasting glucose');

    // CRITICAL: Content-Type forced to undefined so axios drops the default
    // application/json and the browser sets multipart/form-data + boundary.
    expect((config as { headers: Record<string, unknown> }).headers['Content-Type']).toBeUndefined();
  });

  it('omits the note field when no note is given', async () => {
    mockPost.mockResolvedValue({ success: true, data: { document } } as never);

    await uploadDocument(CIRCLE_ID, {
      file: makeFile(),
      label: 'Insurance card',
      category: 'insurance',
      fileExtension: 'png',
    });

    const form = mockPost.mock.calls[0][1] as FormData;
    expect(form.has('note')).toBe(false);
  });
});

describe('updateDocument', () => {
  it('PATCHes /circles/:cid/documents/:did with the metadata body', async () => {
    mockPatch.mockResolvedValue({ success: true, data: { document } } as never);

    await updateDocument(CIRCLE_ID, DOC_ID, { label: 'Renamed', note: null });

    expect(mockPatch).toHaveBeenCalledWith(`/circles/${CIRCLE_ID}/documents/${DOC_ID}`, {
      label: 'Renamed',
      note: null,
    });
  });
});

describe('deleteDocument', () => {
  it('DELETEs /circles/:cid/documents/:did', async () => {
    mockDelete.mockResolvedValue({ success: true } as never);

    await deleteDocument(CIRCLE_ID, DOC_ID);

    expect(mockDelete).toHaveBeenCalledWith(`/circles/${CIRCLE_ID}/documents/${DOC_ID}`);
  });
});

describe('documentFormSchema (mirrors backend createDocumentSchema)', () => {
  const base = {
    label: 'My doc',
    category: 'legal' as const,
    fileExtension: 'jpg' as const,
  };

  it('accepts a minimal valid form', () => {
    expect(documentFormSchema.safeParse(base).success).toBe(true);
  });

  it('rejects empty label and label over 200 chars', () => {
    expect(documentFormSchema.safeParse({ ...base, label: '' }).success).toBe(false);
    expect(documentFormSchema.safeParse({ ...base, label: 'a'.repeat(201) }).success).toBe(false);
    expect(documentFormSchema.safeParse({ ...base, label: 'a'.repeat(200) }).success).toBe(true);
  });

  it('enforces the category enum', () => {
    for (const category of ['medical_records', 'insurance', 'legal', 'prescriptions', 'other']) {
      expect(documentFormSchema.safeParse({ ...base, category }).success).toBe(true);
    }
    expect(documentFormSchema.safeParse({ ...base, category: 'misc' }).success).toBe(false);
  });

  it('enforces the fileExtension enum (jpg/jpeg/png/heic/pdf)', () => {
    for (const ext of ['jpg', 'jpeg', 'png', 'heic', 'pdf']) {
      expect(documentFormSchema.safeParse({ ...base, fileExtension: ext }).success).toBe(true);
    }
    expect(documentFormSchema.safeParse({ ...base, fileExtension: 'gif' }).success).toBe(false);
  });

  it('rejects a note over 500 chars', () => {
    expect(documentFormSchema.safeParse({ ...base, note: 'a'.repeat(501) }).success).toBe(false);
    expect(documentFormSchema.safeParse({ ...base, note: 'a'.repeat(500) }).success).toBe(true);
  });
});

describe('documentEditSchema (mirrors backend updateDocumentSchema)', () => {
  it('accepts an empty partial', () => {
    expect(documentEditSchema.safeParse({}).success).toBe(true);
  });

  it('allows a nullable note', () => {
    expect(documentEditSchema.safeParse({ note: null }).success).toBe(true);
  });

  it('still enforces label bounds when present', () => {
    expect(documentEditSchema.safeParse({ label: '' }).success).toBe(false);
  });
});

describe('validateDocumentFile', () => {
  const storage: StorageUsage = { used: 0, limit: 209715200 }; // 200MB

  it('passes a small file with plenty of remaining storage', () => {
    expect(validateDocumentFile(makeFile('a.pdf', 1024), storage)).toEqual({ ok: true });
  });

  it('rejects a file over the 10MB cap', () => {
    const big = makeFile('big.pdf', MAX_DOCUMENT_FILE_BYTES + 1);
    expect(validateDocumentFile(big, storage)).toEqual({
      ok: false,
      reason: 'too_large',
      maxBytes: MAX_DOCUMENT_FILE_BYTES,
    });
  });

  it('rejects a file that would exceed remaining storage', () => {
    const nearlyFull: StorageUsage = { used: 209715200 - 100, limit: 209715200 };
    const result = validateDocumentFile(makeFile('a.pdf', 500), nearlyFull);
    expect(result).toEqual({ ok: false, reason: 'storage_full', remainingBytes: 100 });
  });
});

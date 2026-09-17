import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

// Mock the api module's WRITE functions only (keep types/read fns intact).
vi.mock('@/api/documents', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/documents')>();
  return {
    ...actual,
    uploadDocument: vi.fn(),
    updateDocument: vi.fn(),
    deleteDocument: vi.fn(),
  };
});

// Deterministic translations so error toasts assert on a stable key string.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const showToast = vi.fn();
vi.mock('@/components/ui', () => ({
  useToast: () => ({ showToast }),
}));

const promptUpgrade = vi.fn();
vi.mock('@/hooks/usePremiumGate', () => ({
  usePremiumGate: () => ({ promptUpgrade }),
}));

const mockDocumentUpdated = vi.fn();
const mockDocumentDeleted = vi.fn();
vi.mock('@/lib/analytics', () => ({
  Analytics: {
    documentUploaded: vi.fn(),
    documentUpdated: (...args: unknown[]) => mockDocumentUpdated(...args),
    documentDeleted: (...args: unknown[]) => mockDocumentDeleted(...args),
    errorOccurred: vi.fn(),
  },
}));

import {
  uploadDocument,
  updateDocument,
  deleteDocument,
  type CircleDocument,
} from '@/api/documents';
import { queryKeys } from '@/lib/queryKeys';
import {
  useUploadDocument,
  useUpdateDocument,
  useDeleteDocument,
} from '@/hooks/useDocuments';

const CIRCLE_ID = 'circle-1';
const DOC_ID = 'doc-1';

const mockUpload = vi.mocked(uploadDocument);
const mockUpdate = vi.mocked(updateDocument);
const mockDelete = vi.mocked(deleteDocument);

function makeDoc(overrides: Partial<CircleDocument> = {}): CircleDocument {
  return {
    id: DOC_ID,
    circle_id: CIRCLE_ID,
    uploaded_by: 'user-1',
    label: 'Lab results',
    category: 'medical_records',
    note: null,
    file_path: 'circle-documents/circle-1/1.pdf',
    file_type: 'application/pdf',
    file_size: 1024,
    created_at: '2026-07-01T00:00:00Z',
    updated_at: '2026-07-01T00:00:00Z',
    ...overrides,
  };
}

function makeFile(): File {
  return new File([new Uint8Array(1024)], 'scan.pdf', { type: 'application/pdf' });
}

function setup() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, invalidateSpy, wrapper };
}

type InvalidateArg = Parameters<QueryClient['invalidateQueries']>[0];

function invalidatedWith(
  invalidateSpy: { mock: { calls: [InvalidateArg?, ...unknown[]][] } },
  key: readonly unknown[]
) {
  return invalidateSpy.mock.calls.some(
    (call) => JSON.stringify(call[0]?.queryKey) === JSON.stringify(key)
  );
}

const SUBSCRIPTION_ENVELOPE = {
  success: false,
  error: { code: 'SUBSCRIPTION_REQUIRED', message: 'upgrade' },
};
const STORAGE_FULL_ENVELOPE = {
  success: false,
  error: { code: 'STORAGE_LIMIT_EXCEEDED', message: 'full' },
};
const PERMISSION_ENVELOPE = {
  success: false,
  error: { code: 'FORBIDDEN', message: 'not uploader/owner' },
};
// The code a FROZEN circle's member actually gets. `backend/src/routes/
// documents.ts:673` and `backend/src/routes/upload.ts:328,:487` are the only
// emitters of a read-only refusal, and documents.ts was widened so a free-tier
// owner's NON-SELECTED circle (`view_only` false, `can_edit` false) is refused
// on upload/rename/delete. Nothing else on web sends this shape.
const READ_ONLY_MEMBER_ENVELOPE = {
  success: false,
  error: { code: 'READ_ONLY_MEMBER', message: 'This circle is read-only' },
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useUploadDocument', () => {
  it('uploads and invalidates the per-circle documents key on success', async () => {
    const { invalidateSpy, wrapper } = setup();
    mockUpload.mockResolvedValue(makeDoc());

    const { result } = renderHook(() => useUploadDocument(CIRCLE_ID), { wrapper });
    const payload = {
      file: makeFile(),
      label: 'Lab results',
      category: 'medical_records' as const,
      fileExtension: 'pdf' as const,
    };
    result.current.mutate(payload);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockUpload).toHaveBeenCalledWith(CIRCLE_ID, payload);
    expect(invalidatedWith(invalidateSpy, queryKeys.documents(CIRCLE_ID))).toBe(true);
  });

  it('distinguishes a 402 (free-tier 200MB) → upgrade prompt (promptUpgrade) + refetch circles', async () => {
    const { invalidateSpy, wrapper } = setup();
    mockUpload.mockRejectedValue(SUBSCRIPTION_ENVELOPE);

    const { result } = renderHook(() => useUploadDocument(CIRCLE_ID), { wrapper });
    result.current.mutate({
      file: makeFile(),
      label: 'x',
      category: 'other',
      fileExtension: 'pdf',
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(promptUpgrade).toHaveBeenCalled();
    expect(invalidatedWith(invalidateSpy, queryKeys.circles)).toBe(true);
  });

  it('distinguishes a 413 (premium 1GB) → storageFull toast (NOT subscription)', async () => {
    const { invalidateSpy, wrapper } = setup();
    mockUpload.mockRejectedValue(STORAGE_FULL_ENVELOPE);

    const { result } = renderHook(() => useUploadDocument(CIRCLE_ID), { wrapper });
    result.current.mutate({
      file: makeFile(),
      label: 'x',
      category: 'other',
      fileExtension: 'pdf',
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(showToast).toHaveBeenCalledWith('errors.storageFull', 'error');
    expect(promptUpgrade).not.toHaveBeenCalled();
    // 413 is a hard cap — no "refetch circle flags" (nothing to upgrade to).
    expect(invalidatedWith(invalidateSpy, queryKeys.circles)).toBe(false);
  });

  it('surfaces a 403 (not uploader/owner) → permissionDenied toast', async () => {
    const { wrapper } = setup();
    mockUpload.mockRejectedValue(PERMISSION_ENVELOPE);

    const { result } = renderHook(() => useUploadDocument(CIRCLE_ID), { wrapper });
    result.current.mutate({
      file: makeFile(),
      label: 'x',
      category: 'other',
      fileExtension: 'pdf',
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(showToast).toHaveBeenCalledWith('errors.permissionDenied', 'error');
  });
});

// ---------------------------------------------------------------------------
// A FROZEN circle's refusal must drive the read-only path, not the generic one.
// ---------------------------------------------------------------------------
// End-to-end for the code the server actually sends. A code the client does not
// recognise does not fail loudly — it falls through `isPermissionDeniedError`
// to the else branch, which shows "couldn't save" (wrong: nothing was wrong
// with the save) and, worse, does NOT call `invalidateCircleAccessFlags`. Both
// gating caches then stay stale for the rest of the session, so the Edit /
// Delete / Upload affordances keep being offered on a circle the server
// refuses every write on. Asserting the toast alone would miss the second half,
// so both are pinned here.
describe('read-only (frozen circle) refusals across every document write', () => {
  it('upload: READ_ONLY_MEMBER → permissionDenied toast + BOTH access caches refreshed', async () => {
    const { invalidateSpy, wrapper } = setup();
    mockUpload.mockRejectedValue(READ_ONLY_MEMBER_ENVELOPE);

    const { result } = renderHook(() => useUploadDocument(CIRCLE_ID), { wrapper });
    result.current.mutate({
      file: makeFile(),
      label: 'x',
      category: 'other',
      fileExtension: 'pdf',
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(showToast).toHaveBeenCalledWith('errors.permissionDenied', 'error');
    expect(showToast).not.toHaveBeenCalledWith('errors.saveFailed', 'error');
    // `invalidateCircleAccessFlags` refreshes the list AND the detail key.
    expect(invalidatedWith(invalidateSpy, queryKeys.circles)).toBe(true);
    expect(invalidatedWith(invalidateSpy, queryKeys.circleDetail(CIRCLE_ID))).toBe(true);
  });

  it('rename: READ_ONLY_MEMBER → permissionDenied toast + BOTH access caches refreshed', async () => {
    const { invalidateSpy, wrapper } = setup();
    mockUpdate.mockRejectedValue(READ_ONLY_MEMBER_ENVELOPE);

    const { result } = renderHook(() => useUpdateDocument(CIRCLE_ID), { wrapper });
    result.current.mutate({ documentId: DOC_ID, data: { label: 'Renamed' } });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(showToast).toHaveBeenCalledWith('errors.permissionDenied', 'error');
    expect(showToast).not.toHaveBeenCalledWith('errors.saveFailed', 'error');
    expect(invalidatedWith(invalidateSpy, queryKeys.circles)).toBe(true);
    expect(invalidatedWith(invalidateSpy, queryKeys.circleDetail(CIRCLE_ID))).toBe(true);
  });

  it('delete: READ_ONLY_MEMBER → permissionDenied toast + BOTH access caches refreshed', async () => {
    // The regression in the report: yesterday this delete SUCCEEDED. Today the
    // server refuses it, and before this fix the user saw "couldn't save".
    const { invalidateSpy, wrapper } = setup();
    mockDelete.mockRejectedValue(READ_ONLY_MEMBER_ENVELOPE);

    const { result } = renderHook(() => useDeleteDocument(CIRCLE_ID), { wrapper });
    result.current.mutate(DOC_ID);

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(showToast).toHaveBeenCalledWith('errors.permissionDenied', 'error');
    expect(showToast).not.toHaveBeenCalledWith('errors.saveFailed', 'error');
    expect(invalidatedWith(invalidateSpy, queryKeys.circles)).toBe(true);
    expect(invalidatedWith(invalidateSpy, queryKeys.circleDetail(CIRCLE_ID))).toBe(true);
  });

  it('is NOT mistaken for the 402 upgrade path — no purchase lifts a frozen seat', async () => {
    const { wrapper } = setup();
    mockDelete.mockRejectedValue(READ_ONLY_MEMBER_ENVELOPE);

    const { result } = renderHook(() => useDeleteDocument(CIRCLE_ID), { wrapper });
    result.current.mutate(DOC_ID);

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(promptUpgrade).not.toHaveBeenCalled();
  });
});

describe('useUpdateDocument', () => {
  it('PATCHes via the api fn and invalidates documents on success', async () => {
    const { invalidateSpy, wrapper } = setup();
    mockUpdate.mockResolvedValue(makeDoc({ label: 'Renamed' }));

    const { result } = renderHook(() => useUpdateDocument(CIRCLE_ID), { wrapper });
    result.current.mutate({ documentId: DOC_ID, data: { label: 'Renamed' } });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockUpdate).toHaveBeenCalledWith(CIRCLE_ID, DOC_ID, { label: 'Renamed' });
    expect(invalidatedWith(invalidateSpy, queryKeys.documents(CIRCLE_ID))).toBe(true);
  });

  it('fires Analytics.documentUpdated(circleId) on success', async () => {
    const { wrapper } = setup();
    mockUpdate.mockResolvedValue(makeDoc({ label: 'Renamed' }));

    const { result } = renderHook(() => useUpdateDocument(CIRCLE_ID), { wrapper });
    result.current.mutate({ documentId: DOC_ID, data: { label: 'Renamed' } });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockDocumentUpdated).toHaveBeenCalledWith(CIRCLE_ID);
  });
});

describe('useDeleteDocument', () => {
  it('deletes via the api fn and invalidates documents on success', async () => {
    const { invalidateSpy, wrapper } = setup();
    mockDelete.mockResolvedValue(undefined);

    const { result } = renderHook(() => useDeleteDocument(CIRCLE_ID), { wrapper });
    result.current.mutate(DOC_ID);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockDelete).toHaveBeenCalledWith(CIRCLE_ID, DOC_ID);
    expect(invalidatedWith(invalidateSpy, queryKeys.documents(CIRCLE_ID))).toBe(true);
  });

  it('fires Analytics.documentDeleted(circleId) on success', async () => {
    const { wrapper } = setup();
    mockDelete.mockResolvedValue(undefined);

    const { result } = renderHook(() => useDeleteDocument(CIRCLE_ID), { wrapper });
    result.current.mutate(DOC_ID);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockDocumentDeleted).toHaveBeenCalledWith(CIRCLE_ID);
  });
});

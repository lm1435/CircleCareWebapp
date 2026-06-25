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

  it('distinguishes a 402 (free-tier 200MB) → subscriptionRequired toast + refetch circles', async () => {
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
});

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import '@/i18n';
import { apiClient } from '@/lib/api';
import { ToastProvider } from '@/components/ui';
import DocumentsPage from '@/pages/DocumentsPage';

// @/lib/api is mocked globally in src/test/setup.ts. The real apiClient's
// response interceptor unwraps to the `{ success, data }` envelope, so the
// mock resolves with the envelope directly.
const mockedGet = vi.mocked(apiClient.get);

const CIRCLE_ID = 'circle-1';

// The page derives upload/edit/delete affordances from useCircle (gating +
// owner) and useAuthStore (current user). Default to read-only so the existing
// read-side assertions are unchanged; individual tests override canEdit.
const useCircleResult = {
  circle: undefined as { owner_id: string } | undefined,
  circleSummary: undefined,
  timezone: 'America/New_York',
  members: [],
  canEdit: false,
  accessLevel: undefined,
  viewOnly: false,
  readOnly: false,
  isLoading: false,
  isError: false,
  refetch: vi.fn(),
};
vi.mock('@/hooks/useCircle', () => ({
  useCircle: () => useCircleResult,
}));

vi.mock('@/store/authStore', () => ({
  useAuthStore: (selector: (s: { user: { id: string } | null }) => unknown) =>
    selector({ user: { id: 'user-1' } }),
}));

const imageDoc = {
  id: 'doc-1',
  circle_id: CIRCLE_ID,
  uploaded_by: 'user-1',
  label: 'Insurance Card',
  category: 'insurance',
  note: null,
  file_path: 'circle-documents/circle-1/1.jpg',
  file_type: 'image/jpeg',
  file_size: 524288, // 512 KB
  created_at: '2026-05-02T12:00:00.000Z',
  updated_at: '2026-05-02T12:00:00.000Z',
  file_url: 'https://storage.example.com/sign/1.jpg?token=image-token',
};

const pdfDoc = {
  id: 'doc-2',
  circle_id: CIRCLE_ID,
  uploaded_by: 'user-1',
  label: 'Power of Attorney',
  category: 'legal',
  note: null,
  file_path: 'circle-documents/circle-1/2.pdf',
  file_type: 'application/pdf',
  file_size: 2097152, // 2.0 MB
  created_at: '2026-05-01T12:00:00.000Z',
  updated_at: '2026-05-01T12:00:00.000Z',
  file_url: 'https://storage.example.com/sign/2.pdf?token=pdf-token',
};

function envelope(documents: unknown[]) {
  return {
    success: true,
    data: { documents, storage: { used: 2621440, limit: 209715200 } },
  };
}

function mockDocuments(documents: unknown[] = [imageDoc, pdfDoc]): void {
  mockedGet.mockImplementation(async (_url: string, config?: { params?: { category?: string } }) => {
    const category = config?.params?.category;
    return envelope(
      category
        ? documents.filter((doc) => (doc as { category: string }).category === category)
        : documents
    );
  });
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <MemoryRouter initialEntries={[`/circles/${CIRCLE_ID}/documents`]}>
          <Routes>
            <Route path="/circles/:circleId/documents" element={<DocumentsPage />} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>
  );
}

describe('DocumentsPage', () => {
  beforeEach(() => {
    mockedGet.mockReset();
    vi.mocked(apiClient.delete).mockReset();
    useCircleResult.canEdit = false;
    useCircleResult.circle = undefined;
  });

  it('renders the document list with name, category, size, and count', async () => {
    mockDocuments();
    renderPage();

    expect(await screen.findByText('Insurance Card')).toBeInTheDocument();
    expect(screen.getByText('Power of Attorney')).toBeInTheDocument();

    // Category badge inside the row (the filter chip also says "Legal")
    const pdfRow = screen.getByText('Power of Attorney').closest('li');
    expect(pdfRow).not.toBeNull();
    expect(within(pdfRow as HTMLElement).getByText('Legal')).toBeInTheDocument();

    // Human-readable sizes
    expect(screen.getByText('512 KB')).toBeInTheDocument();
    expect(screen.getByText('2.0 MB')).toBeInTheDocument();

    // Count + storage summary
    expect(screen.getByText(/2 documents/)).toBeInTheDocument();
    expect(screen.getByText(/2\.5 MB of 200\.0 MB used/)).toBeInTheDocument();
  });

  it('filters by category client-side without refetching', async () => {
    mockDocuments();
    renderPage();

    await screen.findByText('Insurance Card');
    const callsBefore = mockedGet.mock.calls.length;

    fireEvent.click(screen.getByRole('button', { name: 'Legal' }));

    expect(screen.getByText('Power of Attorney')).toBeInTheDocument();
    expect(screen.queryByText('Insurance Card')).not.toBeInTheDocument();
    // Chip reflects pressed state
    expect(screen.getByRole('button', { name: 'Legal' })).toHaveAttribute('aria-pressed', 'true');
    // No extra network call — the hook filters the cached list
    expect(mockedGet.mock.calls.length).toBe(callsBefore);

    // Switching back restores the full list
    fireEvent.click(screen.getByRole('button', { name: 'All' }));
    expect(screen.getByText('Insurance Card')).toBeInTheDocument();
  });

  it('downloads via a fresh signed URL fetched at click time', async () => {
    mockDocuments();
    const clickedHrefs: string[] = [];
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(function (this: HTMLAnchorElement) {
        clickedHrefs.push(this.href);
      });

    renderPage();
    await screen.findByText('Insurance Card');
    const callsBefore = mockedGet.mock.calls.length;

    fireEvent.click(screen.getByRole('button', { name: 'Download Insurance Card' }));

    await waitFor(() => expect(clickSpy).toHaveBeenCalledTimes(1));
    // A FRESH signed URL was requested at click time (narrowed by category)
    expect(mockedGet.mock.calls.length).toBe(callsBefore + 1);
    expect(mockedGet).toHaveBeenLastCalledWith(`/circles/${CIRCLE_ID}/documents`, {
      params: { category: 'insurance' },
    });
    // The anchor used the signed URL with the attachment filename appended
    expect(clickedHrefs[0]).toContain('token=image-token');
    expect(clickedHrefs[0]).toContain('download=Insurance+Card.jpg');

    clickSpy.mockRestore();
  });

  it('shows an error toast when fetching the signed URL fails', async () => {
    mockDocuments();
    renderPage();
    await screen.findByText('Insurance Card');

    mockedGet.mockRejectedValue(
      { success: false, error: { code: 'SERVER_ERROR', message: 'Internal server error' } }
    );
    fireEvent.click(screen.getByRole('button', { name: 'Download Insurance Card' }));

    expect(await screen.findByText('Download failed. Please try again.')).toBeInTheDocument();
  });

  it('opens the preview modal and moves focus to the close button', async () => {
    mockDocuments();
    renderPage();
    await screen.findByText('Insurance Card');

    fireEvent.click(screen.getByRole('button', { name: 'Preview Insurance Card' }));

    const dialog = await screen.findByRole('dialog', { name: 'Insurance Card' });
    expect(dialog).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close preview' })).toHaveFocus();

    // The image renders from the freshly fetched signed URL
    const image = await screen.findByRole('img', { name: 'Insurance Card' });
    expect(image).toHaveAttribute('src', imageDoc.file_url);
  });

  it('offers preview only for renderable types (no preview for HEIC)', async () => {
    mockDocuments([{ ...imageDoc, id: 'doc-3', label: 'HEIC Photo', file_type: 'image/heic' }]);
    renderPage();

    await screen.findByText('HEIC Photo');
    expect(screen.queryByRole('button', { name: 'Preview HEIC Photo' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download HEIC Photo' })).toBeInTheDocument();
  });

  it('shows the empty state when there are no documents', async () => {
    mockDocuments([]);
    renderPage();

    expect(await screen.findByText('No documents yet')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Documents shared with this circle will appear here so everyone helping can find them when it matters.'
      )
    ).toBeInTheDocument();
  });

  it('shows the per-category empty state', async () => {
    mockDocuments([pdfDoc]);
    renderPage();

    await screen.findByText('Power of Attorney');
    fireEvent.click(screen.getByRole('button', { name: 'Insurance' }));

    expect(screen.getByText('No documents in this category')).toBeInTheDocument();
  });

  it('shows the error state with retry when loading fails', async () => {
    mockedGet.mockRejectedValue(
      { success: false, error: { code: 'SERVER_ERROR', message: 'Internal server error' } }
    );
    renderPage();

    expect(await screen.findByText("We couldn't load the documents.")).toBeInTheDocument();

    mockDocuments();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Insurance Card')).toBeInTheDocument();
  });

  it('hides upload + edit/delete affordances when the user cannot edit', async () => {
    mockDocuments();
    renderPage();

    await screen.findByText('Insurance Card');
    expect(screen.queryByRole('button', { name: 'Upload document' })).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Edit Insurance Card' })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Delete Insurance Card' })
    ).not.toBeInTheDocument();
    // The app-only upload CTA is shown instead.
    expect(screen.getByText('Need to add a document?')).toBeInTheDocument();
  });

  it('shows upload + per-row edit/delete for the uploader when editable', async () => {
    useCircleResult.canEdit = true;
    useCircleResult.circle = { owner_id: 'someone-else' };
    mockDocuments();
    renderPage();

    await screen.findByText('Insurance Card');
    // current user (user-1) is the uploader of both docs → manage allowed
    expect(screen.getByRole('button', { name: 'Upload document' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit Insurance Card' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete Insurance Card' })).toBeInTheDocument();
  });

  it('hides edit/delete for documents uploaded by others when not the owner', async () => {
    useCircleResult.canEdit = true;
    useCircleResult.circle = { owner_id: 'someone-else' };
    mockDocuments([{ ...imageDoc, uploaded_by: 'another-user' }]);
    renderPage();

    await screen.findByText('Insurance Card');
    expect(
      screen.queryByRole('button', { name: 'Edit Insurance Card' })
    ).not.toBeInTheDocument();
  });

  it('shows edit/delete for any document when the user is the circle owner', async () => {
    useCircleResult.canEdit = true;
    useCircleResult.circle = { owner_id: 'user-1' }; // current user owns the circle
    mockDocuments([{ ...imageDoc, uploaded_by: 'another-user' }]);
    renderPage();

    await screen.findByText('Insurance Card');
    expect(screen.getByRole('button', { name: 'Edit Insurance Card' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete Insurance Card' })).toBeInTheDocument();
  });

  it('confirms and deletes a document', async () => {
    useCircleResult.canEdit = true;
    useCircleResult.circle = { owner_id: 'user-1' };
    mockDocuments();
    vi.mocked(apiClient.delete).mockResolvedValue(undefined as never);
    renderPage();

    await screen.findByText('Insurance Card');
    fireEvent.click(screen.getByRole('button', { name: 'Delete Insurance Card' }));

    // Confirm dialog appears.
    const dialog = await screen.findByRole('dialog', { name: 'Delete document?' });
    expect(within(dialog).getByText(/Insurance Card/)).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));

    await waitFor(() =>
      expect(apiClient.delete).toHaveBeenCalledWith(`/circles/${CIRCLE_ID}/documents/doc-1`)
    );
  });
});

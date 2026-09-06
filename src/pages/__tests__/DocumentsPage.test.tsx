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

function envelope(documents: unknown[], storage: { used: number; limit: number }) {
  return {
    success: true,
    data: { documents, storage },
  };
}

function mockDocuments(
  documents: unknown[] = [imageDoc, pdfDoc],
  storage: { used: number; limit: number } = { used: 2621440, limit: 209715200 }
): void {
  // axios 1.20+ types `params` as a generic (`unknown` by default), so accept
  // the wide shape and narrow here.
  mockedGet.mockImplementation(async (_url: string, config?: { params?: unknown }) => {
    const category = (config?.params as { category?: string } | undefined)?.category;
    return envelope(
      category
        ? documents.filter((doc) => (doc as { category: string }).category === category)
        : documents,
      storage
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

/** Opens the per-row `MoreMenu` for the document with this label. */
function openRowMenu(label: string): void {
  fireEvent.click(screen.getByRole('button', { name: `Options for ${label}` }));
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

    // Count + storage footnote (below the 80% threshold — StorageBar renders
    // only the footnote).
    expect(screen.getByText(/2 documents/)).toBeInTheDocument();
    expect(screen.getByText(/2\.5 MB of 200\.0 MB used/)).toBeInTheDocument();
  });

  it('renders the subtitle under the page title', async () => {
    mockDocuments();
    renderPage();

    expect(await screen.findByText('Insurance Card')).toBeInTheDocument();
    expect(
      screen.getByText('Insurance cards, records, and directives, in one place.')
    ).toBeInTheDocument();
  });

  it('filters by category client-side without refetching', async () => {
    mockDocuments();
    renderPage();

    await screen.findByText('Insurance Card');
    const callsBefore = mockedGet.mock.calls.length;

    fireEvent.click(screen.getByRole('radio', { name: 'Legal' }));

    expect(screen.getByText('Power of Attorney')).toBeInTheDocument();
    expect(screen.queryByText('Insurance Card')).not.toBeInTheDocument();
    // Chip reflects checked state
    expect(screen.getByRole('radio', { name: 'Legal' })).toBeChecked();
    // No extra network call — the hook filters the cached list
    expect(mockedGet.mock.calls.length).toBe(callsBefore);

    // Switching back restores the full list
    fireEvent.click(screen.getByRole('radio', { name: 'All' }));
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

    openRowMenu('Insurance Card');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Download' }));

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
    openRowMenu('Insurance Card');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Download' }));

    expect(await screen.findByText('Download failed. Please try again.')).toBeInTheDocument();
  });

  it('opens the preview modal and renders the image from the actions menu', async () => {
    mockDocuments();
    renderPage();
    await screen.findByText('Insurance Card');

    openRowMenu('Insurance Card');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Preview' }));

    const dialog = await screen.findByRole('dialog', { name: 'Insurance Card' });
    expect(dialog).toBeInTheDocument();

    // The image renders from the freshly fetched signed URL
    const image = await screen.findByRole('img', { name: 'Insurance Card' });
    expect(image).toHaveAttribute('src', imageDoc.file_url);
  });

  it('offers preview only for renderable types (no preview for HEIC)', async () => {
    mockDocuments([{ ...imageDoc, id: 'doc-3', label: 'HEIC Photo', file_type: 'image/heic' }]);
    renderPage();

    await screen.findByText('HEIC Photo');
    openRowMenu('HEIC Photo');
    expect(screen.queryByRole('menuitem', { name: 'Preview' })).not.toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Download' })).toBeInTheDocument();
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
    // Two categories, so the chip row is on screen to filter with.
    mockDocuments([imageDoc, pdfDoc]);
    renderPage();

    await screen.findByText('Power of Attorney');
    fireEvent.click(screen.getByRole('radio', { name: 'Prescriptions' }));

    expect(screen.getByText('Nothing in Prescriptions yet.')).toBeInTheDocument();
    // The way out: back to every document, not a dead end.
    fireEvent.click(screen.getByRole('button', { name: 'Show all documents' }));
    expect(screen.getByText('Power of Attorney')).toBeInTheDocument();
  });

  it('hides the category chips while every document sits in one category', async () => {
    mockDocuments([pdfDoc]);
    renderPage();

    await screen.findByText('Power of Attorney');
    expect(screen.queryByRole('radiogroup', { name: 'Filter by category' })).toBeNull();
  });

  it('shows the category chips once a second category exists', async () => {
    mockDocuments([imageDoc, pdfDoc]);
    renderPage();

    await screen.findByText('Power of Attorney');
    expect(screen.getByRole('radiogroup', { name: 'Filter by category' })).toBeInTheDocument();
  });

  it('shows the starter kit instead of the generic empty state when an editor has no documents', async () => {
    useCircleResult.canEdit = true;
    useCircleResult.circle = { owner_id: 'user-1' };
    mockDocuments([]);
    renderPage();

    expect(await screen.findByRole('heading', { name: 'Start with these four' })).toBeInTheDocument();
    expect(screen.queryByText('No documents yet')).toBeNull();
    // No filter row and no 0% storage meter over nothing.
    expect(screen.queryByRole('radiogroup', { name: 'Filter by category' })).toBeNull();
  });

  it('opens the upload form preset from a starter row', async () => {
    useCircleResult.canEdit = true;
    useCircleResult.circle = { owner_id: 'user-1' };
    mockDocuments([]);
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: /^Insurance card\./ }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByLabelText(/^Name/)).toHaveValue('Insurance card');
    expect(within(dialog).getByLabelText(/^Category/)).toHaveValue('insurance');
  });

  it('renders the empty-state icon as a real icon, not a literal icon-name string', async () => {
    // EmptyState's `icon` prop accepts IconName | ReactNode, so a stale/unknown
    // icon name silently falls through to the ReactNode branch and renders as
    // literal text with no type error — this guards against that regression.
    mockDocuments([]);
    const { container } = renderPage();

    await screen.findByText('No documents yet');
    expect(container.querySelector('svg')).toBeInTheDocument();
    expect(screen.queryByText('folder-outline')).not.toBeInTheDocument();
    expect(screen.queryByText('document-text-outline')).not.toBeInTheDocument();
  });

  it('shows the error state with retry when loading fails', async () => {
    mockedGet.mockRejectedValue(
      { success: false, error: { code: 'SERVER_ERROR', message: 'Internal server error' } }
    );
    renderPage();

    expect(await screen.findByText("Couldn't load documents")).toBeInTheDocument();

    mockDocuments();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Insurance Card')).toBeInTheDocument();
  });

  it('hides upload + edit/delete affordances when the user cannot edit', async () => {
    mockDocuments();
    renderPage();

    await screen.findByText('Insurance Card');
    expect(screen.queryByRole('button', { name: 'Upload document' })).not.toBeInTheDocument();
    openRowMenu('Insurance Card');
    expect(screen.queryByRole('menuitem', { name: 'Edit' })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Delete' })).not.toBeInTheDocument();
    // The app-only upload CTA is shown instead.
    expect(screen.getByText('Want to add a document?')).toBeInTheDocument();
  });

  it('shows upload + per-row edit/delete for the uploader when editable', async () => {
    useCircleResult.canEdit = true;
    useCircleResult.circle = { owner_id: 'someone-else' };
    mockDocuments();
    renderPage();

    await screen.findByText('Insurance Card');
    // current user (user-1) is the uploader of both docs → manage allowed.
    // The masthead's rightAction renders twice (icon-only below xl, labelled
    // button at xl) — both carry this accessible name, hence getAllByRole.
    expect(screen.getAllByRole('button', { name: 'Upload document' }).length).toBeGreaterThan(0);
    openRowMenu('Insurance Card');
    expect(screen.getByRole('menuitem', { name: 'Edit' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Delete' })).toBeInTheDocument();
  });

  it('disables the masthead upload action with a tooltip when storage is full', async () => {
    useCircleResult.canEdit = true;
    useCircleResult.circle = { owner_id: 'user-1' };
    mockDocuments([imageDoc, pdfDoc], { used: 209715200, limit: 209715200 });
    renderPage();

    await screen.findByText('Insurance Card');
    const uploadButtons = screen.getAllByRole('button', { name: 'Upload document' });
    expect(uploadButtons.length).toBeGreaterThan(0);
    for (const button of uploadButtons) {
      expect(button).toBeDisabled();
      expect(button).toHaveAttribute(
        'title',
        'This circle has reached its storage limit. Free up space or upgrade to Premium to add more.'
      );
    }
  });

  it('disables the empty-state upload button with the storage-full caption when storage is full', async () => {
    useCircleResult.canEdit = true;
    useCircleResult.circle = { owner_id: 'user-1' };
    mockDocuments([], { used: 209715200, limit: 209715200 });
    renderPage();

    await screen.findByText('No documents yet');
    const uploadButton = screen.getByRole('button', { name: "Upload your first document" });
    expect(uploadButton).toBeDisabled();
    expect(
      screen.getByText(
        'This circle has reached its storage limit. Free up space or upgrade to Premium to add more.'
      )
    ).toBeInTheDocument();
  });

  it('hides edit/delete for documents uploaded by others when not the owner', async () => {
    useCircleResult.canEdit = true;
    useCircleResult.circle = { owner_id: 'someone-else' };
    mockDocuments([{ ...imageDoc, uploaded_by: 'another-user' }]);
    renderPage();

    await screen.findByText('Insurance Card');
    openRowMenu('Insurance Card');
    expect(screen.queryByRole('menuitem', { name: 'Edit' })).not.toBeInTheDocument();
  });

  it('shows edit/delete for any document when the user is the circle owner', async () => {
    useCircleResult.canEdit = true;
    useCircleResult.circle = { owner_id: 'user-1' }; // current user owns the circle
    mockDocuments([{ ...imageDoc, uploaded_by: 'another-user' }]);
    renderPage();

    await screen.findByText('Insurance Card');
    openRowMenu('Insurance Card');
    expect(screen.getByRole('menuitem', { name: 'Edit' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Delete' })).toBeInTheDocument();
  });

  it('confirms and deletes a document', async () => {
    useCircleResult.canEdit = true;
    useCircleResult.circle = { owner_id: 'user-1' };
    mockDocuments();
    vi.mocked(apiClient.delete).mockResolvedValue(undefined as never);
    renderPage();

    await screen.findByText('Insurance Card');
    openRowMenu('Insurance Card');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));

    // Confirm dialog appears.
    const dialog = await screen.findByRole('dialog', { name: 'Delete document?' });
    expect(within(dialog).getByText(/Insurance Card/)).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));

    await waitFor(() =>
      expect(apiClient.delete).toHaveBeenCalledWith(`/circles/${CIRCLE_ID}/documents/doc-1`)
    );
  });
});

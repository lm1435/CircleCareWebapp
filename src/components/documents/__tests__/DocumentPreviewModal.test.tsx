import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@/i18n';
import { apiClient } from '@/lib/api';
import type { CircleDocument } from '@/api/documents';
import { DocumentPreviewModal } from '@/components/documents/DocumentPreviewModal';

// @/lib/api is mocked globally in src/test/setup.ts (resolves the unwrapped
// `{ success, data }` envelope, like the real response interceptor).
const mockedGet = vi.mocked(apiClient.get);

const CIRCLE_ID = 'circle-1';

const baseDoc: CircleDocument = {
  id: 'doc-1',
  circle_id: CIRCLE_ID,
  uploaded_by: 'user-1',
  label: 'Insurance Card',
  category: 'insurance',
  note: null,
  file_path: 'circle-documents/circle-1/1.jpg',
  file_type: 'image/jpeg',
  file_size: 524288,
  created_at: '2026-05-02T12:00:00.000Z',
  updated_at: '2026-05-02T12:00:00.000Z',
};

const pdfDoc: CircleDocument = {
  ...baseDoc,
  id: 'doc-2',
  label: 'Power of Attorney',
  category: 'legal',
  file_path: 'circle-documents/circle-1/2.pdf',
  file_type: 'application/pdf',
};

const SIGNED_URL = 'https://storage.example.com/sign/file?token=fresh-token';

function mockSignedUrl(doc: CircleDocument, fileUrl: string | null = SIGNED_URL): void {
  mockedGet.mockResolvedValue({
    success: true,
    data: {
      documents: [{ ...doc, file_url: fileUrl }],
      storage: { used: 0, limit: 209715200 },
    },
  });
}

describe('DocumentPreviewModal', () => {
  beforeEach(() => {
    mockedGet.mockReset();
  });

  it('fetches a fresh signed URL on open and renders the image', async () => {
    mockSignedUrl(baseDoc);
    render(<DocumentPreviewModal doc={baseDoc} circleId={CIRCLE_ID} onClose={vi.fn()} />);

    const image = await screen.findByRole('img', { name: 'Insurance Card' });
    expect(image).toHaveAttribute('src', SIGNED_URL);
    expect(mockedGet).toHaveBeenCalledWith(`/circles/${CIRCLE_ID}/documents`, {
      params: { category: 'insurance' },
    });
  });

  it('renders PDFs in a fully sandboxed iframe with fallbacks', async () => {
    mockSignedUrl(pdfDoc);
    render(<DocumentPreviewModal doc={pdfDoc} circleId={CIRCLE_ID} onClose={vi.fn()} />);

    const iframe = await screen.findByTitle('Power of Attorney');
    expect(iframe.tagName).toBe('IFRAME');
    expect(iframe).toHaveAttribute('sandbox', '');
    expect(iframe).toHaveAttribute('src', SIGNED_URL);

    const newTabLink = screen.getByRole('link', { name: 'Open in new tab' });
    expect(newTabLink).toHaveAttribute('href', SIGNED_URL);
    expect(newTabLink).toHaveAttribute('rel', 'noopener noreferrer');
    expect(screen.getByRole('button', { name: 'Download Power of Attorney' })).toBeInTheDocument();
  });

  it('moves focus to the close button on open and restores it on close', async () => {
    const outsideButton = document.createElement('button');
    outsideButton.textContent = 'outside';
    document.body.appendChild(outsideButton);
    outsideButton.focus();

    mockSignedUrl(baseDoc);
    const { unmount } = render(
      <DocumentPreviewModal doc={baseDoc} circleId={CIRCLE_ID} onClose={vi.fn()} />
    );

    expect(screen.getByRole('button', { name: 'Close preview' })).toHaveFocus();

    unmount();
    expect(outsideButton).toHaveFocus();
    outsideButton.remove();
  });

  it('traps Tab focus inside the dialog', async () => {
    mockSignedUrl(baseDoc);
    render(<DocumentPreviewModal doc={baseDoc} circleId={CIRCLE_ID} onClose={vi.fn()} />);

    await screen.findByRole('img', { name: 'Insurance Card' });
    const dialog = screen.getByRole('dialog', { name: 'Insurance Card' });
    const closeButton = screen.getByRole('button', { name: 'Close preview' });
    const downloadButton = screen.getByRole('button', { name: 'Download Insurance Card' });

    // Tab from the last focusable wraps to the first
    downloadButton.focus();
    fireEvent.keyDown(dialog, { key: 'Tab' });
    expect(closeButton).toHaveFocus();

    // Shift+Tab from the first focusable wraps to the last
    closeButton.focus();
    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });
    expect(downloadButton).toHaveFocus();
  });

  it('closes on Escape', async () => {
    const onClose = vi.fn();
    mockSignedUrl(baseDoc);
    render(<DocumentPreviewModal doc={baseDoc} circleId={CIRCLE_ID} onClose={onClose} />);

    await screen.findByRole('img', { name: 'Insurance Card' });
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('shows an error state with retry when the signed URL fetch fails', async () => {
    mockedGet.mockRejectedValueOnce(
      { success: false, error: { code: 'SERVER_ERROR', message: 'Internal server error' } }
    );
    mockSignedUrl(baseDoc); // mockResolvedValue applies after the rejected first call

    render(<DocumentPreviewModal doc={baseDoc} circleId={CIRCLE_ID} onClose={vi.fn()} />);

    expect(await screen.findByText("We couldn't load the preview.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('img', { name: 'Insurance Card' })).toBeInTheDocument();
    expect(mockedGet).toHaveBeenCalledTimes(2);
  });

  it('shows the error state when the document has no signed URL', async () => {
    mockSignedUrl(baseDoc, null);
    render(<DocumentPreviewModal doc={baseDoc} circleId={CIRCLE_ID} onClose={vi.fn()} />);

    expect(await screen.findByText("We couldn't load the preview.")).toBeInTheDocument();
  });

  it('downloads from the already-fetched signed URL via a temporary anchor', async () => {
    mockSignedUrl(baseDoc);
    const clickedHrefs: string[] = [];
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(function (this: HTMLAnchorElement) {
        clickedHrefs.push(this.href);
      });

    render(<DocumentPreviewModal doc={baseDoc} circleId={CIRCLE_ID} onClose={vi.fn()} />);
    await screen.findByRole('img', { name: 'Insurance Card' });

    fireEvent.click(screen.getByRole('button', { name: 'Download Insurance Card' }));

    await waitFor(() => expect(clickSpy).toHaveBeenCalledTimes(1));
    expect(clickedHrefs[0]).toContain('token=fresh-token');
    expect(clickedHrefs[0]).toContain('download=Insurance+Card.jpg');

    clickSpy.mockRestore();
  });
});

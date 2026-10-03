import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import i18n from '@/i18n';
import { apiClient } from '@/lib/api';
import type { CircleDocument } from '@/api/documents';
import { DocumentPreviewModal } from '@/components/documents/DocumentPreviewModal';
import { OBJECT_URL_TTL_MS } from '@/components/documents/openInNewTab';

// @/lib/api is mocked globally in src/test/setup.ts (resolves the unwrapped
// `{ success, data }` envelope, like the real response interceptor).
const mockedGet = vi.mocked(apiClient.get);

// Toasts are the live region that announces download started / failed.
const showToast = vi.fn();
vi.mock('@/components/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/ui')>();
  return { ...actual, useToast: () => ({ showToast }) };
});

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

const heicDoc: CircleDocument = {
  ...baseDoc,
  id: 'doc-3',
  label: 'Pill bottle',
  file_path: 'circle-documents/circle-1/3.heic',
  file_type: 'image/heic',
};

describe('DocumentPreviewModal', () => {
  beforeEach(() => {
    mockedGet.mockReset();
    showToast.mockReset();
  });

  afterEach(async () => {
    if (i18n.language !== 'en') await act(() => i18n.changeLanguage('en'));
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

  it('renders PDFs in an iframe with fallbacks and NO sandbox attribute', async () => {
    mockSignedUrl(pdfDoc);
    render(<DocumentPreviewModal doc={pdfDoc} circleId={CIRCLE_ID} onClose={vi.fn()} />);

    const iframe = await screen.findByTitle('Power of Attorney');
    expect(iframe.tagName).toBe('IFRAME');
    // Verified in Chrome: a `sandbox` attribute of ANY value — including one
    // listing every allow-* token — makes Chrome refuse to run its built-in PDF
    // viewer and render "This page has been blocked by Chrome". Re-adding the
    // attribute here to "harden" the frame silently breaks every PDF preview.
    expect(iframe).not.toHaveAttribute('sandbox');
    // `navpanes=0` hides Chrome's thumbnail rail; the fragment is never sent to
    // the server so it cannot affect the signature.
    expect(iframe).toHaveAttribute('src', `${SIGNED_URL}#navpanes=0`);

    // "Open in new tab" is a BUTTON now — never a link carrying the signed URL.
    expect(screen.getByRole('button', { name: 'Open in new tab' })).toBeInTheDocument();
    expect(screen.queryAllByRole('link')).toHaveLength(0);
    expect(document.querySelector(`a[href*="storage.example.com"]`)).toBeNull();
    expect(screen.getByRole('button', { name: 'Download Power of Attorney' })).toBeInTheDocument();
  });

  it('shows the PDF fallback hint under the iframe', async () => {
    mockSignedUrl(pdfDoc);
    render(<DocumentPreviewModal doc={pdfDoc} circleId={CIRCLE_ID} onClose={vi.fn()} />);

    await screen.findByTitle('Power of Attorney');
    expect(
      screen.getByText('PDF not displaying? Open it in a new tab or download it.')
    ).toBeInTheDocument();
  });

  it('does not show the PDF fallback hint for image previews', async () => {
    mockSignedUrl(baseDoc);
    render(<DocumentPreviewModal doc={baseDoc} circleId={CIRCLE_ID} onClose={vi.fn()} />);

    await screen.findByRole('img', { name: 'Insurance Card' });
    expect(
      screen.queryByText('PDF not displaying? Open it in a new tab or download it.')
    ).not.toBeInTheDocument();
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
    // Header order: Download, then Close; the scrollable body region is last.
    const downloadButton = screen.getByRole('button', { name: 'Download Insurance Card' });
    const body = screen.getByRole('region', { name: 'Insurance Card' });

    // Tab from the last focusable wraps to the first
    body.focus();
    fireEvent.keyDown(dialog, { key: 'Tab' });
    expect(downloadButton).toHaveFocus();

    // Shift+Tab from the first focusable wraps to the last
    downloadButton.focus();
    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });
    expect(body).toHaveFocus();
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

    expect(await screen.findByText("Couldn't open this document")).toBeInTheDocument();
    expect(screen.getByText('Check your connection and try again.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('img', { name: 'Insurance Card' })).toBeInTheDocument();
    expect(mockedGet).toHaveBeenCalledTimes(2);
  });

  it('shows the error state when the document has no signed URL', async () => {
    mockSignedUrl(baseDoc, null);
    render(<DocumentPreviewModal doc={baseDoc} circleId={CIRCLE_ID} onClose={vi.fn()} />);

    expect(await screen.findByText("Couldn't open this document")).toBeInTheDocument();
  });

  it('Download re-signs at click time and downloads under the label filename', async () => {
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
    // One fetch on open, one FRESH one at click time.
    expect(mockedGet).toHaveBeenCalledTimes(2);
    expect(clickedHrefs[0]).toContain('token=fresh-token');
    expect(clickedHrefs[0]).toContain('download=Insurance+Card.jpg');
    // The anchor was transient — nothing in the DOM links to the storage URL.
    expect(document.querySelector('a[href*="storage.example.com"]')).toBeNull();
    expect(showToast).toHaveBeenCalledWith('Download started.', 'info');

    clickSpy.mockRestore();
  });

  it('announces a failed download', async () => {
    mockSignedUrl(baseDoc);
    render(<DocumentPreviewModal doc={baseDoc} circleId={CIRCLE_ID} onClose={vi.fn()} />);
    await screen.findByRole('img', { name: 'Insurance Card' });

    mockedGet.mockRejectedValueOnce(new Error('boom'));
    fireEvent.click(screen.getByRole('button', { name: 'Download Insurance Card' }));

    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith('Download failed. Please try again.', 'error')
    );
  });

  it('titles the dialog with the document label — never a URL or host', async () => {
    mockSignedUrl(pdfDoc);
    render(<DocumentPreviewModal doc={pdfDoc} circleId={CIRCLE_ID} onClose={vi.fn()} />);
    await screen.findByTitle('Power of Attorney');

    const dialog = screen.getByRole('dialog', { name: 'Power of Attorney' });
    expect(dialog).toBeInTheDocument();
    // Visible header text is the label; the only heading is the dialog's name.
    expect(screen.getAllByRole('heading')).toHaveLength(1);
    expect(dialog.textContent).not.toMatch(/storage\.example\.com|token|https?:/);
  });

  describe('a type the browser cannot render (HEIC)', () => {
    it("shows the can't-preview state with Download, and fetches nothing on open", async () => {
      render(<DocumentPreviewModal doc={heicDoc} circleId={CIRCLE_ID} onClose={vi.fn()} />);

      expect(screen.getByRole('dialog', { name: 'Pill bottle' })).toBeInTheDocument();
      expect(screen.getByText("This file can't be previewed here")).toBeInTheDocument();
      expect(screen.getByText('Use Download to save it to your device.')).toBeInTheDocument();
      expect(screen.queryByRole('img', { name: 'Pill bottle' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Open in new tab' })).not.toBeInTheDocument();
      expect(mockedGet).not.toHaveBeenCalled();
    });

    it("the can't-preview Download fetches a signed URL and downloads Pill bottle.heic", async () => {
      mockSignedUrl(heicDoc);
      const clickedHrefs: string[] = [];
      const clickSpy = vi
        .spyOn(HTMLAnchorElement.prototype, 'click')
        .mockImplementation(function (this: HTMLAnchorElement) {
          clickedHrefs.push(this.href);
        });

      render(<DocumentPreviewModal doc={heicDoc} circleId={CIRCLE_ID} onClose={vi.fn()} />);
      // Header Download + the state's own Download (mobile shows Share twice too).
      const buttons = screen.getAllByRole('button', { name: 'Download Pill bottle' });
      expect(buttons).toHaveLength(2);
      fireEvent.click(buttons[1]);

      await waitFor(() => expect(clickSpy).toHaveBeenCalledTimes(1));
      expect(clickedHrefs[0]).toContain('download=Pill+bottle.heic');
      clickSpy.mockRestore();
    });

    it('matches mobile copy in Spanish', async () => {
      await act(() => i18n.changeLanguage('es'));
      render(<DocumentPreviewModal doc={heicDoc} circleId={CIRCLE_ID} onClose={vi.fn()} />);
      expect(screen.getByText('Este archivo no se puede previsualizar aquí')).toBeInTheDocument();
      expect(screen.getByText('Usa Descargar para guardarlo en tu dispositivo.')).toBeInTheDocument();
      expect(screen.getAllByRole('button', { name: 'Descargar Pill bottle' })).toHaveLength(2);
    });
  });

  describe('Open in new tab', () => {
    const BLOB_URL = 'blob:http://localhost:3000/7f1c-uuid';
    let tab: { location: { replace: ReturnType<typeof vi.fn> }; close: ReturnType<typeof vi.fn> };
    let openSpy: ReturnType<typeof vi.spyOn>;
    let fetchMock: ReturnType<typeof vi.fn>;
    const createObjectURL = vi.fn((_obj: Blob | MediaSource) => BLOB_URL);
    const revokeObjectURL = vi.fn();
    const originalCreate = URL.createObjectURL;
    const originalRevoke = URL.revokeObjectURL;

    function okResponse(): Response {
      return { ok: true, blob: async () => new Blob(['%PDF-1.1'], { type: 'application/octet-stream' }) } as Response;
    }

    beforeEach(() => {
      tab = { location: { replace: vi.fn() }, close: vi.fn() };
      openSpy = vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window);
      fetchMock = vi.fn(async () => okResponse());
      vi.stubGlobal('fetch', fetchMock);
      createObjectURL.mockClear();
      revokeObjectURL.mockClear();
      URL.createObjectURL = createObjectURL;
      URL.revokeObjectURL = revokeObjectURL;
    });

    afterEach(() => {
      openSpy.mockRestore();
      vi.unstubAllGlobals();
      vi.useRealTimers();
      URL.createObjectURL = originalCreate;
      URL.revokeObjectURL = originalRevoke;
    });

    async function renderPdfAndClick(): Promise<void> {
      mockSignedUrl(pdfDoc);
      render(<DocumentPreviewModal doc={pdfDoc} circleId={CIRCLE_ID} onClose={vi.fn()} />);
      await screen.findByTitle('Power of Attorney');
      fireEvent.click(screen.getByRole('button', { name: 'Open in new tab' }));
    }

    it('opens a blank tab synchronously, then points it at a blob: URL — never the storage URL', async () => {
      await renderPdfAndClick();

      // Synchronous, inside the click — before any await.
      expect(openSpy).toHaveBeenCalledWith('about:blank', '_blank');
      await waitFor(() => expect(tab.location.replace).toHaveBeenCalledTimes(1));

      const target = tab.location.replace.mock.calls[0][0] as string;
      expect(target).toBe(BLOB_URL);
      expect(target.startsWith('blob:')).toBe(true);
      for (const call of [...openSpy.mock.calls, ...tab.location.replace.mock.calls]) {
        expect(String(call[0])).not.toMatch(/storage|token|supabase/);
      }
      // The bytes came from the signed URL, typed as a PDF so the viewer renders it.
      expect(fetchMock).toHaveBeenCalledWith(SIGNED_URL, expect.anything());
      const blob = createObjectURL.mock.calls[0][0] as unknown as Blob;
      expect(blob.type).toBe('application/pdf');
    });

    it('revokes the object URL after the TTL', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      await renderPdfAndClick();
      await waitFor(() => expect(tab.location.replace).toHaveBeenCalled());

      expect(revokeObjectURL).not.toHaveBeenCalled();
      act(() => {
        vi.advanceTimersByTime(OBJECT_URL_TTL_MS);
      });
      expect(revokeObjectURL).toHaveBeenCalledWith(BLOB_URL);
    });

    it('re-signs once when the URL in hand no longer works (expired)', async () => {
      fetchMock.mockResolvedValueOnce({ ok: false } as Response);
      await renderPdfAndClick();

      await waitFor(() => expect(tab.location.replace).toHaveBeenCalledWith(BLOB_URL));
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(mockedGet).toHaveBeenCalledTimes(2);
    });

    it('popup blocked: falls back to Download and says so', async () => {
      openSpy.mockReturnValue(null);
      const clickedHrefs: string[] = [];
      const clickSpy = vi
        .spyOn(HTMLAnchorElement.prototype, 'click')
        .mockImplementation(function (this: HTMLAnchorElement) {
          clickedHrefs.push(this.href);
        });

      await renderPdfAndClick();

      await waitFor(() => expect(clickSpy).toHaveBeenCalledTimes(1));
      expect(clickedHrefs[0]).toContain('download=Power+of+Attorney.pdf');
      expect(fetchMock).not.toHaveBeenCalled();
      expect(showToast).toHaveBeenCalledWith(
        'Your browser blocked the new tab, so the file is downloading instead.',
        'info'
      );
      clickSpy.mockRestore();
    });

    it('closes the pending tab and announces when the file cannot be fetched', async () => {
      fetchMock.mockResolvedValue({ ok: false } as Response);
      await renderPdfAndClick();

      await waitFor(() => expect(tab.close).toHaveBeenCalledTimes(1));
      expect(tab.location.replace).not.toHaveBeenCalled();
      expect(showToast).toHaveBeenCalledWith(
        "Couldn't open this document in a new tab. Please try again.",
        'error'
      );
    });
  });
});

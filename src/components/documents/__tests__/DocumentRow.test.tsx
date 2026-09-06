import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@/i18n';
import { apiClient } from '@/lib/api';
import type { CircleDocument } from '@/api/documents';
import { DocumentRow } from '../DocumentRow';

// @/lib/api is mocked globally in src/test/setup.ts.
const mockedGet = vi.mocked(apiClient.get);

const showToast = vi.fn();
vi.mock('@/components/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/ui')>();
  return { ...actual, useToast: () => ({ showToast }) };
});

const CIRCLE_ID = 'circle-1';

function makeDoc(overrides: Partial<CircleDocument> = {}): CircleDocument {
  return {
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
    uploaded_by_user: { id: 'user-1', first_name: 'Priya', last_name: 'Shah', email: 'p@example.com' },
    ...overrides,
  };
}

function renderRow(overrides: Partial<Parameters<typeof DocumentRow>[0]> = {}) {
  const props = {
    doc: makeDoc(),
    circleId: CIRCLE_ID,
    onPreview: vi.fn(),
    ...overrides,
  };
  return render(
    <ul>
      <DocumentRow {...props} />
    </ul>
  );
}

async function openMenu(name: string): Promise<void> {
  fireEvent.click(screen.getByRole('button', { name }));
}

beforeEach(() => {
  mockedGet.mockReset();
  showToast.mockReset();
});

describe('DocumentRow', () => {
  it('renders the label, size · date · uploader meta, and category badge', () => {
    renderRow();

    expect(screen.getByText('Insurance Card')).toBeInTheDocument();
    const meta = screen.getByText('512 KB').closest('p');
    expect(meta).toHaveTextContent('512 KB');
    expect(meta).toHaveTextContent('Priya');
    expect(screen.getByText('Insurance')).toBeInTheDocument();
  });

  it('derives the Badge variant from the category tone map', () => {
    const { rerender } = render(
      <ul>
        <DocumentRow doc={makeDoc({ category: 'legal' })} circleId={CIRCLE_ID} onPreview={vi.fn()} />
      </ul>
    );
    expect(screen.getByText('Legal')).toHaveClass('bg-clay-line');

    rerender(
      <ul>
        <DocumentRow
          doc={makeDoc({ category: 'prescriptions' })}
          circleId={CIRCLE_ID}
          onPreview={vi.fn()}
        />
      </ul>
    );
    expect(screen.getByText('Prescriptions')).toHaveClass('bg-terracotta-soft');
  });

  it('opens the preview modal for a previewable type via the actions menu', async () => {
    const onPreview = vi.fn();
    renderRow({ onPreview, doc: makeDoc() });

    await openMenu('Options for Insurance Card');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Preview' }));

    expect(onPreview).toHaveBeenCalledWith(expect.objectContaining({ id: 'doc-1' }));
  });

  it('offers no Preview action for a non-previewable type (HEIC)', async () => {
    renderRow({ doc: makeDoc({ file_type: 'image/heic' }) });

    await openMenu('Options for Insurance Card');
    expect(screen.queryByRole('menuitem', { name: 'Preview' })).not.toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Download' })).toBeInTheDocument();
  });

  it('downloads via a fresh signed URL fetched at click time', async () => {
    mockedGet.mockResolvedValue({
      success: true,
      data: {
        documents: [{ ...makeDoc(), file_url: 'https://storage.example.com/sign/1.jpg?token=fresh' }],
        storage: { used: 0, limit: 209715200 },
      },
    });
    const clickedHrefs: string[] = [];
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(function (this: HTMLAnchorElement) {
        clickedHrefs.push(this.href);
      });

    renderRow();
    await openMenu('Options for Insurance Card');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Download' }));

    await waitFor(() => expect(clickSpy).toHaveBeenCalledTimes(1));
    expect(clickedHrefs[0]).toContain('token=fresh');
    clickSpy.mockRestore();
  });

  it('shows an error toast when the signed URL fetch fails', async () => {
    mockedGet.mockRejectedValue(new Error('boom'));
    renderRow();

    await openMenu('Options for Insurance Card');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Download' }));

    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Download failed. Please try again.', 'error'));
  });

  it('omits Edit/Delete when canManage is false', async () => {
    renderRow({ canManage: false, onEdit: vi.fn(), onDelete: vi.fn() });

    await openMenu('Options for Insurance Card');
    expect(screen.queryByRole('menuitem', { name: 'Edit' })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Delete' })).not.toBeInTheDocument();
  });

  it('offers Edit/Delete when canManage is true and reports the doc', async () => {
    const onEdit = vi.fn();
    const onDelete = vi.fn();
    renderRow({ canManage: true, onEdit, onDelete });

    await openMenu('Options for Insurance Card');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Edit' }));
    expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ id: 'doc-1' }));

    await openMenu('Options for Insurance Card');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));
    expect(onDelete).toHaveBeenCalledWith(expect.objectContaining({ id: 'doc-1' }));
  });
});

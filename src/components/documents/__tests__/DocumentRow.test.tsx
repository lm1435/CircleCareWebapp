import { act, fireEvent, render, screen } from '@testing-library/react';
import i18n from '@/i18n';
import { apiClient } from '@/lib/api';
import type { CircleDocument } from '@/api/documents';
import { DocumentRow } from '../DocumentRow';

// @/lib/api is mocked globally in src/test/setup.ts.
const mockedGet = vi.mocked(apiClient.get);

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

function menuLabels(): string[] {
  return screen.getAllByRole('menuitem').map((item) => item.textContent?.trim() ?? '');
}

beforeEach(() => {
  mockedGet.mockReset();
});

afterEach(async () => {
  if (i18n.language !== 'en') await act(() => i18n.changeLanguage('en'));
});

describe('DocumentRow', () => {
  it('renders the label, size · date · uploader meta, and category badge', () => {
    renderRow();

    expect(screen.getByText('Insurance Card')).toBeInTheDocument();
    const meta = screen.getByText('512 KB').parentElement;
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

  // Parity with mobile's DocumentActionsModal: Open, Edit, Delete — same
  // order, same words (mobile documents.open / common.edit / documents.delete).
  it('menu is exactly Open, Edit, Delete (EN) for a manager', async () => {
    renderRow({ canManage: true, onEdit: vi.fn(), onDelete: vi.fn() });
    await openMenu('Options for Insurance Card');
    expect(menuLabels()).toEqual(['Open', 'Edit', 'Delete']);
  });

  it('menu is exactly Abrir, Editar, Eliminar (ES) for a manager', async () => {
    await act(() => i18n.changeLanguage('es'));
    renderRow({ canManage: true, onEdit: vi.fn(), onDelete: vi.fn() });
    await openMenu('Opciones para Insurance Card');
    expect(menuLabels()).toEqual(['Abrir', 'Editar', 'Eliminar']);
  });

  it('menu is only Open for a non-manager, and never offers Preview or Download', async () => {
    renderRow({ canManage: false });
    await openMenu('Options for Insurance Card');
    expect(menuLabels()).toEqual(['Open']);
    expect(screen.queryByRole('menuitem', { name: /Preview|Download/ })).not.toBeInTheDocument();
  });

  it('Open opens the viewer for the document, fetching nothing itself', async () => {
    const onPreview = vi.fn();
    renderRow({ onPreview });

    await openMenu('Options for Insurance Card');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Open' }));

    expect(onPreview).toHaveBeenCalledWith(expect.objectContaining({ id: 'doc-1' }));
    expect(mockedGet).not.toHaveBeenCalled();
  });

  it('offers Open for a type the browser cannot render (HEIC) — the viewer says so', async () => {
    const onPreview = vi.fn();
    renderRow({ onPreview, doc: makeDoc({ file_type: 'image/heic' }) });

    await openMenu('Options for Insurance Card');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Open' }));
    expect(onPreview).toHaveBeenCalledWith(expect.objectContaining({ file_type: 'image/heic' }));
  });

  it('clicking the row itself opens the viewer (as tapping it does on mobile)', () => {
    const onPreview = vi.fn();
    renderRow({ onPreview });

    const rowButton = screen.getByRole('button', { name: 'Insurance Card' });
    expect(rowButton).toHaveAccessibleDescription(/512 KB/);
    fireEvent.click(rowButton);
    expect(onPreview).toHaveBeenCalledWith(expect.objectContaining({ id: 'doc-1' }));
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

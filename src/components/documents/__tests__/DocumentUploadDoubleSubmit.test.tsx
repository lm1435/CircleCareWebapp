/**
 * DOCUMENT UPLOAD — DOUBLE SUBMIT MUST UPLOAD ONE FILE (web).
 *
 * Test-gap audit 2026-09-29 §2 Documents ⚠️ "Upload double submit → duplicate
 * file (no test on either platform)". Correction found while writing this:
 * mobile IS covered — `DocumentUploadDeleteGating.test.tsx` › "firing Upload
 * twice in a row, after picking a file, only uploads once" (DocumentUploadScreen
 * wraps the create in `useGuardedSubmit`). Web had nothing.
 *
 * An upload is a create: two POSTs = two stored copies of the same PHI file,
 * and two charges against the circle's storage cap.
 *
 * REAL: DocumentUploadModal, `useUploadDocument` (react-query mutation on a
 * real QueryClient), `api/documents.uploadDocument`, the real `lib/api` client.
 * FAKED: the network (an axios adapter that holds the upload in flight), the
 * toast sink. Same-tick double click via `src/test/doubleSubmit.ts` (see its
 * header for why two `userEvent.click`s cannot reproduce the production race).
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { InternalAxiosRequestConfig } from 'axios';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import '@/i18n';
import { clickTwice } from '@/test/doubleSubmit';

vi.unmock('@/lib/api');

const showToast = vi.fn();
vi.mock('@/components/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/ui')>();
  return { ...actual, useToast: () => ({ showToast }) };
});

import { apiClient } from '@/lib/api';
import { tokenAccessor } from '@/lib/tokenAccessor';
import { DocumentUploadModal } from '../DocumentUploadModal';

let uploads = 0;
let release: () => void = () => {};
const originalAdapter = apiClient.defaults.adapter;

beforeAll(() => {
  tokenAccessor.setToken('t', null);
  apiClient.defaults.adapter = async (config: InternalAxiosRequestConfig) => {
    if (config.method === 'post' && config.url === '/circles/circle-1/documents/upload') {
      uploads += 1;
      // Held in flight until the test releases it.
      await new Promise<void>((r) => {
        release = r;
      });
      return {
        data: { success: true, data: { document: { id: `doc-${uploads}` } } },
        status: 201,
        statusText: 'Created',
        headers: {},
        config,
      };
    }
    return { data: { success: true, data: {} }, status: 200, statusText: 'OK', headers: {}, config };
  };
});

afterAll(() => {
  apiClient.defaults.adapter = originalAdapter;
});

beforeEach(() => {
  uploads = 0;
  showToast.mockClear();
});

function makeFile(name: string, sizeBytes: number, type: string): File {
  const file = new File(['x'], name, { type });
  Object.defineProperty(file, 'size', { value: sizeBytes });
  return file;
}

async function renderWithFile() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const onClose = vi.fn();
  render(
    <MemoryRouter>
      <QueryClientProvider client={qc}>
        <DocumentUploadModal
          circleId="circle-1"
          storage={{ used: 0, limit: 209715200 }}
          canEdit
          onClose={onClose}
        />
      </QueryClientProvider>
    </MemoryRouter>
  );
  const user = userEvent.setup();
  await user.upload(screen.getByLabelText('File'), makeFile('Biopsy.pdf', 1024 * 1024, 'application/pdf'));
  return { user, onClose };
}

describe('DocumentUploadModal — double submit', () => {
  it('a click while the upload is already pending (after a render) sends nothing more', async () => {
    const { user, onClose } = await renderWithFile();
    await user.click(screen.getByRole('button', { name: 'Upload' }));
    await waitFor(() => expect(uploads).toBe(1));
    await user.click(screen.getByRole('button', { name: 'Upload' }));
    expect(uploads).toBe(1);
    release();
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(uploads).toBe(1);
  });

  // WAS A DEFECT (K10, fixed): two clicks in the same tick uploaded the file TWICE because
  // DocumentUploadModal guarded with render-committed `upload.isPending` only. It now
  // claims the synchronous `useSubmitGuard` ref, like every sibling write and mobile's
  // DocumentUploadScreen.
  it('two clicks in the same tick upload ONE file', async () => {
    await renderWithFile();
    await clickTwice(screen.getByRole('button', { name: 'Upload' }));
    await waitFor(() => expect(uploads).toBeGreaterThan(0));
    // Let any second request start.
    await new Promise((r) => setTimeout(r, 20));
    expect(uploads).toBe(1);
    release();
  });
});

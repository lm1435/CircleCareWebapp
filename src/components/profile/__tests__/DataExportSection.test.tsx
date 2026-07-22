// DataExportSection — GDPR "Download my data" card. `exportUserData` is mocked
// (the blob/error normalization it does is unit-tested in api/__tests__/
// users.test.ts); here we assert the DOWNLOAD flow: object-URL + anchor click
// with the fixed filename, the loading state (disabled + aria-busy + progress
// label), the friendly 429 rate-limit message, and success feedback. Toasts
// render through the REAL ToastProvider so the live-region roles are asserted.

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { MockInstance } from 'vitest';
import '@/i18n';
import { ToastProvider } from '@/components/ui';
import { DataExportSection } from '@/components/profile/DataExportSection';
import { exportUserData } from '@/api/users';

vi.mock('@/api/users', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/users')>();
  return { ...actual, exportUserData: vi.fn() };
});

const mockedExport = vi.mocked(exportUserData);

const createObjectURL = vi.fn(() => 'blob:mock-export');
const revokeObjectURL = vi.fn();

let clickSpy: MockInstance;
let clickedAnchor: HTMLAnchorElement | null = null;

function renderSection(): void {
  render(
    <ToastProvider>
      <DataExportSection />
    </ToastProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  clickedAnchor = null;
  // jsdom has no object-URL implementation — stub the pair the download uses.
  Object.defineProperty(URL, 'createObjectURL', {
    value: createObjectURL,
    writable: true,
    configurable: true,
  });
  Object.defineProperty(URL, 'revokeObjectURL', {
    value: revokeObjectURL,
    writable: true,
    configurable: true,
  });
  // Capture the anchor the component clicks (jsdom would otherwise navigate).
  clickSpy = vi
    .spyOn(HTMLAnchorElement.prototype, 'click')
    .mockImplementation(function (this: HTMLAnchorElement) {
      clickedAnchor = this;
    });
});

afterEach(() => {
  clickSpy.mockRestore();
});

describe('DataExportSection', () => {
  it('downloads the export as circlecare-export.json and shows success feedback', async () => {
    const user = userEvent.setup();
    const blob = new Blob(['{"user":{}}'], { type: 'application/json' });
    mockedExport.mockResolvedValue(blob);
    renderSection();

    await user.click(screen.getByRole('button', { name: 'Download my data' }));

    expect(mockedExport).toHaveBeenCalledTimes(1);

    // Blob → object URL → anchor click with the fixed filename → URL revoked.
    await waitFor(() => expect(clickSpy).toHaveBeenCalledTimes(1));
    expect(createObjectURL).toHaveBeenCalledWith(blob);
    expect(clickedAnchor?.getAttribute('download')).toBe('circlecare-export.json');
    expect(clickedAnchor?.getAttribute('href')).toBe('blob:mock-export');
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-export');

    // Success toast in the polite live region.
    const toast = await screen.findByRole('status');
    expect(toast).toHaveTextContent('Your data export has been downloaded.');
  });

  it('disables the button with aria-busy and a progress label while exporting', async () => {
    const user = userEvent.setup();
    let resolveExport!: (blob: Blob) => void;
    mockedExport.mockImplementation(
      () =>
        new Promise<Blob>((resolve) => {
          resolveExport = resolve;
        })
    );
    renderSection();

    await user.click(screen.getByRole('button', { name: 'Download my data' }));

    // Pending: disabled + aria-busy + label swapped to the progress message.
    const busyButton = screen.getByRole('button', { name: 'Preparing your export…' });
    expect(busyButton).toBeDisabled();
    expect(busyButton).toHaveAttribute('aria-busy', 'true');

    resolveExport(new Blob(['{}'], { type: 'application/json' }));

    // Settled: re-enabled with the original label.
    const idleButton = await screen.findByRole('button', { name: 'Download my data' });
    expect(idleButton).toBeEnabled();
    expect(idleButton).toHaveAttribute('aria-busy', 'false');
  });

  it('shows the friendly rate-limit message on a 429 RATE_LIMIT rejection', async () => {
    const user = userEvent.setup();
    mockedExport.mockRejectedValue({
      success: false,
      error: { code: 'RATE_LIMIT', message: 'Too many requests, please try again later' },
    });
    renderSection();

    await user.click(screen.getByRole('button', { name: 'Download my data' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(
      "You have reached today's export limit. Please try again tomorrow."
    );
    // No download was triggered, and the user can retry tomorrow.
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(clickSpy).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Download my data' })).toBeEnabled();
  });

  it('shows the generic failure message on any other rejection', async () => {
    const user = userEvent.setup();
    mockedExport.mockRejectedValue({ success: false, error: { code: 'SERVER_ERROR' } });
    renderSection();

    await user.click(screen.getByRole('button', { name: 'Download my data' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent("We couldn't prepare your export. Please try again.");
    expect(createObjectURL).not.toHaveBeenCalled();
  });
});

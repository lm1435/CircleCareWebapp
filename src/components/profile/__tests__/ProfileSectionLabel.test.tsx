import { render, screen } from '@testing-library/react';
import '@/i18n';
import { ToastProvider } from '@/components/ui';
import { DataExportSection } from '@/components/profile/DataExportSection';

// Design 2026-11-07 (owner pick "A"): Profile section headings are the small uppercase label mobile uses:
// 12px, 0.15em tracking, weight 600, uppercase, muted ink (>= 4.5:1 on paper in light and dark).
describe('Profile section heading style', () => {
  it('DataExportSection heading is the uppercase section label, still an h2', () => {
    render(
      <ToastProvider>
        <DataExportSection />
      </ToastProvider>
    );
    const heading = screen.getByRole('heading', { level: 2 });
    expect(heading).toHaveClass('text-xs', 'font-semibold', 'uppercase', 'tracking-[0.15em]', 'text-ink-3');
    expect(heading).not.toHaveClass('text-base');
  });
});

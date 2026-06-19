import { formatFileSize } from '@/components/documents/formatFileSize';

// Mirrors mobile's formatBytes — outputs must stay identical across clients.
describe('formatFileSize', () => {
  it('formats bytes', () => {
    expect(formatFileSize(0)).toBe('0 B');
    expect(formatFileSize(512)).toBe('512 B');
    expect(formatFileSize(1023)).toBe('1023 B');
  });

  it('formats kilobytes with no decimals', () => {
    expect(formatFileSize(1024)).toBe('1 KB');
    expect(formatFileSize(524288)).toBe('512 KB');
    expect(formatFileSize(1048575)).toBe('1024 KB');
  });

  it('formats megabytes with one decimal', () => {
    expect(formatFileSize(1048576)).toBe('1.0 MB');
    expect(formatFileSize(2621440)).toBe('2.5 MB');
    expect(formatFileSize(209715200)).toBe('200.0 MB');
  });

  it('formats gigabytes with two decimals', () => {
    expect(formatFileSize(1073741824)).toBe('1.00 GB');
    expect(formatFileSize(1610612736)).toBe('1.50 GB');
  });
});

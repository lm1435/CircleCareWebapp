import { buildDownloadFileName, triggerSignedUrlDownload } from '@/components/documents/downloadFile';

describe('buildDownloadFileName', () => {
  it('uses the label plus an extension derived from the MIME type', () => {
    expect(
      buildDownloadFileName({
        label: 'Insurance Card',
        file_type: 'image/jpeg',
        file_path: 'circle-documents/c1/1.jpg',
      })
    ).toBe('Insurance Card.jpg');

    expect(
      buildDownloadFileName({
        label: 'Power of Attorney',
        file_type: 'application/pdf',
        file_path: 'circle-documents/c1/2.pdf',
      })
    ).toBe('Power of Attorney.pdf');
  });

  it('strips path separators and reserved characters from the label', () => {
    expect(
      buildDownloadFileName({
        label: 'a/b\\c:d*e?f"g<h>i|j',
        file_type: 'image/png',
        file_path: 'circle-documents/c1/3.png',
      })
    ).toBe('a-b-c-d-e-f-g-h-i-j.png');
  });

  it('falls back to the file_path extension for unknown MIME types', () => {
    expect(
      buildDownloadFileName({
        label: 'Mystery',
        file_type: 'application/x-unknown',
        file_path: 'circle-documents/c1/4.docx',
      })
    ).toBe('Mystery.docx');
  });

  it('falls back to "document" and "bin" when label and extension are unusable', () => {
    expect(
      buildDownloadFileName({
        label: '   ',
        file_type: 'application/x-unknown',
        file_path: 'no-extension',
      })
    ).toBe('document.bin');
  });
});

describe('triggerSignedUrlDownload', () => {
  it('clicks a temporary anchor with the download param appended to the signed URL', () => {
    const clicked: Array<{ href: string; download: string; rel: string }> = [];
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(function (this: HTMLAnchorElement) {
        clicked.push({ href: this.href, download: this.download, rel: this.rel });
      });

    triggerSignedUrlDownload(
      'https://storage.example.com/sign/1.jpg?token=abc',
      'Insurance Card.jpg'
    );

    expect(clicked).toHaveLength(1);
    expect(clicked[0].href).toBe(
      'https://storage.example.com/sign/1.jpg?token=abc&download=Insurance+Card.jpg'
    );
    expect(clicked[0].download).toBe('Insurance Card.jpg');
    expect(clicked[0].rel).toBe('noopener');

    // The temporary anchor is removed from the DOM afterwards
    expect(document.querySelector('a[download]')).toBeNull();

    clickSpy.mockRestore();
  });
});

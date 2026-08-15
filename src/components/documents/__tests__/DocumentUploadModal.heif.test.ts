import { deriveFileExtension } from '@/components/documents/DocumentUploadModal';

/**
 * HEIC and HEIF are the same container (ISO/IEC 23008-12) — a photo copied off
 * an Android phone commonly arrives as .heif / image/heif, and the picker on
 * that platform reports image/heif for files iOS reports as image/heic.
 *
 * The backend's allowed extensions (and the storage bucket's allowed MIME
 * types) only know 'heic', so the web client must fold heif onto it rather than
 * return null and tell the user their file type is unsupported.
 */
function file(name: string, type: string): File {
  return new File([new Uint8Array([0, 1, 2])], name, { type });
}

describe('deriveFileExtension — HEIF handling', () => {
  it('folds a .heif file name onto heic', () => {
    expect(deriveFileExtension(file('IMG_0001.heif', ''))).toBe('heic');
    expect(deriveFileExtension(file('IMG_0001.HEIF', ''))).toBe('heic');
  });

  it('folds every HEIF-family MIME onto heic when the name has no extension', () => {
    for (const mime of ['image/heic', 'image/heif', 'image/heic-sequence', 'image/heif-sequence']) {
      expect(deriveFileExtension(file('scan', mime))).toBe('heic');
    }
  });

  it('keeps .heic working', () => {
    expect(deriveFileExtension(file('IMG_0001.heic', 'image/heic'))).toBe('heic');
  });

  it('still classifies the ordinary types', () => {
    expect(deriveFileExtension(file('a.jpg', 'image/jpeg'))).toBe('jpg');
    expect(deriveFileExtension(file('a.jpeg', 'image/jpeg'))).toBe('jpeg');
    expect(deriveFileExtension(file('a.png', 'image/png'))).toBe('png');
    expect(deriveFileExtension(file('a.pdf', 'application/pdf'))).toBe('pdf');
    expect(deriveFileExtension(file('scan', 'image/jpeg'))).toBe('jpeg');
  });

  it('still rejects a genuinely unsupported file', () => {
    expect(deriveFileExtension(file('movie.mp4', 'video/mp4'))).toBeNull();
  });
});

import type { ReactElement } from 'react';
import type { DocumentCategory } from '@/api/documents';

interface IconProps {
  size?: number;
}

function Svg({
  size = 22,
  children,
}: {
  size?: number;
  children: ReactElement | ReactElement[];
}): ReactElement {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

function ImageIcon({ size }: IconProps): ReactElement {
  return (
    <Svg size={size}>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="9" cy="9" r="2" />
      <path d="m21 15-4.5-4.5L5 21" />
    </Svg>
  );
}

function PdfIcon({ size }: IconProps): ReactElement {
  return (
    <Svg size={size}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
      <path d="M14 2v6h6" />
      <path d="M9 13h6M9 17h4" />
    </Svg>
  );
}

function MedicalIcon({ size }: IconProps): ReactElement {
  return (
    <Svg size={size}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
      <path d="M14 2v6h6" />
      <path d="M12 11v6M9 14h6" />
    </Svg>
  );
}

function ShieldIcon({ size }: IconProps): ReactElement {
  return (
    <Svg size={size}>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />
    </Svg>
  );
}

function LegalIcon({ size }: IconProps): ReactElement {
  return (
    <Svg size={size}>
      <path d="M12 3v18" />
      <path d="M5 7h14" />
      <path d="m5 7-2 5a3 3 0 0 0 6 0Z" />
      <path d="m19 7-2 5a3 3 0 0 0 6 0Z" />
      <path d="M8 21h8" />
    </Svg>
  );
}

function PrescriptionIcon({ size }: IconProps): ReactElement {
  return (
    <Svg size={size}>
      <path d="M5 4h6a3 3 0 0 1 0 6H5Z" />
      <path d="M5 10v10" />
      <path d="m12 13 7 7M19 13l-7 7" />
    </Svg>
  );
}

function FileIcon({ size }: IconProps): ReactElement {
  return (
    <Svg size={size}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
      <path d="M14 2v6h6" />
    </Svg>
  );
}

/** Section-token tile tint per document category. */
export const categoryTileClass: Record<DocumentCategory, string> = {
  medical_records: 'bg-terracotta-soft text-terracotta-deep',
  insurance: 'bg-dusk-soft text-dusk-deep',
  legal: 'bg-clay-soft text-clay-deep',
  prescriptions: 'bg-moss-soft text-moss-deep',
  other: 'bg-bg-2 text-ink-2',
};

/**
 * Pick a glyph for a document. Image/PDF MIME types win (they describe the file
 * better); otherwise fall back to a category-specific icon.
 */
export function DocumentIcon({
  category,
  fileType,
  size,
}: {
  category: DocumentCategory;
  fileType: string;
  size?: number;
}): ReactElement {
  if (fileType.startsWith('image/')) return <ImageIcon size={size} />;
  if (fileType === 'application/pdf') return <PdfIcon size={size} />;

  switch (category) {
    case 'medical_records':
      return <MedicalIcon size={size} />;
    case 'insurance':
      return <ShieldIcon size={size} />;
    case 'legal':
      return <LegalIcon size={size} />;
    case 'prescriptions':
      return <PrescriptionIcon size={size} />;
    default:
      return <FileIcon size={size} />;
  }
}

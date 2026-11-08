import { apiClient } from '@/lib/api';
import type { MedicationDetailsSource } from '@/utils/medicationDetailsForm';

// PORT of mobile/src/api/upload.ts (medication photo half). Endpoint truth (backend/src/routes/upload.ts):
//   POST   /api/circles/:circleId/medications/:eventId/photo/upload-url  { fileExtension: jpg|jpeg|png|webp }
//          → { success, data: { uploadUrl, token, path } }  (uploadUrl null in local dev: nothing to PUT)
//   PUT    <uploadUrl>  raw image bytes, Content-Type = the image type
//   PATCH  /api/circles/:circleId/events/:eventId  { medication_photo_url: path }   (the caller)
//   DELETE /api/circles/:circleId/medications/:eventId/photo  (removes the object AND clears the column)
// Bucket `medication-photos`: private, 2 MB, image/jpeg | image/png | image/webp only.
//
// SECURITY: the signed READ url (from the single-event GET) never enters the React Query cache — callers
// hold it in component state, like `getMedicationPhotoUrl`. Never log urls, paths or file names.

/** The bucket's `file_size_limit` (20260205200000_medication_photos_bucket.sql). */
export const MEDICATION_PHOTO_MAX_BYTES = 2 * 1024 * 1024;

const TYPE_EXTENSION = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
} as const;
type PhotoMime = keyof typeof TYPE_EXTENSION;

/** What the file input offers (the bucket's allowlist). */
export const MEDICATION_PHOTO_ACCEPT = 'image/jpeg,image/png,image/webp';

/** Mobile's picker output: at most 800 x 800, JPEG quality 0.8. */
const MAX_EDGE = 800;
const JPEG_QUALITY = 0.8;

function photoMime(file: File): PhotoMime | null {
  const mime = file.type?.toLowerCase().split(';')[0].trim();
  if (mime && mime in TYPE_EXTENSION) return mime as PhotoMime;
  if (mime === 'image/jpg') return 'image/jpeg';
  const ext = file.name.split('.').pop()?.toLowerCase();
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'png') return 'image/png';
  if (ext === 'webp') return 'image/webp';
  return null;
}

export type MedicationPhotoProblem = 'type' | 'size';

/** Why the bucket would refuse this file, or null when it would take it. */
export function medicationPhotoProblem(file: File): MedicationPhotoProblem | null {
  if (!photoMime(file)) return 'type';
  if (file.size > MEDICATION_PHOTO_MAX_BYTES) return 'size';
  return null;
}

/**
 * Shrink the picked image the way mobile's picker does (fit in 800 x 800, JPEG 0.8) so a 5 MB camera photo
 * fits the 2 MB bucket. Best effort: where the browser cannot decode the file (or has no canvas), the
 * ORIGINAL comes back and `medicationPhotoProblem` decides.
 */
export async function prepareMedicationPhoto(file: File): Promise<File> {
  if (!file.type.startsWith('image/')) return file;
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && !medicationPhotoProblem(file)) {
      bitmap.close?.();
      return file;
    }
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d');
    if (!context) return file;
    // JPEG has no alpha: a transparent PNG would turn black without a background.
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY)
    );
    if (!blob) return file;
    return new File([blob], 'medication.jpg', { type: 'image/jpeg' });
  } catch {
    return file;
  }
}

interface SignedUploadEnvelope {
  success: boolean;
  data: { uploadUrl: string | null; token: string | null; path: string };
}

/**
 * Upload a medication photo; returns the storage path the caller PATCHes onto the medication.
 *
 * The PUT body is the file's BYTES (a Uint8Array), never the Blob, with Content-Type set explicitly: a
 * Blob body lets the runtime substitute its own `blob.type` (an untyped Blob goes out as
 * application/octet-stream, which the bucket refuses with 400 InvalidMimeType — the mobile 1.1.11-1.2.2
 * outage). Bytes carry no type of their own, so the header is the one the bucket sees.
 */
export async function uploadMedicationPhoto(
  circleId: string,
  eventId: string,
  file: File
): Promise<{ storagePath: string }> {
  const mime = photoMime(file);
  if (!mime) throw new Error('Unsupported image type');
  const fileExtension = TYPE_EXTENSION[mime];
  const envelope = (await apiClient.post(
    `/circles/${circleId}/medications/${encodeURIComponent(eventId)}/photo/upload-url`,
    { fileExtension }
  )) as unknown as SignedUploadEnvelope;
  if (!envelope?.success || !envelope.data?.path) throw new Error('Invalid upload URL response');

  if (envelope.data.uploadUrl) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const response = await fetch(envelope.data.uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': mime },
      body: bytes,
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) throw new Error('Failed to upload medication image');
  }
  return { storagePath: envelope.data.path };
}

/** Remove the photo: the backend deletes the object and clears `medication_photo_url`. */
export async function deleteMedicationPhoto(circleId: string, eventId: string): Promise<void> {
  await apiClient.delete(`/circles/${circleId}/medications/${encodeURIComponent(eventId)}/photo`);
}

/** The columns the edit form hydrates More details from (narrowed: never the whole row). */
const DETAIL_KEYS = [
  'track_refills',
  'quantity_in_bottle',
  'pills_per_day',
  'pills_per_dose',
  'alert_days_before',
  'prescriber_name',
  'pharmacy_name',
  'pharmacy_phone',
  'rx_number',
  'refill_group_id',
] as const;

interface DetailEnvelope {
  data: { event: MedicationDetailsSource & Record<string, unknown> };
}

/**
 * GET /circles/:circleId/events/:eventId for the medication form's More details: the refill and
 * prescription columns (the events LIST omits them) plus the photo's SIGNED url. One request; the result
 * is held in component state only (never the query cache — the url is signed). Throws on failure: the
 * caller then leaves every one of these keys out of the save.
 */
export async function getMedicationFormDetails(
  circleId: string,
  eventId: string
): Promise<{ details: MedicationDetailsSource; photoUrl: string | null }> {
  const response = (await apiClient.get(
    `/circles/${circleId}/events/${encodeURIComponent(eventId)}`
  )) as unknown as DetailEnvelope;
  const event = response.data.event;
  const details: MedicationDetailsSource = {};
  for (const key of DETAIL_KEYS) {
    (details as Record<string, unknown>)[key] = event[key] ?? null;
  }
  const photoUrl = typeof event.medication_photo_url === 'string' ? event.medication_photo_url : null;
  details.medication_photo_url = photoUrl ? 'stored' : null;
  return { details, photoUrl };
}

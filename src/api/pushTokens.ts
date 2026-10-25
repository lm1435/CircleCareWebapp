import { apiClient } from '@/lib/api';

// Verified against backend/src/routes/pushTokens.ts:
//   GET /api/push-tokens/platforms → { success, data: { platforms: ('ios'|'android')[] } }
//
// Which mobile platforms this user has the app registered on (distinct, sorted,
// active push tokens only). Powers the store-review banner: a web-only user
// (no registered device) gets `[]` and must never be asked for a store rating.
//
// NOTE: the web apiClient's response interceptor unwraps axios' response.data,
// so the resolved value IS the `{ success, data }` envelope.

export type DevicePlatform = 'ios' | 'android';

interface PlatformsEnvelope {
  success: boolean;
  data: { platforms: DevicePlatform[] };
}

export async function getDevicePlatforms(): Promise<DevicePlatform[]> {
  const response = (await apiClient.get('/push-tokens/platforms')) as unknown as PlatformsEnvelope;
  return response.data.platforms;
}

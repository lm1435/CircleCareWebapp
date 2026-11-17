import { apiClient } from '@/lib/api';

/**
 * GET /api/app-config — public, client-safe settings (backend routes/appConfig.ts).
 * 1.4.3: `preview_video_url_<lang>` per app language (each present only when the
 * owner set it) plus the legacy `preview_video_url`. Mirrors mobile api/appConfig.ts.
 */
export interface AppConfig {
  preview_video_url?: string;
  [perLanguageKey: `preview_video_url_${string}`]: string | undefined;
}

interface AppConfigEnvelope {
  success: boolean;
  data?: AppConfig;
}

export async function getAppConfig(): Promise<AppConfig> {
  const response = (await apiClient.get('/app-config', { timeout: 5000 })) as unknown as
    | AppConfigEnvelope
    | undefined;
  return response?.data ?? {};
}

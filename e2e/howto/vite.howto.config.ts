// Vite config for the web how-to recordings ONLY (help-videos RECIPE.md "Web video"). It wraps the real
// vite.config.ts unchanged and adds one thing: the dev proxy sends `Origin: http://localhost:5173` to the backend.
// The :4298 recording backend has no WEB_ORIGIN, so its cookie-login CSRF allowlist is just http://localhost:5173 in
// development; this server runs on its own port (5298) so it never takes :5173 from other sessions' e2e runs.
//   VITE_API_URL=http://localhost:4298 VITE_POSTHOG_KEY= npx vite --config e2e/howto/vite.howto.config.ts --port 5298 --strictPort
import type { ConfigEnv, UserConfig } from 'vite';
import base from '../../vite.config';

export default (env: ConfigEnv): UserConfig => {
  const cfg = (typeof base === 'function' ? base(env) : base) as UserConfig;
  const proxy = cfg.server?.proxy as Record<string, Record<string, unknown>> | undefined;
  if (proxy?.['/api']) proxy['/api'].headers = { origin: 'http://localhost:5173' };
  return cfg;
};

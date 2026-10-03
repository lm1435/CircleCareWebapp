import { createHash, randomBytes } from 'node:crypto';
import type { Page } from '@playwright/test';

// ===========================================================================
// PKCE OAuth provider simulation (web OAuth switched from the implicit flow to
// PKCE on 2026-10-01 — src/lib/supabase.ts, src/pages/AuthCallbackPage.tsx).
//
// Local Supabase has no Google/Apple configured, so the provider leg cannot
// run for real. What these helpers keep REAL: the app's own auth-js client
// generates the verifier + S256 challenge (when the flow starts from a real
// button), stores the verifier in sessionStorage, and POSTs
// `/auth/v1/token?grant_type=pkce`. What is simulated: GoTrue's side of that
// POST. The stub behaves like GoTrue — it redeems a code ONCE, only for the
// verifier whose S256 hash matches the challenge sent to /authorize (or the
// verifier parked by `parkPkceReturn`), and answers with a REAL password-grant
// session for the test account so the backend handoff is genuine.
// ===========================================================================

/** src/lib/pkceVerifierStorage.ts `PKCE_VERIFIER_KEY`. */
export const PKCE_VERIFIER_KEY = 'cc-oauth-pkce-code-verifier';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const s256 = (verifier: string): string => createHash('sha256').update(verifier).digest('base64url');

export interface ProviderSession {
  access_token: string;
  refresh_token: string;
  expires_in?: number;
}

export interface PkceProvider {
  /** Every token-endpoint POST the app made: the code and verifier it sent, and our answer. */
  exchanges: Array<{ auth_code: string; code_verifier: string; status: number }>;
  /** The challenge the app sent to /authorize (set by `routeAuthorizeToCallback`). */
  challenge: string | null;
  /** The code the "provider" will return to /auth/callback. */
  code: string;
}

function subOf(accessToken: string): string {
  try {
    const payload = JSON.parse(Buffer.from(accessToken.split('.')[1], 'base64url').toString()) as { sub?: string };
    return payload.sub ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * Stub GoTrue's PKCE token endpoint for `session`. Single-use code, S256
 * verifier check; a mismatch answers 400 like GoTrue (`flow_state_not_found`).
 */
export async function stubPkceTokenEndpoint(page: Page, session: ProviderSession): Promise<PkceProvider> {
  const provider: PkceProvider = { exchanges: [], challenge: null, code: `e2e-code-${randomBytes(8).toString('hex')}` };
  let spent = false;
  await page.route(/\/auth\/v1\/token\?grant_type=pkce/, async (route) => {
    // Cross-origin (app → Supabase): answer the CORS preflight like GoTrue.
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: CORS });
      return;
    }
    const body = route.request().postDataJSON() as { auth_code: string; code_verifier: string };
    const ok =
      !spent &&
      body.auth_code === provider.code &&
      typeof body.code_verifier === 'string' &&
      provider.challenge !== null &&
      s256(body.code_verifier) === provider.challenge;
    provider.exchanges.push({ ...body, status: ok ? 200 : 400 });
    if (!ok) {
      await route.fulfill({
        status: 400,
        headers: CORS,
        json: { code: 400, error_code: 'flow_state_not_found', msg: 'invalid flow state, no valid flow state found' },
      });
      return;
    }
    spent = true;
    await route.fulfill({
      status: 200,
      headers: CORS,
      json: {
        access_token: session.access_token,
        refresh_token: session.refresh_token,
        token_type: 'bearer',
        expires_in: session.expires_in ?? 3600,
        user: { id: subOf(session.access_token), aud: 'authenticated' },
      },
    });
  });
  return provider;
}

/**
 * Answer the app's real `signInWithOAuth` navigation to Supabase /authorize
 * the way a completed provider handshake does: 302 back to
 * `/auth/callback?code=…`. Records the S256 challenge the app generated.
 */
export async function routeAuthorizeToCallback(page: Page, provider: PkceProvider, baseURL: string): Promise<void> {
  await page.route(/\/auth\/v1\/authorize/, async (route) => {
    const url = new URL(route.request().url());
    provider.challenge = url.searchParams.get('code_challenge');
    if (url.searchParams.get('code_challenge_method') !== 's256') provider.challenge = null;
    await route.fulfill({
      status: 302,
      headers: { location: `${new URL(baseURL).origin}/auth/callback?code=${provider.code}` },
    });
  });
}

/**
 * For specs that land on /auth/callback directly (no button): park a verifier
 * in THIS tab's sessionStorage exactly as auth-js does (JSON-encoded) and
 * return the callback path. The page must already be on the app origin.
 */
export async function parkPkceReturn(page: Page, provider: PkceProvider): Promise<string> {
  const verifier = randomBytes(56).toString('hex');
  provider.challenge = s256(verifier);
  await page.evaluate(([k, v]) => sessionStorage.setItem(k, JSON.stringify(v)), [PKCE_VERIFIER_KEY, verifier]);
  return `/auth/callback?code=${provider.code}`;
}

/**
 * Every URL in this tab's session history (Chromium CDP), plus the live URL.
 * Used to assert no credential — token OR authorization code — survives the
 * callback in navigable history.
 */
export async function sessionHistoryUrls(page: Page): Promise<string[]> {
  const cdp = await page.context().newCDPSession(page);
  try {
    const { entries } = (await cdp.send('Page.getNavigationHistory')) as { entries: Array<{ url: string }> };
    return [...entries.map((e) => e.url), page.url()];
  } finally {
    await cdp.detach();
  }
}

/** URLs from `sessionHistoryUrls` that carry an OAuth credential. */
export function credentialUrls(urls: string[], extra: string[] = []): string[] {
  return urls.filter(
    (u) =>
      /[?#&](code|access_token|refresh_token)=/.test(u) ||
      extra.some((secret) => secret.length > 0 && u.includes(secret))
  );
}

// In-memory access token holder. Mirrors mobile/src/store/tokenAccessor.ts's
// role: breaks the circular dependency between the auth store and the API client.
//
// SECURITY (binding, from web-companion plan):
// - The access token lives in module memory ONLY.
// - NEVER persist it to localStorage/sessionStorage/IndexedDB/cookies readable by JS.
// - The refresh token is an httpOnly cookie managed entirely by the backend —
//   this module never sees it.

let accessToken: string | null = null;
let expiresAt: number | null = null; // unix seconds, from the auth session

export const tokenAccessor = {
  getAuthToken: (): string | null => accessToken,

  getExpiresAt: (): number | null => expiresAt,

  setToken: (token: string, tokenExpiresAt: number | null = null): void => {
    accessToken = token;
    expiresAt = tokenExpiresAt;
  },

  clear: (): void => {
    accessToken = null;
    expiresAt = null;
  },
};

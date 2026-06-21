import { apiClient } from '@/lib/api';

// PORT of mobile/src/api/auth.ts adapted for the web cookie-mode contract
// (backend/src/routes/auth.ts):
// - The apiClient request interceptor adds `X-Session-Mode: cookie` +
//   `withCredentials` to every /auth/* call, so the backend sets/rotates the
//   refresh token as an httpOnly cookie and OMITS it from response bodies for
//   login / refresh / oauth-session.
// - verify-otp is the one endpoint that still returns a refresh_token in the
//   body (no cookie mode on that route). Web immediately exchanges that
//   session via oauthSession() and discards the refresh token — it must NEVER
//   be persisted anywhere JS-readable.

export interface AuthSession {
  access_token: string;
  /** Unix seconds. May be absent on oauth-session when the JWT exp can't be decoded. */
  expires_at?: number;
}

export interface AuthUser {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
}

export interface SessionEnvelope {
  success: boolean;
  data: {
    session: AuthSession;
    user: AuthUser;
  };
}

/** verify-otp responds in body mode — session includes a refresh_token (see header note). */
export interface VerifyOtpEnvelope {
  success: boolean;
  data: {
    session: AuthSession & { refresh_token: string };
    user: AuthUser;
  };
}

export interface MessageEnvelope {
  success: boolean;
  data: { message: string };
}

/** Error envelope shape rejected by the apiClient response interceptor. */
export interface ApiErrorEnvelope {
  success: false;
  error: {
    code?: string;
    message?: string;
    /** EMAIL_NOT_VERIFIED (403) extras */
    requiresVerification?: boolean;
    email?: string;
  };
}

/** Safely extract the `{ code, email, ... }` error payload from a rejected API call. */
export function getApiError(err: unknown): ApiErrorEnvelope['error'] | undefined {
  if (typeof err === 'object' && err !== null && 'error' in err) {
    const candidate = (err as { error?: unknown }).error;
    if (typeof candidate === 'object' && candidate !== null) {
      return candidate as ApiErrorEnvelope['error'];
    }
  }
  return undefined;
}

export interface LoginData {
  email: string;
  password: string;
}

export interface SignUpData {
  email: string;
  password: string;
  first_name: string;
  last_name: string;
  /** IANA timezone (e.g. America/New_York). Defaults backend-side when omitted. */
  timezone?: string;
  /** UI language for the verification email — 'en' | 'es'. */
  language?: string;
}

/** /auth/signup creates the user + sends an OTP email — returns NO session. */
export interface SignUpEnvelope {
  success: boolean;
  data: {
    user: AuthUser;
    message: string;
  };
}

export interface OAuthSessionData {
  access_token: string;
  refresh_token: string;
}

export interface VerifyOtpData {
  email: string;
  otp: string;
}

export interface ResendOtpData {
  email: string;
}

export interface ForgotPasswordData {
  email: string;
}

export interface ResetPasswordData {
  email: string;
  otp: string;
  new_password: string;
}

export const authApi = {
  /**
   * Create an email/password account. Sends a 6-digit OTP to the email and
   * returns NO session — the caller routes to /verify-email to finish sign-up.
   */
  signup: async (data: SignUpData): Promise<SignUpEnvelope> => {
    return (await apiClient.post('/auth/signup', data)) as unknown as SignUpEnvelope;
  },

  /** Cookie mode: Set-Cookie cc_refresh (httpOnly); body has NO refresh_token. */
  login: async (data: LoginData): Promise<SessionEnvelope> => {
    return (await apiClient.post('/auth/login', data)) as unknown as SessionEnvelope;
  },

  /**
   * Exchange OAuth-broker (or verify-otp) tokens for a cookie session.
   * The refresh token passed here is discarded client-side afterwards.
   */
  oauthSession: async (data: OAuthSessionData): Promise<SessionEnvelope> => {
    return (await apiClient.post('/auth/oauth-session', data)) as unknown as SessionEnvelope;
  },

  /** Clears the httpOnly cookie. Idempotent — always 200, safe unauthenticated. */
  logout: async (): Promise<{ success: boolean }> => {
    return (await apiClient.post('/auth/logout', {})) as unknown as { success: boolean };
  },

  verifyOtp: async (data: VerifyOtpData): Promise<VerifyOtpEnvelope> => {
    return (await apiClient.post('/auth/verify-otp', data)) as unknown as VerifyOtpEnvelope;
  },

  resendOtp: async (data: ResendOtpData): Promise<MessageEnvelope> => {
    return (await apiClient.post('/auth/resend-otp', data)) as unknown as MessageEnvelope;
  },

  /** Always succeeds (no account enumeration) — sends a 6-digit recovery OTP. */
  forgotPassword: async (data: ForgotPasswordData): Promise<MessageEnvelope> => {
    return (await apiClient.post('/auth/forgot-password', data)) as unknown as MessageEnvelope;
  },

  /** `{ email, otp, new_password }` — does NOT sign the user in; redirect to login. */
  resetPassword: async (data: ResetPasswordData): Promise<MessageEnvelope> => {
    return (await apiClient.post('/auth/reset-password', data)) as unknown as MessageEnvelope;
  },
};

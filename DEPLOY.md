# Deploying the CircleCare Web Companion

The web companion is a static SPA. It shares the **same Express backend** as
mobile — no separate API, no duplicated endpoints. It just needs (a) a host for
the static bundle and (b) the backend reachable on a **same-site** domain so the
httpOnly refresh-token cookie is sent.

## The three pieces

| Host | What | Domain |
|---|---|---|
| Static SPA (this `webapp/` app) | the static bundle on Namecheap shared hosting | `my.circlecare.app` |
| Express backend (existing, on Railway) | unchanged API | `api.circlecare.app` |
| Marketing site (existing `CircleCareWeb`) | untouched | `circlecare.app` / `www` |

Everything stays under `circlecare.app`. That is what makes the auth cookie work:
the browser treats `my.circlecare.app` → `api.circlecare.app` as **same-site**, so
the `SameSite=Strict` `cc_refresh` cookie flows. A provider domain like
`*.up.railway.app` would be cross-site and the cookie would be silently dropped.

> **Two cookies, two scoping needs.** `cc_refresh` (httpOnly) is only ever *sent*
> to the API, so host-only on `api.circlecare.app` is fine. But `cc_session` (the
> JS-readable "a session may exist" hint) must be *read by the SPA* on
> `my.circlecare.app` — a host-only cookie set by the API is invisible there. So
> the backend must set **`COOKIE_DOMAIN=.circlecare.app`** in production, which
> scopes the hint cookie to the shared parent domain. Without it, login works but
> **every page reload logs the user out** (the SPA can't see the hint, so it never
> attempts the silent refresh).

## 1. Point the backend at api.circlecare.app (Railway custom domain)

This is an **alias** — same Railway service, no redeploy, no code move.

1. Railway → backend service → Settings → Networking → Custom Domain → add
   `api.circlecare.app`. Railway shows a CNAME target (e.g. `xxxx.up.railway.app`).
2. Namecheap → `circlecare.app` → Advanced DNS → add **CNAME**: host `api`,
   value = the Railway target. Railway auto-provisions TLS.
3. Backend env: set `WEB_ORIGIN=https://my.circlecare.app` (adds the web origin
   to CORS with `credentials: true`; mobile is unaffected) **and**
   `COOKIE_DOMAIN=.circlecare.app` (makes the `cc_session` hint cookie readable
   by the SPA across the api/my subdomains — see the callout above).

## 2. Deploy the SPA at my.circlecare.app (Namecheap shared hosting)

Production is Namecheap shared hosting (LiteSpeed, Apache-compatible). The server
config — SPA fallback rewrite, security headers/CSP, caching, and the AASA
content-type — lives entirely in `public/.htaccess`, which Vite copies into
`dist/` so it ships with every upload.

1. The `VITE_*` values live in the committed `.env.production` (all public
   client config by design) and are **baked into the bundle at build time**,
   not read at runtime:
   - `VITE_API_URL=https://api.circlecare.app`
   - `VITE_SUPABASE_URL=https://<project>.supabase.co`
   - `VITE_SUPABASE_ANON_KEY=<anon key>` (public by design; RLS + backend auth are the boundary)
   - `VITE_POSTHOG_KEY=<key>` (optional; analytics silently disabled if unset)
   - `VITE_REVENUECAT_WEB_BILLING_KEY=<rcb_… LIVE key>` (RevenueCat Web Billing
     public SDK key for the **CircleCare** project; use the live `rcb_…` key, NOT
     the sandbox `rcb_sb_…`. When unset the `/upgrade` page hides the Subscribe
     flow; when set to the wrong/sandbox key the offering loads empty and Subscribe
     stays disabled.)
2. `npm run build`, then upload the contents of `dist/` (including the hidden
   `.htaccess` and `.well-known/`) to the `my.circlecare.app` document root via
   cPanel File Manager or FTP.
3. DNS (already done): Namecheap → **CNAME**: host `my` → the hosting target.

> Moving to a different static host later (Vercel/Netlify/container): build
> command `npm run build`, output `dist`, SPA rewrite all routes →
> `/index.html`, and replicate the headers and AASA content-type from
> `public/.htaccess` in the host's config format.

### Before deploying — check the CSP origins in `public/.htaccess`

The `connect-src` / `img-src` / `frame-src` directives currently use
`api.circlecare.app`, `*.supabase.co`, and the PostHog US host. Swap in your real
origins if they differ (e.g. a different Supabase project URL or PostHog region).

## 3. Universal links (re-enables invite share links)

`public/.well-known/` ships:
- `apple-app-site-association` — already filled (`68Y4NLQ3VS.com.circlecare.circlecare`, paths `/invite/*`).
- `assetlinks.json` — **replace** `REPLACE_WITH_RELEASE_SIGNING_SHA256_FINGERPRINT`
  with the Android release signing cert SHA-256 (`keytool -list -v -keystore <release.keystore>`).

Vite copies `public/` to `dist/`; `public/.htaccess` (`ForceType`) serves the
extensionless AASA file as `application/json`.

## 4. Apple Sign In on web (can ship after launch)

Email + Google work immediately. Apple on web needs an Apple Developer **Services
ID** with return URL `https://my.circlecare.app/auth/callback`. Until then the
Apple button can be hidden. (Team ID `68Y4NLQ3VS`.)

## Crawler note for invite previews

`/invite/*` link previews need server-side meta tags. The SPA sets them via
react-helmet-async, which crawlers without JS won't see. If rich previews matter,
add a prerender rule for `/invite/*` at the host (or a small prerender service).

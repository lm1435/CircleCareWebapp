# Deploying the CircleCare Web Companion

The web companion is a static SPA. It shares the **same Express backend** as
mobile — no separate API, no duplicated endpoints. It just needs (a) a host for
the static bundle and (b) the backend reachable on a **same-site** domain so the
httpOnly refresh-token cookie is sent.

## The three pieces

| Host | What | Domain |
|---|---|---|
| Static SPA (this `web/` app) | the bundle nginx serves | `my.circlecare.app` |
| Express backend (existing, on Railway) | unchanged API | `api.circlecare.app` |
| Marketing site (existing `CircleCareWeb`) | untouched | `circlecare.app` / `www` |

Everything stays under `circlecare.app`. That is what makes the auth cookie work:
the browser treats `my.circlecare.app` → `api.circlecare.app` as **same-site**, so
the `SameSite=Strict` `cc_refresh` cookie flows. A provider domain like
`*.up.railway.app` would be cross-site and the cookie would be silently dropped.

## 1. Point the backend at api.circlecare.app (Railway custom domain)

This is an **alias** — same Railway service, no redeploy, no code move.

1. Railway → backend service → Settings → Networking → Custom Domain → add
   `api.circlecare.app`. Railway shows a CNAME target (e.g. `xxxx.up.railway.app`).
2. Namecheap → `circlecare.app` → Advanced DNS → add **CNAME**: host `api`,
   value = the Railway target. Railway auto-provisions TLS.
3. Backend env: set `WEB_ORIGIN=https://my.circlecare.app`. (Adds the web origin
   to CORS with `credentials: true`; mobile is unaffected.)

## 2. Deploy the SPA at my.circlecare.app

Container hosting (Railway/Render/Fly — keeps everything on one platform):

- The `Dockerfile` builds the bundle and serves it via nginx on port 8080 with
  the strict security headers in `nginx.conf`.
- Pass these **build args / service variables** (baked in at build time):
  - `VITE_API_URL=https://api.circlecare.app`
  - `VITE_SUPABASE_URL=https://<project>.supabase.co`
  - `VITE_SUPABASE_ANON_KEY=<anon key>` (public by design; RLS + backend auth are the boundary)
  - `VITE_POSTHOG_KEY=<key>` (optional; analytics silently disabled if unset)
- Add the custom domain `my.circlecare.app` to the service, then Namecheap →
  **CNAME**: host `my`, value = the host's target.

> Vercel/Netlify alternative: point it at `web/`, build command `npm run build`,
> output `dist`, SPA rewrite all routes → `/index.html`, and replicate the
> headers from `nginx.conf` (Vercel `vercel.json` `headers`, or Netlify `_headers`).

### Before deploying — edit the CSP origins in `nginx.conf`

The `connect-src` / `img-src` / `frame-src` directives currently use
`api.circlecare.app`, `*.supabase.co`, and the PostHog US host. Swap in your real
origins if they differ (e.g. a different Supabase project URL or PostHog region).

## 3. Universal links (re-enables invite share links)

`public/.well-known/` ships:
- `apple-app-site-association` — already filled (`68Y4NLQ3VS.com.circlecare.circlecare`, paths `/invite/*`).
- `assetlinks.json` — **replace** `REPLACE_WITH_RELEASE_SIGNING_SHA256_FINGERPRINT`
  with the Android release signing cert SHA-256 (`keytool -list -v -keystore <release.keystore>`).

Vite copies `public/` to `dist/`, and `nginx.conf` serves both as `application/json`.

## 4. Apple Sign In on web (can ship after launch)

Email + Google work immediately. Apple on web needs an Apple Developer **Services
ID** with return URL `https://my.circlecare.app/auth/callback`. Until then the
Apple button can be hidden. (Team ID `68Y4NLQ3VS`.)

## Crawler note for invite previews

`/invite/*` link previews need server-side meta tags. The SPA sets them via
react-helmet-async, which crawlers without JS won't see. If rich previews matter,
add a prerender rule for `/invite/*` at the host (or a small prerender service).

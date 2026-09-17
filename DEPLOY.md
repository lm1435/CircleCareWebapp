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
2. `npm run build` — **not** `npx vite build`. The build has TWO stages: Vite,
   then `scripts/build-locale-html.mjs`, which derives `dist/index.es.html` for
   Spanish link previews. **Vite runs first, so a locale-step failure leaves a
   complete-looking, deployable `dist/` that is missing `index.es.html`** — and
   the error prints just under Rollup's chunk-size warning, which is easy to skim
   past. The last line MUST read:

   ```
   build-locale-html: wrote .../dist/index.es.html (7 rewrites, all asserted).
   ```

   Then confirm before uploading:

   ```bash
   ls dist/index.es.html dist/.htaccess dist/.well-known/
   ```

   Upload the contents of `dist/` — **including the hidden `.htaccess`, the
   `.well-known/` directory, and `index.es.html`** — to the `my.circlecare.app`
   document root via cPanel File Manager or FTP. **Turn on "show hidden files"**:
   cPanel hides dotfiles by default and many FTP clients skip them. A split upload
   fails in two ways, and one of them is silent:
   - new `.htaccess` without `index.es.html` → **404 on every Spanish invite**
   - `index.es.html` without the new `.htaccess` → **200, English card, no error
     anywhere**

   **Then prune old chunks from `assets/`.** Uploads only add files; nothing
   removes the previous deploy's hashed JS/CSS, so every past build stays
   downloadable. ORDER IS LOAD-BEARING: upload first, prune second. Emptying
   `assets/` before the upload white-screens the site until it lands.
   - In File Manager, open `assets/` and sort by **Last Modified**.
   - Keep this upload **and the previous deploy's** files; delete anything
     older. The one-deploy buffer covers tabs still open on the last version.
   - A tab older than that which lazy-loads a deleted chunk shows the error
     screen, and its "Try again" does a full reload onto the new build
     (`src/components/ErrorBoundary.tsx`, `isChunkLoadError`). One extra tap,
     not a broken app.

   Verify directory listing stays off (`Options -Indexes` in `.htaccess`):

   ```bash
   curl -s -o /dev/null -w '%{http_code}\n' https://my.circlecare.app/assets/
   ```

   Expect `403`. A `200` means the new `.htaccess` did not upload.
3. DNS (already done): Namecheap → **CNAME**: host `my` → the hosting target.

> Moving to a different static host later (Vercel/Netlify/container): build
> command `npm run build`, output `dist`, and replicate the headers and AASA
> content-type from `public/.htaccess` in the host's config format.
>
> **Do NOT blanket-rewrite all routes to `/index.html`.** `public/.htaccess` now
> serves `index.es.html` for any non-file route whose query carries `lang=es`, and
> that rule is order-dependent: it must sit AFTER the `.well-known` and
> `-f`/`-d` passthroughs and BEFORE the unconditional `index.html` fallback. A
> catch-all SPA rewrite silently drops it and reverts every Spanish invite to an
> English preview card, with no error anywhere. Nothing in the test suite catches
> a `.htaccess` regression.

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

## Crawler note for invite previews — DONE, do not re-solve

`/invite/*` link previews need server-side meta tags, because the SPA sets them via
react-helmet-async and crawlers without JS never see them. **This is now handled at
build time**: `index.html` is prerendered with the English tags, and
`scripts/build-locale-html.mjs` derives `index.es.html` with the Spanish ones.
`public/.htaccess` picks between them on `?lang=es`, which
`src/utils/inviteShareUrl.ts` stamps onto the link when the sender's app language
is Spanish. No prerender service is needed.

Known gap: `/?lang=es` on the bare **root** serves English, because the `-d`
passthrough matches first. Invites are always `/invite/:code`, so this does not
affect them.

## Public files carry no comments

Everything in `index.html` and `public/` is downloadable by any visitor, so none
of it has comments. The reasoning that used to live inline is recorded here.

**`index.html` link-preview tags**
- Copy (title, description, image alt) is edited in `index.html` only;
  `scripts/build-locale-html.mjs` asserts every string it rewrites for
  `index.es.html` and fails the build if an edit stops matching.
- The preview copy deliberately differs from the marketing site's SEO copy; do
  not resync the two.
- `og-invite-en.jpg` / `og-invite-es.jpg` are a separate cut from the marketing
  `og-image-*` (no subtitle or store badge, legible at iMessage's ~260pt card).
  Re-export via screenshot-gen `/api/export-og?lang=en&variant=invite`.
- `og-image-en.jpg` / `og-image-es.jpg` stay in `public/` unreferenced on
  purpose: invite links already sent must not 404 when a crawler re-fetches.
- `og:image` is an absolute URL because some crawlers do not resolve relative
  paths. There is no `og:url`, because some clients show it in place of the
  shared invite link. The image file is 2400x1260, declared as 1200x630.

**`public/robots.txt`**
- Search engines are blocked (`Disallow: /`); the app is behind login.
- Link-preview unfurlers (Slack, Twitter, LinkedIn, Discord, Telegram, WhatsApp,
  facebookexternalhit) are allowed, because several honor robots.txt and would
  otherwise render no invite card. They fetch one URL on demand and see only the
  static tags in `index.html`, never per-invite details set at runtime.

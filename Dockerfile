# Multi-stage build for the CircleCare web companion.
# Stage 1 builds the Vite SPA; stage 2 serves it with nginx + security headers.
#
# Build-time env: the VITE_* values are baked into the bundle at build time, so
# they must be passed as build args (NOT runtime env). Supply them in the host's
# build settings (Railway: service variables are available at build).

FROM node:20-alpine AS build
WORKDIR /app

# Install deps from the lockfile (reproducible, no surprise upgrades).
COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# Public client config — passed as build args by the deploy platform.
# NOTE: .env.* is excluded by .dockerignore, so EVERY VITE_* value the client
# needs must be declared here; otherwise it bakes in as undefined. The RevenueCat
# Web Billing key gates the /upgrade purchase flow — omit it and Subscribe is dead.
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
ARG VITE_API_URL
ARG VITE_POSTHOG_KEY
ARG VITE_REVENUECAT_WEB_BILLING_KEY
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL \
    VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY \
    VITE_API_URL=$VITE_API_URL \
    VITE_POSTHOG_KEY=$VITE_POSTHOG_KEY \
    VITE_REVENUECAT_WEB_BILLING_KEY=$VITE_REVENUECAT_WEB_BILLING_KEY

# build runs `tsc --noEmit && vite build`; sourcemaps are disabled in vite.config.
RUN npm run build

FROM nginx:1.27-alpine AS runtime
RUN rm /etc/nginx/conf.d/default.conf
COPY nginx.conf /etc/nginx/conf.d/circlecare.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK CMD wget -q --spider http://localhost:8080/ || exit 1
CMD ["nginx", "-g", "daemon off;"]

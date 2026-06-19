# Founder Calendar — TanStack Start (SSR) frontend
#
# The app is server-rendered (no static SPA shell), so we build with Vite and
# serve the production build with `vite preview`. `vite preview` needs Vite and
# the project config, which live in devDependencies — so the runtime stage keeps
# node_modules rather than trying to ship a static-only image.

FROM node:22-alpine AS build
WORKDIR /app

# Install deps first (cached unless the manifest changes).
# Use `npm install` rather than `npm ci`: the repo's primary lockfile is bun.lock,
# so the committed package-lock.json drifts from package.json (e.g. jspdf's
# transitive deps). `npm install` reconciles it; `npm ci` would hard-fail.
COPY package.json package-lock.json* ./
RUN npm install --no-audit --no-fund

COPY . .

# VITE_* values are inlined into the client bundle at build time, so they must
# be known here. VITE_API_URL is the URL the *browser* uses to reach the
# backend (i.e. the host-published port), not the in-network service name.
ARG VITE_API_URL=http://localhost:8000
ARG VITE_GOOGLE_CLIENT_ID=
ARG VITE_GOOGLE_SIGNIN=
ENV VITE_API_URL=$VITE_API_URL \
    VITE_GOOGLE_CLIENT_ID=$VITE_GOOGLE_CLIENT_ID \
    VITE_GOOGLE_SIGNIN=$VITE_GOOGLE_SIGNIN
RUN npm run build

EXPOSE 8080

# Serve the SSR build. --host exposes it outside the container.
CMD ["npx", "vite", "preview", "--host", "0.0.0.0", "--port", "8080"]

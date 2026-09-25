# syntax=docker/dockerfile:1.7
# Satu Dockerfile multi-target untuk seluruh monorepo (context = root repo).
#   target backend : API Fastify + worker + migrasi (dijalankan dengan tsx dari source TypeScript)
#   target web     : Next.js output standalone

FROM node:22-alpine AS base
RUN apk add --no-cache openssl libc6-compat \
  && corepack enable && corepack prepare pnpm@10.34.5 --activate
WORKDIR /app
ENV CI=true

# Manifest dulu agar layer instalasi dependensi bisa di-cache.
FROM base AS manifests
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/worker/package.json apps/worker/
COPY apps/web/package.json apps/web/
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
COPY packages/lua/package.json packages/lua/
COPY packages/shared/package.json packages/shared/
COPY packages/db/prisma packages/db/prisma

FROM manifests AS backend-deps
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
  pnpm install --frozen-lockfile --filter "@antretix/api..." --filter "@antretix/worker..." --filter "@antretix/db..."

FROM backend-deps AS backend
COPY packages packages
COPY apps/api apps/api
COPY apps/worker apps/worker
RUN pnpm --filter @antretix/db generate
ENV NODE_ENV=production
EXPOSE 4000 9101

FROM manifests AS web-deps
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
  pnpm install --frozen-lockfile --filter "@antretix/web..."

FROM web-deps AS web-build
COPY packages/shared packages/shared
COPY apps/web apps/web
ARG NEXT_PUBLIC_API_URL=/api
ARG NEXT_PUBLIC_TURNSTILE_SITE_KEY=1x00000000000000000000AA
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL \
  NEXT_PUBLIC_TURNSTILE_SITE_KEY=$NEXT_PUBLIC_TURNSTILE_SITE_KEY \
  NEXT_STANDALONE=1 \
  NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter @antretix/web build

FROM node:22-alpine AS web
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000
COPY --from=web-build /app/apps/web/.next/standalone ./
COPY --from=web-build /app/apps/web/.next/static ./apps/web/.next/static
EXPOSE 3000
CMD ["node", "apps/web/server.js"]

# REMIX HUB — single-service image. The API serves the built web app from the
# same origin, so one container hosts the whole site.
FROM node:22-slim AS build
WORKDIR /app
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile
# Build domain + client packages, the web (same-origin API), then the API.
RUN pnpm --filter @remix-hub/core build \
 && pnpm --filter @remix-hub/client-core build \
 && VITE_API_BASE="" pnpm --filter @remix-hub/web build \
 && pnpm --filter @remix-hub/api build

FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080
# Copy the whole built workspace (incl. pnpm-linked node_modules) for simplicity.
COPY --from=build /app /app
EXPOSE 8080
# Default storage is in-memory (seeded). Set DATABASE_URL or USE_PGLITE to persist.
CMD ["node", "apps/api/dist/server.js"]

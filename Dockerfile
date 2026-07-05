# Single multi-purpose image; each service overrides `command` in docker-compose.
FROM node:22-slim AS base
ENV PNPM_HOME=/pnpm PATH="/pnpm:$PATH"
RUN corepack enable && corepack prepare pnpm@11.5.3 --activate
# Build toolchain for native deps (argon2).
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# Install deps (respect the allowBuilds allowlist for native modules).
COPY pnpm-workspace.yaml package.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/db/package.json packages/db/
COPY packages/core/package.json packages/core/
COPY packages/infra/package.json packages/infra/
COPY packages/testing/package.json packages/testing/
COPY apps/api/package.json apps/api/
COPY apps/scheduler/package.json apps/scheduler/
COPY apps/worker/package.json apps/worker/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile=false

# Build everything (turbo builds libs before apps).
COPY . .
RUN pnpm --filter @flux/shared build \
 && pnpm --filter @flux/db build \
 && pnpm --filter @flux/core build \
 && pnpm --filter @flux/infra build \
 && pnpm --filter @flux/api build \
 && pnpm --filter @flux/scheduler build \
 && pnpm --filter @flux/worker build \
 && (pnpm --filter @flux/web build || echo "web build skipped")

EXPOSE 4000 3000
CMD ["node", "apps/api/dist/main.js"]

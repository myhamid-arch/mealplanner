# syntax=docker/dockerfile:1.19
# Worker image (ARC-7, ARC-9; leaf 1.4.1 R-e): pg-boss job runner and scheduler.
# Build from the repository root: docker build -f apps/worker/Dockerfile -t mealplanner-worker .
# `node packages/db/dist/src/seed/run.js` in the same image applies the migrations and loads the
# catalogue and seed library (idempotent), as docker-compose.yml does before starting the worker.
# Runtime configuration: DATABASE_URL, DATA_DIR (defaults to the image's data/), ANTHROPIC_API_KEY
# (optional; without it AI generation reports itself unavailable), ANTHROPIC_MODEL,
# AI_RECIPE_DAILY_LIMIT, WORKER_CONCURRENCY, LOG_LEVEL.
FROM node:22.12-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate
WORKDIR /app

FROM base AS build
COPY --exclude=.git --exclude=**/node_modules --exclude=**/dist --exclude=**/.next --exclude=**/.turbo . .
RUN pnpm install --frozen-lockfile
RUN pnpm exec turbo run build --filter=@mealplanner/worker... --filter=@mealplanner/db

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /app /app
USER node
CMD ["node", "apps/worker/dist/src/main.js"]

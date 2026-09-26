# syntax=docker/dockerfile:1.19
# Web app image (ARC-9, ARC-11; leaf 1.4.1 R-e): the Next.js app serving the UI and /api/v1.
# Build from the repository root: docker build -f apps/web/Dockerfile -t mealplanner-web .
# Runtime configuration comes from the environment (.env.example): DATABASE_URL, AUTH_SECRET,
# APP_URL, EMAIL_SERVER/EMAIL_FROM, CHAT_TURNS_PER_HOUR, AI_RECIPE_DAILY_LIMIT, LOG_LEVEL.
FROM node:22.12-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH NEXT_TELEMETRY_DISABLED=1
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate
WORKDIR /app

FROM base AS build
# The workspace sources only: local installs and build output are rebuilt in the image.
COPY --exclude=.git --exclude=**/node_modules --exclude=**/dist --exclude=**/.next --exclude=**/.turbo . .
RUN pnpm install --frozen-lockfile
RUN pnpm exec turbo run build --filter=@mealplanner/web...

FROM base AS runtime
ENV NODE_ENV=production PORT=3000
COPY --from=build /app /app
WORKDIR /app/apps/web
EXPOSE 3000
USER node
CMD ["node_modules/.bin/next", "start", "--port", "3000"]

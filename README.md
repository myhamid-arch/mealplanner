# Mise: family meal planner

A web app (installable on phones) that plans a family's meals around each person's macro targets,
the slots they eat in (school and work lunches, training days), the cuisines they like and what
they must never eat. Claude writes recipes, reads free-text answers during onboarding, learns from
reviews and runs an admin chat assistant.

- `apps/web`: Next.js app (UI and API routes)
- `apps/worker`: background jobs (planning, recipe generation, insights)
- `packages/*`: shared code: `core` (domain logic, no I/O), `db` (PostgreSQL schema, migrations,
  seed loader), `ai` (Claude calls), `api-contract`, `graph`, `ui-tokens`
- `data/`: the ingredient catalogue and seed recipes, loaded on first start
- `docs/spec/`: the specification; `docs/spec/11-build-plan.md` §8 records every decision and fix

## What you need

- An Anthropic API key (console.anthropic.com). Without one the app still runs, but recipe
  generation, the chat assistant and the onboarding assistant are off.
- Git.
- For option A: Docker Desktop.
- For option B also: Node.js 22 (22.13 or later, not 23) and pnpm 10.

Get the code (the work is on this branch):

```
git clone https://github.com/myhamid-arch/mealplanner.git
cd mealplanner
git checkout claude/family-meal-planner-macros-8s782a
```

## Option A: run everything in Docker (to use the app)

1. Create your settings file:

   ```
   cp .env.example .env
   ```

2. Open `.env` in a text editor and set two lines:
   - `ANTHROPIC_API_KEY=` your key after the `=`.
   - `AUTH_SECRET=` any random text of at least 32 characters (`openssl rand -base64 32` makes
     one).

   Leave the rest as it is. `.env` is git-ignored: never commit it.

3. Start it:

   ```
   docker compose up --build
   ```

   The first start takes several minutes: it builds the images, creates the database, and loads
   the catalogue and seed recipes. It is ready when the log shows the web app listening.

4. Open http://localhost:3000, choose **Create a household**, and answer the five onboarding
   questions.

Stop with Ctrl+C. Your data stays in a Docker volume; `docker compose down -v` deletes it.
After pulling new code, run `docker compose up --build` again.

## Option B: develop locally (to change the code)

1. Install the tools: Node.js 22 from nodejs.org (or `nvm install 22`), then:

   ```
   corepack enable
   pnpm install
   ```

2. Start only the database in Docker:

   ```
   docker compose up -d postgres
   ```

3. Create `.env` as in option A, steps 1 and 2. Keep
   `DATABASE_URL=postgres://postgres:postgres@localhost:5432/mealplanner`.

4. Build the packages, then create the tables and load the catalogue (safe to repeat):

   ```
   pnpm build
   set -a; . ./.env; set +a
   node packages/db/dist/src/seed/run.js
   ```

5. Run the worker and the web app, each in its own terminal (run `set -a; . ./.env; set +a`
   in each new terminal first):

   ```
   pnpm --filter @mealplanner/worker start
   ```

   ```
   pnpm --filter @mealplanner/web dev
   ```

   Open http://localhost:3000. The web app reloads on save. After changing anything under
   `packages/`, run `pnpm build` again (or `pnpm --filter @mealplanner/<name> build`).

## Checks before you push

```
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test:unit
```

`pnpm test:integration` needs the database from option B, step 2. The full acceptance gates are
in `scripts/verify/` (`node scripts/verify/leaf-1.4.7.mjs --gate G1`, for example); they start
their own throwaway databases and print `VERIFY … PASSED` or `FAILED`.

## Settings you may want

All are in `.env.example`, with comments:

- `ANTHROPIC_MODEL`: the model for recipes, insights and the chat assistant (empty = built-in
  default).
- `ONBOARDING_PARSE_MODEL`: the faster model that reads onboarding answers (empty = built-in).
- `EMAIL_SERVER`, `EMAIL_FROM`: SMTP for emailed sign-in links and invites (optional; without
  them, emailing is off and invites are shared as links).
- `AI_RECIPE_DAILY_LIMIT`, `CHAT_TURNS_PER_HOUR`: per-household rate limits.

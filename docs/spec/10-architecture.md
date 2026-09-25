# 10 — Architecture

## 1. Stack (ARC-1)

| Concern | Choice | Reason |
|---|---|---|
| Language | TypeScript 5 (strict) everywhere | one language across web, mobile, core and AI |
| Monorepo | pnpm workspaces + Turborepo | shared packages between web, mobile and worker |
| Web | Next.js (App Router, React 19, Server Components) | SSR, route handlers for the API, streaming |
| Styling | Tailwind CSS v4 with CSS-variable tokens + Radix primitives (shadcn/ui pattern) | fast, themeable, accessible |
| Motion | `motion` (Framer Motion) | UX-5 |
| Database | PostgreSQL 16 | relational core, JSONB, recursive CTEs for the graph, pg-boss queue |
| ORM / migrations | Drizzle ORM + drizzle-kit | typed schema, SQL-first migrations |
| Background jobs | pg-boss (Postgres-backed) in `apps/worker` | no extra infrastructure |
| Optimisation | HiGHS via the `highs` WASM package | MILP portion solver (PLN-5) |
| Validation | Zod (shared DTOs, AI schemas, change-op payloads) | one schema source |
| LLM | `@anthropic-ai/sdk`, model from env (default `claude-opus-5`) | REC-2, AGT-2 |
| Auth | Better Auth (email + password, email magic link optional, organisation-style invites mapped to households) with the Drizzle adapter | web cookies + mobile bearer tokens |
| Mobile | Phase A: installable PWA. Phase B: Expo (React Native) app on the shared API client (§7; OQ-3) | |
| Tests | Vitest (unit/integration), Playwright (e2e, Chromium) | |
| Lint/format | ESLint (typescript-eslint strict) + Prettier | |

The builder MUST pin exact dependency versions. Where a library's API is uncertain (Better Auth, `highs`, Tailwind v4 config), the builder verifies it against the installed package before use and records the version in `docs/decisions/`.

## 2. Repository layout (ARC-2)

```
apps/
  web/                 Next.js app (UI + /api/v1 route handlers + SSE)
  worker/              pg-boss worker: plan jobs, insights, kg sync, nutrition cache
  mobile/              Expo app (phase B)
packages/
  core/                PURE: nutrition/, planner/, learning/, changes/ (registry, ops), types/
  db/                  Drizzle schema, migrations, repositories (household-scoped), seed loaders
  ai/                  Anthropic client wrapper, recipe generator, insights synthesiser, agent loop + tools
  graph/               GraphStore interface + PostgresGraphStore + sync
  api-contract/        Zod DTOs for every endpoint + typed fetch client (used by web client code and mobile)
  ui-tokens/           colour/type/spacing tokens (CSS vars + TS export for React Native)
data/                  ingredients.v1.json, method-yields.v1.json, soluble-fibre.csv, cuisines.json, seed-dishes/*.json, substitutes.csv
evals/agent/           agent eval cases (AGT-9)
docs/spec/             this specification
docs/decisions/        ADRs written by builder/architect during the build
scripts/               import-fdc.ts, kg-rebuild.ts, dev helpers
```

**Dependency rule (ARC-3).** `core` depends on nothing internal and does no I/O. `db`, `graph` and `ai` may depend on `core`. `apps/*` depend on the packages. A lint rule (`eslint-plugin-boundaries` or `dependency-cruiser`) enforces this.

## 3. Service layer (ARC-4)

`apps/web` route handlers and server components, and `apps/worker` jobs, call **services** (in `packages/db` / `packages/ai`) that take a `HouseholdContext { householdId, userId, role }`. Route handlers contain no business logic. Services are the only place transactions are opened. All writes go through the change-set service (DM-6).

## 4. API (ARC-5)

- REST JSON under `/api/v1/...`. Request and response schemas live in `packages/api-contract`. An OpenAPI document is generated from them at `/api/v1/openapi.json`.
- Main resources: `households`, `members`, `targets`, `slots`, `schedules`, `weights`, `dishes`, `ingredients`, `plans` (+ `/generate`), `plan-meals` (+ `/alternatives`, `/swap`, `/lock`), `plates`, `cook-sheets/:date`, `reviews`, `preferences`, `proposals` (+ `/accept`, `/reject`), `change-sets` (+ `/undo`), `conversations` (+ `/messages` POST streams SSE), `jobs/:id/events` (SSE).
- Errors use RFC 7807 problem+json. Every endpoint enforces role (§5) and household scope.
- Web client components use the typed client from `api-contract`, and so does the mobile app. There is one contract.

## 5. Auth and authorisation (ARC-6)

- Signing up creates a user and a household. The user becomes admin.
- Invites use a code or link (with a QR on the Family screen) bound to a role and optionally a member.
- Web uses httpOnly session cookies. Mobile uses bearer tokens from the same auth library.
- Authorisation matrix:

| Action | admin | member | kitchen |
|---|---|---|---|
| read plans/recipes | ✓ | ✓ | ✓ |
| read other members' targets/plates | ✓ | own; other members' plates only if the household setting "members see each other's plates" is on (default on) | plating table only |
| write reviews | ✓ | ✓ (own or linked member) | kitchen tags only |
| edit own taste preferences | ✓ | ✓ | – |
| everything else (config, changes, proposals, chat) | ✓ | – | – |

- Rate limits: chat 30 turns/hour/household, recipe generation 60 dishes/day/household. Both are configurable by env.

## 6. Background jobs (ARC-7)

| Job | Trigger | Notes |
|---|---|---|
| `plan.generate` | API / agent | emits progress events to `job_event` (LISTEN/NOTIFY → SSE) |
| `nutrition.recompute` | variant/ingredient/yield change, engine version bump | updates `dish_nutrition_cache` |
| `plates.resolve` | target/tolerance/slot/schedule change | re-solves future plates |
| `insights.run` | 10 new reviews, nightly 02:00 household tz, on demand | FBK-7 |
| `reviews.extract` | new review with comment | LLM extracts implicit tags from free text (structured output, `claude-opus-5` at `effort: low`); marks review processed |
| `kg.sync` / `kg.nightly` | entity writes / nightly | KG-3 |

## 7. Mobile (ARC-8)

- **Phase A (v1).** The web app is an installable PWA: manifest, icons, and a service worker that caches the app shell plus the latest Today plan and cook sheet for offline read. Responsive layouts as in UX-3.
- **Phase B.** An Expo app (`apps/mobile`) with Today, Plan, Recipes, Reviews and Chat. It uses `api-contract` and `ui-tokens`, with push notifications for meal-time review prompts and proposals. Phase B starts after v1 acceptance, unless the owner decides otherwise (OQ-3).

## 8. Configuration (ARC-9)

Env vars: `DATABASE_URL`, `ANTHROPIC_API_KEY` (or any credential the SDK resolves), `ANTHROPIC_MODEL` (default `claude-opus-5`), `AGENT_EFFORT` (default `high`), `APP_URL`, `AUTH_SECRET`, `EMAIL_*` (optional, for magic links and invites), `RUN_LLM_EVALS`. There are no secrets in the repo. `.env.example` documents all of them.

## 9. Security and privacy (ARC-10)

- Household scoping is enforced in the repository layer, and a test suite attempts cross-household access on every endpoint.
- Pseudonymised prompts for recipe generation and insights (REC-3, FBK-7).
- Content-Security-Policy and secure cookies. Passwords are hashed by the auth library.
- Reviews and comments are plain text rendered safely. Markdown in chat is sanitised.
- `ai_generation` stores request summaries, never credentials.

## 10. Deployment (ARC-11)

`docker-compose.yml` with `postgres:16`, `web` and `worker`. A single-VM deployment is enough for v1. Migrations run on deploy (`drizzle-kit migrate`). Seed data loads idempotently. Hosting provider and region are an owner decision (OQ-6).

## 11. Observability (ARC-12)

Structured logs (pino) with a household id and request id. Job durations and planner metrics are logged per run: solve counts, infeasible counts and time. There is an admin-only diagnostics page with the last 50 AI calls (tokens, cache hits, stop reasons) and failed jobs.

# leaf-1.1.1 ADR-6: application dependencies declared up front (ARC-1)

Status: proposed (CP1)
Requirement: ARC-1, 11-build-plan §4 "Shared manifests"

Exact versions are the latest published on 2026-09-25 (`npm view <pkg> version`), except TypeScript (latest 5.x) and @types/node (latest 22.x).

| ARC-1 concern | Package@version | Declared in |
|---|---|---|
| Language | typescript@5.9.3, @types/node@22.20.4 | root (dev) |
| Monorepo | turbo@2.11.4, pnpm@10.33.0 | root |
| Web | next@16.3.6, react@19.3.0, react-dom@19.3.0, @types/react@19.3.0, @types/react-dom@19.3.0 | apps/web |
| Styling | tailwindcss@4.3.3, @tailwindcss/postcss@4.3.3, radix-ui@1.6.7 | apps/web |
| Motion | motion@13.4.4 | apps/web |
| Database driver | pg@8.23.0, @types/pg@8.23.1 | packages/db, packages/graph |
| ORM / migrations | drizzle-orm@0.45.3; drizzle-kit@0.31.11 (dev) | packages/db (+ drizzle-orm in graph) |
| Jobs | pg-boss@12.34.0 | apps/worker |
| Optimisation | highs@1.15.3 | packages/core (solver lives in core/planner/solver per §4) |
| Validation | zod@4.6.5 | core, db, ai, api-contract, apps/web |
| LLM | @anthropic-ai/sdk@0.128.0 | packages/ai |
| Auth | better-auth@1.7.6 (Drizzle adapter is the `better-auth/adapters/drizzle` subpath of the same package) | apps/web |
| Tests | vitest@5.0.2 (root dev), @playwright/test@1.63.0 (apps/web dev) | |
| Lint/format | eslint@10.11.0, @eslint/js@10.0.1, typescript-eslint@8.70.1, eslint-plugin-boundaries@7.2.0, eslint-config-prettier@10.1.8, prettier@3.9.9 | root (dev) |

`pg` is the driver because pg-boss already depends on node-postgres; one driver for ORM and queue.

Not declared (named outside ARC-1, so out of this leaf's scope): `pino` (ARC-12), Expo (phase B, OQ-3). APIs of better-auth, highs and Tailwind v4 are verified against the installed packages by the leaves that use them.

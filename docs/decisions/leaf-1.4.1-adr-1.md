# leaf-1.4.1 ADR-1: Better Auth 1.7.6 wiring

Status: proposed (CP1)
Requirement: ARC-6, R2-ADM-1, R2-ADM-4, R2-ADM-5, ARC-10; leaf-1.1.2 ADR-4

## Decision

- `better-auth` **1.7.6** (already in `apps/web`), `betterAuth({...})` in `apps/web/lib/auth/server.ts`, one instance per process, built from a `pg.Pool` through Drizzle (`drizzle-orm` 0.45.3 `node-postgres`).
- Adapter: `@better-auth/drizzle-adapter` 1.7.6 (a dependency of `better-auth`, imported as `better-auth/adapters/drizzle`), `provider: "pg"`, `schema` = the 1.1.2 tables (`user`, `session`, `account`, `verification`, `two_factor`). Column names are mapped with each model's `fields` option (snake_case, ADR-4 of 1.1.2). `advanced.database.generateId` returns `newId()` (UUIDv7) from `@mealplanner/db/schema`.
- Methods: `emailAndPassword` (library hashing, ARC-10), plugins `magicLink` (sends through the mailer, ADR-4), `twoFactor` (TOTP; issuer = the product name), `bearer` (mobile bearer tokens, ARC-6).
- `session.cookieCache` is **off**: every request reads the session row, so deleting sessions takes effect on the next request (R2-ADM-4, G4). Cookies are httpOnly, `SameSite=Lax`, `Secure` when `APP_URL` is https.
- `databaseHooks.session.create.before` refuses a session for a platform-blocked user or a user with no active (non-blocked) membership (SPEC-Q-5); platform operators are exempt from the membership rule.
- `apps/web/app/api/auth/[...all]/route.ts` mounts the handler and refuses `sign-up/*` (SPEC-Q-3).
- `apps/web/lib/auth/context.ts` exports `requireContext(request, rule)`: session → user → membership (SPEC-Q-2) → status and TOTP checks (SPEC-Q-5/6) → `HouseholdContext { householdId, userId, role }` (ARC-4), or a typed `ProblemError` (401/403/404/409). `requireOperator(request)` does the same for `platform_operator`.
- Every plugin option and hook name used is checked against the installed package's `.d.mts` before use; the list goes into this ADR at CP2.

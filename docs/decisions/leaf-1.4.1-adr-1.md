# leaf-1.4.1 ADR-1: Better Auth 1.7.6 wiring

Status: accepted at CP1 (R-40); as built at CP2
Requirement: ARC-6, R2-ADM-1, R2-ADM-4, R2-ADM-5, ARC-10; leaf-1.1.2 ADR-4

## Decision

- `better-auth` **1.7.6** (already in `apps/web`), `betterAuth({...})` in `apps/web/lib/auth/server.ts`, one instance per process, built from a `pg.Pool` through Drizzle (`drizzle-orm` 0.45.3 `node-postgres`).
- Adapter: `better-auth/adapters/drizzle` 1.7.6, `provider: "pg"`, `schema` = the 1.1.2 Drizzle tables (`user`, `session`, `account`, `verification`, `twoFactor` → `two_factor`). The Drizzle tables already carry the snake_case column names (1.1.2 ADR-4), so no `fields` mapping is needed. `advanced.database.generateId` returns `newId()` (UUIDv7) from `@mealplanner/db/schema`.
- Methods: `emailAndPassword` (library hashing, ARC-10), plugins `magicLink` (sends through the mailer, ADR-4), `twoFactor` (TOTP; issuer = the product name), `bearer` (mobile bearer tokens, ARC-6).
- `session.cookieCache` is **off**: every request reads the session row, so deleting sessions takes effect on the next request (R2-ADM-4, G4). Cookies are httpOnly, `SameSite=Lax`, `Secure` when `APP_URL` is https.
- `databaseHooks.session.create.before` refuses a session for a platform-blocked user or a user with no active (non-blocked) membership (SPEC-Q-5); platform operators are exempt from the membership rule.
- `apps/web/app/api/auth/[...all]/route.ts` mounts the handler and refuses `sign-up/*` (SPEC-Q-3).
- `apps/web/lib/auth/context.ts` exports `readSession`, `requireSession`, `requireHousehold(rt, request, roles)` (session → membership by `X-Household-Id` or the single membership, SPEC-Q-2 → login status, household suspension, role row, TOTP rule, SPEC-Q-5/6 → `CallerContext` with the ARC-4 `HouseholdContext`), and `requireOperator`; failures are typed `ProblemError`s (401/403/404/409). `lib/server/route.ts` applies the endpoint's `auth` kind before parsing its input.
- Options used, each checked against the installed 1.7.6 type declarations: `appName`, `baseURL`, `basePath: "/api/auth"`, `secret`, `trustedOrigins`, `database: drizzleAdapter(db, { provider, schema })`, `advanced.database.generateId`, `advanced.useSecureCookies`, `session.cookieCache.enabled: false`, `emailAndPassword { enabled, autoSignIn: false, minPasswordLength: 8, maxPasswordLength: 128, revokeSessionsOnPasswordReset: true, sendResetPassword }`, `databaseHooks.session.create.before`; plugins `twoFactor({ issuer })`, `magicLink({ expiresIn: 900, disableSignUp: true, sendMagicLink })`, `bearer()`. Server API calls: `signUpEmail`, `signInEmail` (`returnHeaders: true`, token from `set-auth-token`), `getSession` (`disableCookieCache`), `enableTwoFactor`, `verifyTOTP` (`returnHeaders: true`), `disableTwoFactor`, `changePassword` (`revokeOtherSessions: true`), `verifyPassword`, `requestPasswordReset`.
- Found in G1: enabling TOTP makes `verifyTOTP` delete the calling session and issue a new one. `POST /api/v1/account/totp/verify` therefore returns the new bearer token (`token`) and forwards the new session cookie; a client that ignored it would be signed out.

# leaf-1.4.6 ADR-1: how the screens talk to the auth library and the API

Status: proposed at CP1
Requirement: R2-ADM-1, R2-ADM-5, ARC-5, ARC-6, BLD-8 R-42, R-21 Q-8

## Decision

- **API calls** use the merged typed client, `createApiClient({ baseUrl: "" })` from `@mealplanner/api-contract/client`, from client components (same-origin cookies). Errors are `ApiProblem`; the screens show `problem.detail` in plain language with a retry where a retry makes sense (UX-7).
- **Auth library calls** go to Better Auth **1.7.6**'s HTTP endpoints under `/api/auth` with plain `fetch` (one small typed module, `components/admin/auth-client.ts`), not `better-auth/client`: the endpoints and bodies below were checked in the installed package (`dist/api/routes/*.mjs`, `dist/plugins/{magic-link,two-factor}/*.mjs`), and a thin wrapper keeps the 1.4.1 route's replacements (`sign-up`, `change-password`, `two-factor/enable|disable` answer 404) out of reach.
  - `POST /api/auth/sign-in/email` `{ email, password, rememberMe }` → `{ twoFactorRedirect: true }` when two-step sign-in is on (then `POST /api/auth/two-factor/verify-totp` `{ code, trustDevice }`), else the session cookie.
  - `POST /api/auth/sign-in/magic-link` `{ email, callbackURL: "/signed-in" }`; the emailed link is `GET /api/auth/magic-link/verify?token=…&callbackURL=…`, whose redirect carries `passwordRemoved=1` (`PASSWORD_REMOVED.query`) when R-42 applied.
  - `POST /api/auth/request-password-reset` `{ email, redirectTo: "/reset-password" }`; the emailed link redirects to `/reset-password?token=…`; `POST /api/auth/reset-password` `{ newPassword, token }` (creates the credential when none exists; the library revokes sessions).
  - `GET /api/auth/list-accounts` (whether a `credential` account exists, SPEC-Q-5).
  - `POST /api/auth/sign-out`, preceded by `clearOfflineCache()` from `(shell)/_shell/offline-cache.ts` (R-21 Q-8).
- **Page guards**: server components under `(app)` and `(platform)` call `readSession` (1.4.1 `lib/auth/context.ts`) through `configuredRuntime()` and `redirect("/sign-in?next=…")` when there is none; data is then loaded client-side through the contract (one contract, ARC-5). Role checks are the API's (403 → an "admins only" state); the pages add no authorisation of their own.
- No API route is added (architect note). A missing endpoint is raised as `ARCHITECT QUESTION`.

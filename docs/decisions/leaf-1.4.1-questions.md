# leaf-1.4.1 spec questions

Each question records the reading taken (the more conservative one) and continues on it. Items marked **needs ruling** change files outside this leaf's OWNS or leave a spec requirement without an owner; they are also listed under "Requests" in the PR.

## SPEC-Q-1: writes go through `POST /change-sets`, not one write endpoint per resource

ARC-5 names the main resources (`households`, `members`, `targets`, `slots`, `schedules`, `weights`, `dishes`, `ingredients`, …); DM-6/AGT-6 make the op registry the only write path, and R2-ONB-4 needs several ops applied as one change set.

Reading: every named resource has read endpoints (`GET` list/detail). Configuration writes go through `POST /api/v1/change-sets` (`{ summary, ops: ChangeOp[] }`, admin only, validated by `ChangeOpSchema`) and `POST /api/v1/change-sets/preview` (rolled-back `previewChangeSet`, for forms and the onboarding review). Dedicated write endpoints exist only where the role matrix (ARC-6) or a workflow differs from "admin applies ops": member taste preferences (own member only), reviews, plan actions (`generate`, `alternatives`, `swap`, `lock`, `unlock`), plate override, proposals (`accept`, `reject`), `change-sets/:id/undo`, auth, invites, access, account, household lifecycle and platform. This keeps one validation path and no duplicate per-resource write code.

## SPEC-Q-2: which household a request acts on

`household_user` allows one user in several households; the spec does not say how a request picks one.

Reading: the request header `X-Household-Id` selects the household; without it, the user's single active membership is used; a user with several memberships and no header gets `409 household_ambiguous`. A header naming a household the user is not an active member of gets `404` (no existence leak).

## SPEC-Q-3: sign-up creates the user and the household together

ARC-6: "signing up creates a user and a household; the user becomes admin". Better Auth's own `/api/auth/sign-up/email` would create a user with no household.

Reading: the Better Auth catch-all route refuses `sign-up/*` (404). `POST /api/v1/signup` `{ email, password, name, householdName }` calls `auth.api.signUpEmail` server-side, then `createHousehold` (1.1.2), and returns the session. If household creation fails the user is deleted in the same request. Invite acceptance (SPEC-Q-4) is the only other way to get a login.

## SPEC-Q-4: invites (R2-ADM-2)

Reading:
- `invite.code` is 10 characters from a 31-symbol alphabet without look-alikes (no `0 O 1 I L`), from `crypto.randomInt`.
- Expiry options are exactly `24h | 7d | 30d` (default `7d`).
- Acceptance is the auth flow (R-24, DM-6 exception): one transaction runs `UPDATE invite SET used_at = now() WHERE code = $1 AND used_at IS NULL AND revoked_at IS NULL AND expires_at > now() RETURNING …`; zero rows → `410 invite_invalid` (single use holds under concurrency). It then inserts the `household_user` row with the invite's role and member. A new user signs up in the same request; an existing signed-in user joins.
- Resend creates a fresh code and revokes the old one; revoke sets `revoked_at`.
- The link is `${APP_URL}/invite/<code>`. The QR image is drawn by the UI (1.4.6) from that link; this leaf returns the link only.
- Email delivery uses the mailer (ADR-4). Without `EMAIL_SERVER`, `channel: "email"` returns `503 email_not_configured`; code, link and QR still work.

## SPEC-Q-5: block revokes sessions, and every request re-checks status (R2-ADM-4, G4)

Reading: `POST /access/:userId/block` applies `access.block` (a protected op: as a UI request by an admin it is applied directly; AGT-5 only turns *agent* requests into proposals) and then deletes every `session` row of that user, in the same request, before responding. Independently, every authenticated request resolves `household_user.status` and `user.platform_blocked_at` from the database (Better Auth cookie cache off), so even a session created between the two steps is refused with `401`. Sign-in is refused (Better Auth `databaseHooks.session.create.before`) when the user is platform-blocked or has no active (non-blocked) membership. Unblock restores sign-in; it does not restore sessions. "Sign out of all devices" (R2-ADM-3) uses the same session deletion without the block.

## SPEC-Q-6: TOTP "required for admins" (R2-ADM-5, G4)

Reading: when `household.require_totp_for_admins` is true, an admin whose `user.two_factor_enabled` is false gets `403 totp_required` on every `/api/v1` endpoint except `GET /me`, the account/two-factor setup endpoints and sign-out. Signing in with two-factor enabled requires the TOTP step (Better Auth `twoFactor` plugin); a session is not issued before it. Members and kitchen users are not affected.

## SPEC-Q-7: platform operator scope and the support-access log (R2-ADM-8, G5) — needs ruling (schema)

The mockup's households list shows name, admin count, login count, plans (30 d), AI calls (30 d) and status; the user search shows a user's roles, households and block state.

Reading:
- Those aggregates, account metadata (name, email, status), AI usage and cost, and failed jobs are **platform data**, served without a grant.
- Everything inside a household (members, targets, plans, recipes, reviews, preferences, proposals, conversations, change log, exports) is **household data**. It is served to an operator only through `/api/v1/platform/households/:id/support/*`, and only while an unexpired, unrevoked `support_grant` for that operator exists; otherwise `403 support_grant_required`.
- "Every support view is logged in that household's change log": a support view is not a mutation, so writing it as a `change_set` would create an entry with no ops and a meaningless Undo. Reading: each support read writes one row to a new table **`support_access`** (`id, household_id →, grant_id →, operator_user_id →, method, path, created_at`) in the same request, before the data is returned (if the log write fails, no data is returned). `GET /api/v1/change-sets` merges these rows into the log as entries of kind `support_view` whose undo is unavailable with the reason "a support view changes nothing". Requested: see the PR, request R-a.
- AI cost is computed from `ai_generation` token counts with a per-model price table in `apps/web/lib/server/platform/pricing.ts`, citing the rates of the `claude-api` skill at build time; an unknown model shows tokens with cost `null`.

## SPEC-Q-8: job and job-event storage (ARC-7 "job_event") — needs ruling (schema)

ARC-7 emits plan progress "to `job_event` (LISTEN/NOTIFY → SSE)", and R2-ADM-8 lists failed jobs, but 02 defines no job tables. pg-boss's own tables carry no household scope, so `GET /jobs/:id/events` could not enforce ARC-10's cross-household denial from them alone.

Reading: request two tables (R-9 procedure: one schema file and one new migration, granted to this leaf only):
- `job` — `id` (uuid, = the pg-boss job id), `household_id →?` (null for platform jobs such as `kg.nightly`), `kind`, `payload jsonb`, `status` (`queued | running | succeeded | failed | cancelled`), `error jsonb?`, `created_by_user_id →?`, `created_at`, `started_at?`, `finished_at?`.
- `job_event` — `job_id →`, `seq int`, `household_id →?`, `type text`, `payload jsonb`, `created_at`; PK `(job_id, seq)`.

The worker inserts each event and `pg_notify('job_event', '<job_id>:<seq>')` in one statement; the SSE route replays rows after `Last-Event-ID`, then streams notified rows. Both tables are household-scoped repositories for household jobs.

## SPEC-Q-9: `POST /conversations/:id/messages` (the agent's SSE stream) — needs ruling (ownership)

ARC-5 lists it; the agent loop is 1.3.5 (`packages/ai/src/agent/**`), which depends on this leaf, and no leaf's OWNS has the route. A route here with no agent would be a placeholder (anti-drift rule 4).

Reading: this leaf builds the conversation reads (`GET /conversations`, `POST /conversations`, `GET /conversations/:id`, `GET /conversations/:id/messages`), the SSE writer (`apps/web/lib/server/sse.ts`) and the chat rate limiter (30 turns/hour/household, env-configurable, `apps/web/lib/server/rate-limit.ts`). It does **not** build the `POST …/messages` route. Proposal: 1.3.5's OWNS gains `apps/web/app/api/v1/conversations/[id]/messages/route.ts` (POST only) and its contract/authorisation test file in `apps/web/test/api/`; G1's completeness check here enumerates the route files that exist, so it stays valid when 1.3.5 adds the route with its own test.

## SPEC-Q-10: `reviews.extract` has no AI module owner — needs ruling (ownership)

ARC-7's `reviews.extract` needs an LLM extraction module (structured output, effort low). No leaf owns `packages/ai/src/reviews/**`, and R-2 forbids building it in `apps/*` (apps wire; `ai` holds Claude calls).

Reading: not built here. Proposal: the architect assigns the extraction module (for example to 1.3.2 follow-up or 1.3.5); this leaf's worker then registers the queue with one line of wiring. Until then no `reviews.extract` job is enqueued.

## SPEC-Q-11: jobs registered by this leaf

Reading, each as a pg-boss queue in `apps/worker`, with a `job` row and events:
- `plan.generate` (API, agent): `loadPlanInput` → `planDays` → `buildCookSheet` → `plan.save_days`; `ai_generation = auto` awaits `requestDishes` (the 1.3.1 generator through its ports); `ask` turns each `generationRequests` entry into a proposal (SPEC-Q-13); `off` or no credential requests nothing (REC-2: the job's final event says generation was unavailable).
- `nutrition.recompute` (variant, ingredient or yield change; seed load; engine version change): recomputes `dish_nutrition_cache` and `needs_review`.
- `plates.resolve` (target, tolerance, slot, schedule change): re-solves the plates of future meals with dishes and locks kept, through `plan.swap_dish` with the meal's own dish (it replaces plates and batches, locked or not). Newly infeasible plates are listed in the job result for the agent (1.3.5) to propose swaps (PLN-13).
- `insights.run` (10 unprocessed reviews after a review is created, nightly at 02:00 household time for `insight_frequency = nightly`, Mondays 02:00 for `weekly`, on demand): `runInsights` with `synthesizeInsights` injected; `expireProposals` runs first. The `InsightDigest` is stored as the job result; posting it into a conversation is 1.3.5's.
- `kg.sync` / `kg.nightly`: `syncGraph` after dish, member and preference change sets and after the catalogue loader; `recomputeLibrary` nightly (1.3.4 PR #12 request 3).
- `recipe.revise` (W-2, SPEC-Q-14).
- `household.purge` (SPEC-Q-16).

The hourly scheduler (`0 * * * *`) enqueues the per-household 02:00 jobs by each household's `timezone`.

## SPEC-Q-12: actor and source of job-written change sets

`change_set.source` is `ui | agent_apply | proposal_accept | learning`. Reading: a job started by a user from the UI writes with `actor: user`, the starting user, `source: ui`; the agent (1.3.5) passes `agent_apply`; scheduled or triggered jobs (nightly insights, `kg.*`, `plates.resolve` after a change, AI survivors inside an automatic run) write with `actor: system`, `source: learning`.

## SPEC-Q-13: `ai_generation = ask` needs a proposal kind — needs ruling (op)

PLN-12 `ask`: "create a proposal 'Generate 3 new <slot> recipes because …'". A proposal's payload is ops from the registry (07 §4), and no op requests generation. W-2 has the same shape: `recipe.revise` must exist as an op whose effect is a job.

Reading: both ops apply by inserting a `job` row (`status: queued`, the op payload as job payload) through `ChangeTx`; the change-set commit is the durable request, the API/worker enqueues it after commit, and the inverse deletes the row (undo is refused by the change-set service once the job has run, because the job updates the row — a later change to the same entity). Ops requested:
- `recipe.generate` `{ date, slotKey, count, reason }` (not protected);
- `recipe.revise` `{ dishId, variantId, notes: string[] }` (not protected), and `RECIPE_REVISION_OP = "recipe.revise"`.

Files (outside OWNS): see the PR, requests R-b and R-c.

## SPEC-Q-14: what the `recipe.revise` job does (W-2)

Reading: the job calls `generateRecipes` with `count: 1` and an `adminRequest` holding the dish's current recipe and the notes ("revise the <variant label> variant of <component>: too oily, too salty"). From the surviving dish it takes the component with the same role and the variant with the same method key, and applies `dish.update` replacing only that variant's ingredients, steps and cook time (version bump, nutrition recompute, `plates.resolve` for future meals). No survivor or no matching variant → the job fails with the rejection reasons; the dish is unchanged. Seed dishes are copy-on-write (REC-7): the revision creates the household copy. Tested with recorded responses only (no credential; the live path is 1.3.1 G4's handoff).

## SPEC-Q-15: dish-generation rate limit (ARC-6: 60 dishes/day/household)

Reading: counted as dishes with `source = ai` created since the household's local midnight plus the dishes requested by the pending call; a request over the limit is not sent to the model and returns `RecipeGenerationError("disabled", "daily AI recipe limit reached")`, surfaced like missing credentials (REC-2: no silent failure). `AI_RECIPE_DAILY_LIMIT` and `CHAT_TURNS_PER_HOUR` override the defaults (requested for `.env.example`, R-f).

## SPEC-Q-16: household deletion (R2-ADM-6) — needs ruling (schema)

Reading: `POST /households/current/deletion` by an admin. With one active admin, the 14-day grace starts at once. With two or more, it waits for a second, different admin's `POST …/deletion/confirm`, and the grace starts then. Any admin's `DELETE …/deletion` cancels. `household.purge` runs daily and deletes every household-scoped row, logins and the household once the grace has passed. The schema has `deletion_requested_at` and `deletion_requested_by_user_id` but nowhere to record the second admin; requested: `household.deletion_confirmed_at`, `household.deletion_confirmed_by_user_id` in the same migration as SPEC-Q-7/8 (R-a). An operator's "delete" starts the same grace (it is cancellable by the household's admins) and requires the household to be suspended first.

These lifecycle fields are written directly, not as change sets: deletion is not an undoable configuration change, and its cancel path is the explicit `DELETE`.

## SPEC-Q-17: role projections (ARC-6)

Reading:
- `member`: own member's targets and plates; other members' plates only when `members_see_plates`; never other members' targets or tolerances.
- `kitchen`: plans and recipes, and plates only as the cook sheet's plating table; names only when `kitchen_sees_names`, else "Member 1…n" in a stable order.
- Reviews: admin any member; member for own linked member, or for a younger member when `members_review_for_siblings`; kitchen only tags from the Kitchen group (`ingredient_unavailable`, `recipe_unclear`, `quantity_wrong`), no rating or comment.
- Own taste preferences: admin and member (own linked member only), through `preference.set`/`preference.reset` for that member; kitchen none.

## SPEC-Q-18: data export (R2-ADM-6)

Reading: `GET /households/current/export?format=json` returns every household-scoped table's rows (auth secrets excluded: no session tokens, password hashes or TOTP secrets). `format=csv&table=<name>` returns one table as CSV (RFC 4180). No archive format, so no new dependency.

## SPEC-Q-19: ARC-12 and R2-UX-1 are not cited by this leaf's gates

ARC-12 (pino logs, admin diagnostics page) and R2-UX-1's "unavailable flag → substitution and re-solve" have no gate here and no owner in §4. Reading: not built (anti-drift rule 3). The platform console's failed-jobs list (R2-ADM-8) is built from the `job` table. Flagged for the architect.

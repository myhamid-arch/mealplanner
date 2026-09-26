# leaf-1.4.6 spec questions

Each question records the reading taken (the more conservative one) and continues on it. Items marked **needs ruling** touch files outside this leaf's OWNS; they are also listed under "Requests" in the PR.

## SPEC-Q-1: where Household settings lives — needs ruling (path)

`HouseholdSettings.dc.html` is in this leaf's G3, and is the "General" tab of Settings (tabs: General · Planning balance · Meals & schedule · Change log). `apps/web/app/(app)/settings/**` belongs to 1.4.3.

Reading: build it at `/settings/household` if the architect grants `apps/web/app/(app)/settings/household/**` (request R-a); otherwise at `/account/household` (inside OWNS), linked from the same tab strip. The Change log tab is `/changelog` (OWNS). The tab strip is drawn by `components/admin/settings-tabs.tsx` with the paths General `/settings/household`, Planning balance `/settings/planning`, Meals & schedule `/settings/schedule`, Change log `/changelog`; 1.4.3 is asked to use the same paths (or the architect gives the final ones at CP1).

## SPEC-Q-2: the rail marks Settings on `/changelog` — needs ruling (nav.ts)

Both `HouseholdSettings` and `ChangeLog` draw the rail with Settings active. `nav.ts` (1.4.2, merged, no owner now) marks Settings only under `/settings`. Reading: request R-c adds `alsoActiveFor: ["/changelog"]` to the settings item (one line). Without it the pages work; the rail just marks nothing on `/changelog`.

## SPEC-Q-3: diagnostics page (ARC-12, R-40)

Reading: `/account/diagnostics` (`apps/web/app/(app)/account/diagnostics/**`), admin only, reading `GET /api/v1/diagnostics`: the last 50 AI calls (purpose, model, input/output/cache-read tokens, stop reason, validation-error flag, time) and the household's failed jobs (kind, error, times). Linked from the Account screen for admins and from the change log header. No mockup exists; it uses the Change log page's card and table style.

## SPEC-Q-4: after a magic-link sign-in (R-42)

The verify redirect goes to the `callbackURL` the sign-in request names, with `passwordRemoved=1` appended when the password was removed. Reading: the sign-in page asks for the link with `callbackURL=/signed-in`. That page (`(auth)/signed-in`) shows "Your password was removed because you signed in by email link; set a new one in Account" with a button to `/account?passwordRemoved=1` when the flag is present, and otherwise forwards to the role's home (`homePathFor`, 1.4.2 `nav.ts`) or a safe same-origin `next`.

## SPEC-Q-5: setting a new password when the account has none (R-42)

`POST /api/v1/account/password` requires the current password, which a removed credential no longer has. Better Auth 1.7.6 `POST /api/auth/reset-password` creates the credential when none exists (verified in `dist/api/routes/password.mjs`). Reading: Account's Password row reads the linked accounts from the library's `GET /api/auth/list-accounts`; with a `credential` account it offers "Change" (current + new, the /api/v1 endpoint); without one it offers "Set a new password", which emails a reset link to the signed-in user (`POST /api/auth/request-password-reset`, `redirectTo=/reset-password`), and `/reset-password` sets it. No API route is added.

## SPEC-Q-6: "No password — email me a link each time" on InviteAccept

`POST /invites/accept` with `signup` requires a password (min 8). Reading: the button signs up with a random 32-byte password generated in the browser and never shown. The account then signs in by email link; on the first link the library removes that unused password (R-42), and the notice is suppressed for this case only when the invite-accept page set a local marker (`sessionStorage`) on this device; on another device the standard notice shows, which is accurate.

Alternative if the architect prefers: remove the button (the mockup shows it; R2-ADM-1 lists the email link as a sign-in method, not as a sign-up method).

## SPEC-Q-7: which household a multi-household user acts on

`requireHousehold` uses `X-Household-Id` or the single active membership (1.4.1 SPEC-Q-2). No mockup has a household switcher. Reading: no switcher is built; the client sends no `X-Household-Id`. A user in two households who signs in gets `409 household_ambiguous` from household endpoints; the screens show that problem's message. Out of this leaf's cited IDs to add a switcher.

## SPEC-Q-8: InviteDialog "Who are they at the table?"

Chips: every member without a login; "A new person"; "Doesn't eat here (staff)". Reading: a member chip sends `memberId`; staff sends `memberId: null`; "A new person" asks for a first name and applies `member.create` (untargeted, default appetite, a colour from the avatar palette) through `POST /change-sets`, then creates the invite bound to that member. "Give him a login" on a member without a login opens the dialog with that member selected.

## SPEC-Q-9: Household settings fields without storage

- "Default precision" (P ±5 / C ±5 / F ±2 / kcal ±50): the household has `default_precision` (strict | flexible) only; the numbers are per member (`tolerance`). Reading: the section edits `defaultPrecision` (strict / flexible) and shows the default numbers read-only, with kcal labelled per day (R-28); per-member values stay on the family profile (1.4.3).
- "Saturated fat cap when not set": the mockup's "10 %" predates R-28 (6 %). Reading: a number input for `satFatDefaultPct` (0 < x ≤ 100), no "None" option (the schema has no null).
- "New recipes when the library runs short" (auto / ask / never) is `planning_weights.ai_generation`, written with `weights.set`; the other fields with `household.update`. One save applies one change set with both ops.
- "Units": metric only in v1; shown disabled.

## SPEC-Q-10: support access grants (R2-ADM-8)

"Operators can't see a household's data unless one of that household's admins grants time-limited access from their Settings." No mockup section. Reading: Household settings gets a "Support access" section (operator email, hours 1–168, list with Revoke) using the `support-grants` endpoints.

## SPEC-Q-11: change-log filters and details (R2-ADM-7)

The API filters by `area` (household, members, targets, schedule, planning, taste, recipes, plans, access, support). Reading: chips All · People & access (`access`) · Targets (`targets`) · Recipes (`recipes`) · Plans (`plans`) as in the mockup, filtered by the API; "Learned automatically" filters the latest 200 entries by `source = learning` in the client. Actor badges: `user` → the login's name (from `GET /access`); `agent_apply` → "Assistant · you asked"; `proposal_accept` → "Proposal accepted by <name>"; `learning` → "Learned automatically"; support views → "Support view by <operator email>". The entry shows the change set's summary; the mockup's before → after chips are not in the API (no stored descriptions), so they are not drawn (listed as a deviation).

## SPEC-Q-12: platform console scope

R2-ADM-8 lists households, user search with platform block, AI usage and cost, failed jobs. Reading: tabs Households · Users · AI usage · System (failed jobs). The mockup's "Catalogue" tab is not in R2-ADM-8 and has no endpoint: not built. The stat "Active logins (7 days)" has no endpoint: shown as "Logins" (sum over households). "Details" opens the support views only while a grant exists (the API answers `403 support_grant_required` otherwise, shown as such).

## SPEC-Q-13: sign-in destination

Reading: after sign-in, `GET /me` decides: a platform operator with no membership → `/platform`; otherwise the role's home (`/kitchen` for kitchen, `/today` otherwise), or a same-origin `next` path. "Keep me signed in on this device" maps to Better Auth `rememberMe`.

## SPEC-Q-14: invite code format

`invite.code` is 10 characters (1.4.1 SPEC-Q-4); the mockups show `KHL-7Q4-M2P`. Reading: codes are displayed in groups `XXX-XXX-XXXX`; input accepts any case and dashes/spaces, normalised before lookup. The invite link is the API's `link` (`${APP_URL}/invite/<code>`), so the accept page is `(auth)/invite/[code]`.

## SPEC-Q-15: notification preference keys

R2-ADM-5 names notification preferences; the API stores free keys. Reading: two keys, from the mockup: `meal_rating_reminder` ("After-meal rating reminder") and `assistant_proposals` ("New proposals from the assistant", admins only), default on when absent.

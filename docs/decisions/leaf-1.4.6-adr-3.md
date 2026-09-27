# leaf-1.4.6 ADR-3: how G1 and G2 are verified

Status: accepted at CP1 (R-45, R-48; `@axe-core/playwright` 4.13.0 applied)
Requirement: BLD-5 1.4.6 G1, G2; BLD-8 W-1

`scripts/verify/leaf-1.4.6.mjs --gate G1|G2` imports only `scripts/verify/lib/*` and prints `VERIFY leaf-1.4.6 <gate> PASSED` only after every assertion, the negative controls included, holds. Gates run concurrently without sharing anything:

- **Database**: `DATABASE_URL` when set, else `postgres://postgres:postgres@localhost:5432/postgres` when it answers, else a throwaway PostgreSQL 16 cluster on a free port (same procedure as leaf-1.4.1's script). Each gate creates its own database `leaf146_<gate>_<random>` and drops it afterwards; `migrateAndSeed` (`@mealplanner/db` seed) migrates and loads the catalogue.
- **Mail**: a minimal SMTP receiver inside the verify script on a free port (`EMAIL_SERVER=smtp://127.0.0.1:<port>`, `EMAIL_FROM`), storing each message as JSON in the gate's own temp directory. This is the "magic-link stub": the real Better Auth flow sends through nodemailer, only the transport is local. The spec reads links from that directory.
- **Web**: `next build` into the gate's own `distDir` (`MISE_NEXT_DIST_DIR=.next/verify-1.4.6-<gate>`, as 1.4.2 ADR-4), then `next start` on a free port with `APP_URL`, `AUTH_SECRET` (random per run, never printed), `DATABASE_URL` and the mail variables.
- **Browser**: Playwright 1.63.0 with `PLAYWRIGHT_CHROMIUM_EXECUTABLE`, else `/opt/pw-browsers/chromium`, else Playwright's own; `apps/web/e2e/admin.spec.ts` with `--grep @G1` / `@G2`, reusing the running server (`PLAYWRIGHT_SKIP_BUILD=1`, the port passed in). Output goes to the gate's temp dir.

## G1 (Playwright, `@G1`), at 1280 × 800 (and the sign-in and invite flows also at 390 × 844)
1. Create a household (`/create-household`); the admin lands on onboarding.
2. Password sign-out and sign-in; sign-out calls `clearOfflineCache()` (the `mise-pages-*` caches are gone afterwards).
3. Invite → accept: the admin creates a member invite (link + QR); a new browser context opens the link, signs up, and lands in the household; People & access shows the login as active.
4. Invite-code sign-in: a second invite's code typed into "Got an invite code?" on `/sign-in` → the accept page for that invite → join.
5. Magic link: request a link on `/sign-in`, read it from the SMTP stub, open it → signed in. For an account whose email was unverified the password is removed (R-42): the notice text is shown, and Account offers "Set a new password", which completes through the emailed reset link; password sign-in then works.
6. Block → 401: the admin blocks a login in the Block dialog (optional reason); that login's still-open context gets `401` on its next `/api/v1/me` request and its next page load goes to `/sign-in`; its password sign-in is refused. Unblock restores sign-in.
7. Remove: remove a login (with "archive member"); it leaves the list; the member is archived; the removed user's session gets `401`.
8. Last-admin protection: the only admin's own role select and actions are disabled with the explanation; the same demote/block/remove requests sent directly answer `409`.
9. Change-log undo: the block from step 6 appears with the actor badge; Undo reverts it (the login is active again); an entry touched by a later change shows Undo disabled with the reason.
10. Negative controls (same assertion helpers, known-bad inputs, each must fail): `expectUnauthorized` on a session that was not blocked; `expectPasswordRemovedNotice` on a magic-link sign-in of a verified account; `expectUndoRestored` against a change set that was not undone.

## G2 (axe-core, `@G2`)
1. `@axe-core/playwright` (requested, R-e) with tags `wcag2a, wcag2aa, wcag21a, wcag21aa`: no `serious` or `critical` violation on every screen of this leaf — sign-in (with the TOTP step), create household, invite accept, reset password, signed-in notice, account, diagnostics, people & access, invite dialog, block dialog, actions menu, household settings, change log, platform console (each tab) — at 390 × 844 and 1280 × 800, light and dark.
2. Negative control: the same scan on a page with an injected `<button>` without a name and a `#B8A791`-on-`#FFF8EE` text must report a serious or critical violation.
3. W-1: runs `apps/web/e2e/shell.spec.ts` (`@G2`) against its own `next start` without `DATABASE_URL`, as 1.4.2 G2 does; on failure the full Playwright output is printed, not a tail.

## As built (CP2)

- **Rate limits.** Better Auth 1.7.6 limits each `/sign-in/*` path to 3 requests per client address, and the count resets only after 10 s without a request to that path (`decideConsume` in its rate limiter). The spec waits for a free slot before each password or email-link sign-in (`authSlot`) instead of meeting a 429; the server is unchanged.
- **Shared state.** Playwright restarts its worker after a failed test. The G2 set-up's results (run id, admin and operator sessions, the open invite code) and the rate-limit counts are kept in a JSON file next to the gate's mail directory, so one failing screen does not cascade into the others.
- **G2 flows.** Each flow opens a page once and scans every state it passes through (for example People & access → actions menu → block dialog → invite dialog → invite ready), in light and then dark (`emulateMedia`, after finite colour transitions finish). Diagnostics and the console are scanned with seeded rows (one AI call that hit `max_tokens`, one failed plan job). The scan also fails a page wider than the viewport (`horizontal-scroll`, UX-1); the negative control checks that too.
- **W-1** runs concurrently with the G2 e2e, on its own port and without a database; on any failure the script prints the full Playwright output and every `error-context.md`.
- **Timing** (this container, warm build): G1 40 s, G2 84 s; a cold `next build` adds about 20 s. The architect granted `--timeout 600` for this ledger, with G2's full scan set kept (PR #15, CP2).

# root-verify: spec questions (R-80)

Each question records the conservative reading the leaf follows until the architect rules.

## SPEC-Q-1: F1 is built through the running stack's API, not by SQL

R-80 allows a direct SQL load only for SC-1/SC-2's F1 if the API cannot express it. The API can:

- `POST /api/v1/signup` creates the admin login and the household (the same `createHousehold` that
  `loadFixture` calls);
- `GET /api/v1/slots` gives the default slots' ids;
- `POST /api/v1/change-sets` applies the ops `loadFixture` builds from `F1` (members, targets,
  tolerances, training, slot activation, schedules, cuisine preferences, the sesame exclusion,
  `access.link_member` for the admin);
- the other F1 logins (Adult B, C1, kitchen) join through `POST /api/v1/invites` (bound to their
  role and member) and `POST /api/v1/invites/accept` with a signup.

Every gate therefore builds F1 the same way, and after the set-up the stored configuration
(`loadHouseholdConfig`, read from the stack's database) is checked against `F1` field by field.

## SPEC-Q-2: SC-2's 20 runs share one stack, one F1 household per run

node-1.2 N3 copies a template database per run. A root gate has one fresh `docker compose up`, so
each (seed, economy) run gets its own API-built F1 household in that stack's database. Plans do
not depend on surrogate ids (W-17, R-73) and every planner read is household-scoped. As a check on
that reading, a 21st household repeats seed 1 at economy 0.4 and must persist the same plan
(dish slug and plate grams per meal and member) as the first.

## SPEC-Q-3: what "clean worktree" means for R1's cache

A pass is cached only when, before and after the node run, `git status --porcelain` shows no
untracked (non-ignored) file and every tracked change is in `docs/build/GATES.md` or
`docs/build/gates/*.md` and touches only `EVIDENCE:` lines or a gate's `[ ]`/`[x]` box (what
`gate-check` itself writes). Anything else, staged or not, makes the tree dirty: the run still
happens but its pass is not cached.

## SPEC-Q-4: SC-6's exact count

SC-6 asks for "at most 5 questions … counting required inputs". The gate asserts exactly what the
product asks: 5 question screens before the review, both when every question is answered and when
every question is skipped, with 0 required answers in both runs (R2-ONB-2: every question can be
skipped; leaf-1.4.3's `sc6Problems` counts a question as required when it has a required input or
offers no Skip), and a first plan after both. Measured on a compose stack while building the gate:
5 screens and 0 required answers, answered and skipped.

## SPEC-Q-5: SC-5 follows node-1.4's flow in a root spec

`apps/web/e2e/node-1.4/sc5.e2e.ts` exports nothing, and its `beforeAll` migrates its own database
and starts its own app and worker, so it cannot be pointed at a compose stack. The root spec
(`apps/web/e2e/root/sc5.e2e.ts`) takes the same steps with the same selectors, answers and
assertions, imports the recorded model and recordings from `apps/web/test/node/`, and keeps the
same axe filter (serious or critical, WCAG 2 A/AA, light and dark). The alternative, a request to
move the flow into an exported module that both specs import, is Request R-1 in the PR.

## SPEC-Q-6: the images' base in a proxied build environment

The images are built from the repo's Dockerfiles by `docker compose build`. Where the build must go
through an HTTPS proxy (`HTTPS_PROXY` set), root.mjs builds a local base image from the same
`node:22.22-bookworm-slim` (pulled from Docker Hub, else `mirror.gcr.io`) with the proxy's CA
added and pnpm 10.33.0 seeded into corepack's cache, and passes it to the build as the
`node:22.22-bookworm-slim` context (`additional_contexts` in a generated compose override), with
the proxy as build arguments only (Docker's predefined proxy args, not kept in the image) and the
host network for the build. Without `HTTPS_PROXY` nothing is substituted.

## SPEC-Q-7: where R1's cache lives

`node_modules/.cache/mealplanner-root-verify/r1.json` (git-ignored, survives a reboot). An entry
records the node, the tree (`git rev-parse HEAD^{tree}`), the exact gate-check command and its
exit code; only an entry with the current tree and the same command is reused.

## SPEC-Q-8: node N4 and the root Playwright config (answered: R-86)

Node N4 (`scripts/verify/lib/node.mjs` `runE2ESuite`) requires every `playwright.config.ts` under
apps/web to be one it runs; `e2e/root/playwright.config.ts` failed node-1.1 N4 in R1 on
2026-09-30 ("every Playwright config of apps/web is run"), since its tests need the compose stack
a root gate starts. A rename past N4's finder was tried and withdrawn. R-86: one entry in
`node.mjs`'s known configs names exactly `e2e/root/playwright.config.ts` as run by the root gates
R6–R8, not by N4; the rule is unchanged, and a stray `playwright.config.ts` anywhere else under
apps/web still fails it (negative control shown in the PR).

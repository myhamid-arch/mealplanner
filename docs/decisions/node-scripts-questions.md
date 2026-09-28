# Node verify scripts (R-69): questions and requests

Raised at CP1 of the node-scripts builder. Each entry names the conservative reading the scripts follow until the architect rules.

## SPEC-Q-1: what N4's "web e2e suite" runs

§6 N4 lists "the web e2e suite". No single command runs it today:

- `pnpm --filter @mealplanner/web test:e2e` (`playwright test`) runs `apps/web/e2e/*.spec.ts` with none of the environment the specs need. Only `shell.spec.ts` can pass without a database, a worker, `AUTH_SECRET`, the chat agent stub (`e2e/chat/agent-stub.mjs`), `WORLD_FILE`, the SMTP stub and `MAIL_DIR` (admin), or the graph rebuild (plan G3, 1.4.8 G5).
- `apps/web/test/chat/updates.e2e.ts` has its own config and lies outside `testDir`.
- CI runs no Playwright.

Each spec is written to run one gate tag at a time (`--grep @Gn`), each with its own fresh world.

**Reading used.** `lib/node.mjs` runs every Playwright spec file of `apps/web` once per tag group. It uses the environment its leaf scripts give that tag: a fresh database, the built app (its own dist directory and port), the worker, and the stubs the tag needs. It covers:

- `e2e/*.spec.ts`: every `@…` tag found in the file;
- `test/chat/updates.e2e.ts`: its own config;
- the node-1.4 specs: their own config.

It takes the counts from each run's JSON report. It fails when:

- any test fails or is skipped;
- any test in a spec file is left outside every tag group, so an untagged test is never silently not run.

It does not run the leaves' non-e2e assertions; N1 reruns those.

**Alternative.** N4 calls the e2e-owning leaves' own gates (1.4.2 G1/G2, 1.4.3 G1–G3/G5, 1.4.4 G1–G3, 1.4.5 G1–G3, 1.4.6 G1/G2, 1.4.7 G1/G4, 1.4.8 G1/G3–G5, 1.4.9 G4). That reuses their harnesses exactly, but it repeats most of N1 and roughly triples N4's time.

## SPEC-Q-2: N4 is the same for all four nodes

§6 defines N4 identically for every node: "the full suite on the integration tree". Each `node-1.<n>.mjs --gate N4` runs it in full, with no shared result cache, because a cache would be a shared temp file. Running the four N4 gates at the same time therefore runs the full suite four times over. The package builds and `next build` are serialised by the existing cross-process locks. Everything else runs in parallel on its own databases, ports and dist directories.

## SPEC-Q-3: how an F1 admin signs in over HTTP

`loadFixture` (`packages/db/src/services/config/fixtures.ts`) creates F1's users without a credential account, so no F1 login can sign in to the built app.

**Reading used.** The N3 setup (in `packages/db/test/node/**` / `apps/web/test/node/**`) gives F1's admin a password through Better Auth's own API on an in-process runtime (`createRuntime`) for the gate's database. The built app is then reached with the token from `POST /api/auth/sign-in/email`. No production code changes.

## SPEC-Q-4: "every touched table equals its pre-apply snapshot"

Applying a change set through the API also writes rows that are not part of the change and that undo does not restore by design:

- the `change_set` log itself;
- follow-up `job` rows (`afterChangeSet`);
- the pg-boss schema;
- Better Auth `session` rows.

**Reading used.** The comparison covers every public table except `change_set`, `job`, and the auth tables (`session`, `account`, `verification`, `user`). The script asserts that none of the excluded tables is among the tables the change set's own before-images name. The excluded list is printed with the result.

## SPEC-Q-5: SC-2 through the job path, one database per run

The planner's repeat gaps and economy window look back at earlier plan days. Twenty plans (seeds 1–10 × economy weight 0.4 and 0) in one household would therefore influence each other.

**Reading used.**

- Each run uses its own copy of the F1-seeded database (`CREATE DATABASE … TEMPLATE`), with its own worker process.
- The economy weight is set by a `weights.set` change set through the API before `POST /plans/generate` with the seed.
- Distinct core ingredients are counted from the persisted plates with 1.2.3's definition: category ≠ `herb_spice`, slug ≠ `water`, over every plate item and adjuster of the week.

## SPEC-Q-6: "recorded model responses"

1.3.5, 1.3.6 and 1.4.9 use scripted, hand-written model responses. None of them captures a live transcript.

**Reading used.** The node N3 gates do the same:

- A local HTTP server answers the Messages API from response files under `apps/web/test/node/recorded/**`:
  - streamed SSE for the agent (`beta.messages.stream`);
  - JSON for the worker's structured calls.
- The built web app and the worker reach it through `ANTHROPIC_BASE_URL` and a placeholder `ANTHROPIC_AUTH_TOKEN`. The model code paths are therefore the production ones, not the `agent-stub.mjs` preload.
- The server fails the gate on any request it has no recording for.
- No `ANTHROPIC_API_KEY` is passed to any child process.

## Requests

- **R-1 (none blocking).**
  - The node tests use file suffixes that the default `vitest` include and Playwright `testMatch` do not collect: `*.node.ts` for vitest and `*.e2e.ts` for Playwright.
  - Each directory has its own config inside OWNS (`packages/db/test/node/vitest.config.ts`, `apps/web/test/node/vitest.config.ts`, `apps/web/e2e/node-1.4/playwright.config.ts`).
  - As a result, `test:unit`, `test:integration`, CI and the default Playwright run do not pick them up. They need a running app and worker, which only the node scripts provide.
  - No test config outside OWNS changes. If the architect wants them in the default suites, that is a request against 1.1.1's manifests.
- **R-2.**
  - No `package.json` script is added.
  - The ledgers call the scripts directly.

## Rulings at CP1 (R-70)

- SPEC-Q-1: the reading above. At CP2, every e2e spec file is listed with the run that covers it. A spec file that no run covers fails N4.
- SPEC-Q-2 … 6: accepted as recorded. SPEC-Q-4 keeps the assertion that the change set touched no excluded table.
- Amendment 1: change-log titles are not pinned. Entries are found by id, source and actor.
- Amendment 2: node-1.2 SC-1 also compares the stored per-plate totals with the recomputed ones, and reports the largest difference.
- Amendment 3: each gate's elapsed time is its last `ok` line.

## Raised while building

### SPEC-Q-7: tables a chat turn writes besides its change set (node-1.3 SC-4)

An agent turn writes rows that its change set does not own:

- `conversation`, `chat_message` (AGT-8 history);
- `ai_generation` (the DM-7 model-call audit).

Undo does not restore them, so they are left out of SC-4's equality, just as SPEC-Q-4 leaves out the request's bookkeeping.

**Reading used.** The exclusion is shown by evidence, not assumed. The test:

1. snapshots every table except SPEC-Q-4's around the turn;
2. takes the tables the turn changed outside its change set's before-images;
3. requires them to be a subset of those three tables;
4. requires the change set's own images to name none of them.

### SPEC-Q-8: the login's last-activity write (node-1.1 N3, HTTP path)

Every authenticated request records the login's `household_user.last_active_at`, at most once every 5 minutes (R2-ADM-3).

The first API call after sign-in therefore changes that row. It is not part of the change set.

**Reading used.** The HTTP test makes one authenticated request before the "before" snapshot, which takes that write out of the window. The comparison stays full-row. If a run ever took longer than 5 minutes, it would fail, never pass wrongly.

### Plan changes against the CP1 text

- **node-1.3's "one 1★ review gives no proposal".**
  - It runs on the same household, before the second review, not in a template clone.
  - The dislike rule reads every review in its window (`reviewsWithin`), not only unprocessed ones, so the order gives the same check without a second worker.
- **node-1.2 SC-1.** The run for seed 1 at economy 0.4 is also the SC-2 run for that seed and weight. The two share the same inputs, so there are 20 plan jobs, not 21.
- **Onboarding parse recordings.** These may answer any number of requests (`repeat`). The page sends the parse 800 ms after typing stops, so the count depends on timing. The spec requires at least one parse request answered and no request left unanswered.

## Requests (added)

- **R-3 (blocks node-1.4 N3; ARCHITECT QUESTION on the PR).** A single-entry edit in `apps/web/components/config/onboarding/questions.tsx:90`.
  - The "Read as" chip row is `<div aria-live="polite" aria-label="Read as">` with no role. While it is empty (question 1 before anything is typed), axe reports `aria-prohibited-attr` as serious.
  - The fix is `role="group"` or no `aria-label`.
  - 1.4.3's G2 scans question 1 only after it is filled, so it does not see this.

## Pre-CP2 findings (architect, on 0b3e881) and what changed

1. **OQ-8 constants.** The checker hard-codes the owner's gaps: day difference ≥ 7 for main meals, ≥ 4 for snack and workout slots, and the larger gap of the pair. Boundary controls check that a main pair at 6 days and a short pair at 3 fail, and 7 and 4 pass.
2. **Relaxed repeats.** A repeat inside the gap passes only when the later meal's relaxation is persisted as a `frequency_relaxed` flag with a reason (date, slot, scope). A control marks every meal relaxed with no flag and must fail; the same marks with backing flags pass.
   - This finding surfaced a defect in my test. The job's flags were read from `payload.result`, but the `done` event's payload is the result itself, so every run's flags read as empty. The flags are now read from the payload, and the test fails when a job result carries no flags list.
3. **Independent nutrition.** Per-100 g values come by SQL from `dish_nutrition_cache`, not through `loadPlanPool`.
   - The cache is written by the catalogue loader's nutrition recompute and stores values to 0.001.
   - Every comparison therefore allows exactly the rounding bound, Σ cooked g × 0.0005 / 100 per plate, accumulated over the member-day for the R-28 window. Measured on the merged head: largest difference 0.0028 g, 0 plates beyond the bound.
   - A planner that scales its per-100 g values by 1.1 breaks the stored-total check by orders of magnitude more than that bound.
4. **Axe control.** The known-bad page goes through the same helper as every real check. It has only serious findings (empty link name, low contrast), so narrowing the helper to critical-only makes the control fail.
5. **Onboarding.** The spec asserts that "See what I worked out" after question 5 lands on the summary, and counts exactly 5 distinct question screens. The "six questions" re-check is removed.
6. **SC-3.** "Before" is measured before the first review. At least one other member must be on the meal.
7. **get_preferences.** The tool result sent to the model must carry the dish and `-0.8`.
8. **SC-4 control (node-1.3).** The difference must be `member` rows only.
9. **Cook sheets.**
   - node-1.2 requires ingredient lines > 0.
   - node-1.4 finds the shared dinner's card by its own heading. The card must show the batch as the API plans it ("makes N g").
10. **N2 builds the branch packages on every run.** Each is compiled with its own tsconfig into a private directory. The declarations it emits must equal the published ones in `dist/`, which is rebuilt under the build lock only when they differ.
11. **Flags need a reason.** A flag without a reason no longer excuses a missing plate or a miss.
12. **Change-log text.** The change-log entry is found by `data-testid="log-<id>"` and its source, not by badge or title text.
13. **Contract tests.** N2's api-contract contract tests are apps/web's `g1-contract-matrix` and `g3-openapi` suites, because `packages/api-contract` has no tests of its own. This is stated in each node script's header and here. The ledgers' lines are the architect's.

## Raised during the final rounds

- **R-4 (ARCHITECT QUESTION): the `kg-startup` open-tx witness in 1.4.10 is racy.**
  - node-1.4 N4 failed once, on cf6b357, at `apps/web/test/api/kg-startup.int.test.ts:298` (`seen.lockWait`).
  - `openTx` hooks only the catalogue job, so the dish job can end its attempt before the catalogue nodes are written. When that happens, no lock wait ever occurs.
  - Run alone, the test failed 1 of 8 times. With the proposed hook change, `-t "open-tx"` passed 16 of 16.
  - The architect landed the fix on the base as W-18 (c459df5). It is not an edit on this branch.
- **`e2e/plan.spec.ts:612` ECONNRESET: one occurrence, no root cause.**
  - node-1.2 N4 failed once, on cbbcfe8. The GET at `:479` got `read ECONNRESET` from the built app.
  - A keep-alive race was suspected: `next start` keeps Node's 5000 ms `keepAliveTimeout`, and the test died 6.0 s in. It did not reproduce. With a Playwright request context and a second GET at gaps of 4950–5050 ms, 0 of 21 requests were reset without the header, and 0 of 21 with `Connection: close`.
  - The run kept no web-server output. The e2e runs now set `DEBUG=pw:webserver`, so a recurrence shows what the server did.
  - It has not recurred in the six complete N4 runs since. The last four of them kept the server log.
- **Suite summary lines** now state the requirement ("required: all passed, none skipped"). A failing suite used to print "…, none failed or skipped".

**Observation, not a gate issue.** Three node-1.2 runs of the same F1 week at seed 1, on the same catalogue, persisted different plans: 10, 13 and 14 same-dish pairs. One of them relaxed a breakfast repeat to 6 days. Plan generation through the job is not reproducible run to run. N3 judges each run on its own terms.

The architect attributes this to W-17, the plan's dependence on surrogate ids, which leaf 1.2.7 fixed (merged at 1361b96). I have not re-measured reproducibility since then.

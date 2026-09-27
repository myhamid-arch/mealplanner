# ADR-1 (node scripts, R-69): how the node gates run

## Status

Accepted by the builder at CP2. The architect reviews it at CP3.

## Decisions

### 1. One shared library

`scripts/verify/lib/node.mjs` holds everything the four node scripts share:

- locks and builds;
- PostgreSQL acquisition;
- processes;
- the vitest and Playwright runners;
- N2 and N4.

Each `node-1.<n>.mjs` holds its node's N2 negative control and its N3.

### 2. Locks and builds

**Package builds.**

- These use the leaf scripts' lock names (`packages-build`, `web-next-build`, hashed on the repository path). A node gate and a leaf gate therefore never build the same `dist/` at once.
- N2 and N3 build only when a source is newer than its `dist/`.

**N4's build step.** It compiles every package and the worker into a private temporary directory (`tsc -p tsconfig.json --outDir <tmp>`), and runs `next build` into the gate's own directory with `DATABASE_URL` cleared (R-50).

- A forced rebuild of the shared `dist/` would rewrite files that concurrent gates are importing.

**N4's typecheck step.** It runs each package's own `typecheck` script plus `tsc -p scripts`.

- It does not use `turbo run typecheck`. That task depends on `^build`, and turbo's cache can replay an earlier success.

### 3. Databases

- Every N3 and every N4 e2e run creates its own database on the acquired server, with a random name, and drops it in `finally`.
- node-1.2 clones its seeded database once per plan run with `CREATE DATABASE … TEMPLATE` (SPEC-Q-5).

### 4. The N3 tests stay out of the default suites

- The N3 tests are `*.node.ts` under `packages/db/test/node/` and `apps/web/test/node/`, each directory with its own `vitest.config.ts`.
- The SC-5 spec is `apps/web/e2e/node-1.4/sc5.e2e.ts`, with its own `playwright.config.ts`.
- None matches the default vitest `include` or Playwright `testMatch`.
- `test:unit`, `test:integration` and CI therefore do not collect them. They need processes that only the node scripts start.
- N4's e2e suite runs the node-1.4 spec as one of its runs, through its own config.

### 5. Recorded model

`apps/web/test/node/recorded-model.ts` is a local Messages API server (SPEC-Q-6):

- It answers the agent's streamed requests with server-sent events and structured requests with JSON.
- The responses come from `apps/web/test/node/recorded/*.json`.
- Each recording states what its request must contain.
- An unmatched request is answered 500 and recorded as a failure, which the tests assert is empty.
- The web app and the worker reach it through `ANTHROPIC_BASE_URL` with a placeholder `ANTHROPIC_AUTH_TOKEN`.
- No `ANTHROPIC_API_KEY` reaches any child: `CHILD_ENV` clears it, and the test support removes it from every child's environment.

### 6. The e2e harness (SPEC-Q-1)

- **Default config.** Each spec file of the default config runs once per tag group (the leading `@…` of each test title), with `--grep` anchored on the tag.
- **Tag environment.** Each tag gets the environment its leaf script gave it:
  - shell: no database;
  - config, plan and setup: a seeded database, plus the worker except for config `@G3`, plus the graph rebuild for plan `@G3` and `@1.4.8-G5`;
  - chat: seeded database, worker, the scripted agent preload, `WORLD_FILE`, and the no-model server;
  - admin: a migrated database and an SMTP sink writing `MAIL_DIR`.
- **Own configs.** `test/chat/playwright.config.ts` and `e2e/node-1.4/playwright.config.ts` each run whole.
- **Coverage.** Coverage is computed, not listed by hand:
  - every `playwright.config.ts` under `apps/web` must be known;
  - every file the default config collects must be one of the runs;
  - every test must have a tag;
  - every listed test must appear, passed, in its run's JSON report.
- **The SMTP sink.** It is a copy of leaf 1.4.6's (that script runs its gates when imported, so it cannot be imported).

### 7. Output

Every gate writes its full output to a temp log as well, because gate-check keeps a bounded transcript. It prints its elapsed time as its last `ok` line (R-70).

### 8. Sharing the machine (added while gathering evidence)

Twelve gates run at once used all 16 GB of this container and stalled it. The heavy steps now take machine-wide slots: lock directories named like the build locks, and a dead holder's slot is taken over.

| Slot      | Default              | What holds it                                                                                          |
| --------- | -------------------- | ------------------------------------------------------------------------------------------------------ |
| `suite`   | 1                    | N2's consumer typechecks and contract tests; N4's format, lint, typecheck, build, unit and integration |
| `copy`    | 2                    | Every disposable workspace copy (install, build, the control's run)                                    |
| `e2e-run` | 2 (`NODE_E2E_SLOTS`) | Every Playwright run of any gate                                                                       |

Within one N4, the e2e runs go one at a time (`NODE_E2E_JOBS`, default 1). With two in parallel on this 4-core container, `chat.spec.ts @G1` missed its 5-second wait for a job card once. That is the timing of 1.4.5's spec, not a defect the node gate should hide.

Measured on this container, one gate at a time:

- N4 takes about 25 minutes with two e2e runs in parallel. The e2e runs alone add up to 1749 s sequentially.
- The suite part (format through integration) takes about 8 minutes.

### 9. Heap size

This environment sets `NODE_OPTIONS=--max-old-space-size=8192`. `eslint .` needs more than the default heap: it ran out of memory at 2 GB.

Children therefore keep the caller's `--max-old-space-size` and nothing else from `NODE_OPTIONS`, so no preload is inherited.

# leaf-1.1.1 spec questions

## SPEC-Q-1 (blocks G1 and G2): no compile root is inside any OWNS
G1 needs `pnpm -r build` to succeed and G2 needs `pnpm typecheck` to pass. 1.1.1 OWNS only manifests and tsconfigs; every source path is owned by later leaves (or nobody). Measured in this session:
- `tsc -p tsconfig.json` on a package with `include: ["src"]` and no files: `error TS18003: No inputs were found`, exit 2. With `files: []`: `error TS18002`, exit 2.
- `next build` (next@16.3.6) with no `app/` or `pages/`: `Couldn't find any 'pages' or 'app' directory`, exit 1.

Options:
- **A (recommended).** Add to 1.1.1 OWNS the package entry barrels `packages/{core,db,ai,graph,api-contract,ui-tokens}/src/index.ts` (each `export {};`, nobody else owns them) plus the minimal compile roots `apps/worker/src/main.ts` and `apps/web/app/layout.tsx` + `apps/web/app/page.tsx`, with the note that 1.4.1 / 1.4.2 replace the app files. The worker/web files overlap later OWNS, so the architect must decide the hand-over.
- **B.** 1.1.1 creates no `build`/`typecheck` script in a package until that package has source, and the architect adds scripts when merging later leaves. G1/G2 then pass vacuously on a workspace with no buildable package; I consider that a weakened gate.
- **C.** Defer G1/G2 of 1.1.1 to node-1.1.

Conservative reading while waiting: none of the above is done without architect approval, because A writes outside OWNS and B weakens the gates.

## SPEC-Q-2: ARC-3 edge set
ARC-3 says db, graph and ai "may depend on core" and apps depend on packages. I enforce this as the exhaustive allow-list (ADR-3), which forbids `ai → db` and `graph → db`. AGT-1 step 3 says agent write tools "run through the change-set service" (packages/db); under the strict matrix the agent must receive that service by injection from the app. `api-contract → core` is allowed (not stated either way); `ui-tokens` imports nothing internal. Confirm or widen.

## SPEC-Q-3: OWNS overlap
`packages/ui-tokens/**` (1.4.2) and `packages/graph/**` (1.3.4) include their `package.json` and `tsconfig.json`, which 1.1.1 also owns via `packages/*/package.json`. I will create both manifests now (ARC-1 deps must be declared up front) and not touch anything else in those directories.

## SPEC-Q-4: empty test suites
Until later leaves add tests, `vitest run` exits 1 ("No test files found"). CI (G3) must be green, so `test:unit`/`test:integration` use `--passWithNoTests`. This skips nothing; it only accepts an empty suite. Confirm, or have later leaves' first merge remove it.

## SPEC-Q-5: apps/mobile
ARC-2 lists `apps/mobile` (Expo, phase B). OQ-3 default is PWA in v1, native in phase B. I do not create `apps/mobile` or declare Expo.

## SPEC-Q-6: docker-compose.yml scope
ARC-11 wants `postgres:16`, `web` and `worker` services, but no leaf owns a Dockerfile and ARC-11 is not cited by 1.1.1's gates. I create `docker-compose.yml` with the `postgres:16` service only (used for local integration tests). Adding `web`/`worker` needs a Dockerfile owner.

## SPEC-Q-7: EMAIL_* variable names
ARC-9 lists `EMAIL_*` without names. `.env.example` will document `EMAIL_FROM` and `EMAIL_SERVER` (SMTP URL), both optional; 1.4.1 may rename them through the architect.

## SPEC-Q-8: unowned tool configs
No leaf owns `vitest.config.*`, `apps/web/playwright.config.ts`, `packages/db/drizzle.config.ts`, `apps/web/postcss.config.mjs` or `apps/web/next-env.d.ts`. 1.1.1 does not need them (Vitest runs from CLI flags). Flagged so the architect can assign them before 1.1.2 / 1.4.2 dispatch.

## Tooling note
The builder prompt's `gate-check.mjs --root . --cwd . --status` exits 2 ("--cwd ... are execution options only"). `--status` works without `--cwd`; `--approve`/`--reverify` keep `--cwd .`.

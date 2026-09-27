# Leaf 1.4.5 ADR-1 — how the gates verify (stubbed model, worker, isolation)

Status: proposed at CP1.

## Context

G1 needs a real flow across two processes: a review is posted in the web app, the insights engine (a `insights.run` job in `apps/worker`) turns it into a proposal, the admin accepts it and undoes it. "With the stubbed model" (BLD-5): there is no `ANTHROPIC_API_KEY`, and the chat route answers `503 assistant_unavailable` without a model. G3 needs every AGT-7 card rendered from recorded tool results. Gates run in parallel under `gate-check` (BLD-4).

## Decision

`scripts/verify/leaf-1.4.5.mjs --gate G1|G2|G3` follows leaf 1.4.6's script (ADR-3 there) and adds the worker and the model stub. Per gate, independently:

1. Builds stale workspace packages under a lock (as 1.4.1/1.4.6 do), then `apps/worker` (`tsc`) under the same lock.
2. Creates its own database `leaf145_<gate>_<hex>` on PostgreSQL 16 (`DATABASE_URL`'s server, else localhost:5432, else a throwaway cluster), migrates it, and seeds it through the merged services (`@mealplanner/db` dist): a signed-up admin household with F1-like members, the catalogue loader (R-17) and one member login.
3. Builds the web app into its own dist dir `.next/verify-1.4.5-<gate>` with `DATABASE_URL` cleared (R-50) and starts it (`next start`, own free port, random `AUTH_SECRET`, never printed).
4. **Model stub.** The web server is started with `NODE_OPTIONS=--import <tmp>/agent-stub.mjs`. The preload installs a scripted `AgentModel` at `globalThis[Symbol.for("mealplanner.web.agentModel")]`, the slot `agentModel()` in `apps/web/lib/server/agent.ts` already reads (1.3.5's `useAgentModel` uses the same key). No production file changes and no environment switch exists in the app: without the preload the server behaves as in production (no credential → 503). The stub is a script, not a model: it looks at the last user text and returns canned `BetaMessage`s (e.g. "what have you learned" → a `tool_use` of `run_insights`, then a short text), streaming the same `content_block_*` events the SDK would. It lives in `apps/web/e2e/chat/` if SPEC-Q-14 is granted, else the script writes it to the gate's temp directory.
5. **Worker.** G1 starts `apps/worker/dist/src/main.js` against the gate's database (no model: synthesis is disabled with its reason, the deterministic rules run, FBK-7), so `insights.run` and the digest post (R-46, `chat-events.ts`) are the real ones. It is stopped in `finally`.
6. Runs `apps/web/e2e/chat.spec.ts --grep @<gate>` and requires every named test — negative controls included — to be present and passing (Playwright JSON report), then re-checks outcomes in the database with its own queries, each also run on a known-bad row that must fail:
   - G1: the proposal is `accepted` with a `change_set_id`; that change set has `undone_at` and `undone_by_change_set_id`; the reviews exist with the tags the UI sent, `on_behalf_of_member_id` as chosen. Negative controls: the same checks against a pending proposal and a change set that was not undone.
   - G2: axe-core (`@axe-core/playwright`, R-45) on every screen of this leaf at 390 px and 1280 px, light and dark, zero serious/critical; negative control: a fixture page with an unnamed button and low-contrast text is reported. BLD-8 W-1: 1.4.2's `e2e/shell.spec.ts @G2` runs alongside against its own database-less server; any failure prints full output.
   - G3: the recorded tool results (one per AGT-7 card type: `proposal`, `applied_change`, `plan_day`, `recipe`, `macro_table`, `job_progress`, `insight_digest`, `iteration_limit`) are written as `tool` and `event` rows of a conversation; the chat page renders each card with its type-specific content, both on replay (`GET …/messages`) and live (the stub streams `tool_done` events carrying the same cards). Negative control: an unknown card type and a malformed `proposal` card render the "cannot show this card" fallback, and the assertion that looks for a proposal card's diff fails on them. The recorded `proposal`, `applied_change`, `plan_day` and `job_progress` cards are recorded from the real tool ports (the stub calls `propose_change`, `apply_change`, `get_plan`, `generate_plan` against the seeded household); `recipe`, `insight_digest` and `iteration_limit` from `jobCompletionEvent`, `insightDigestEvent` and the loop's cap with recorded inputs; `macro_table` from the SPEC-Q-4 shape.
7. Drops the database, stops the worker, the server and any throwaway cluster, removes the temp directory.

Concurrency: every gate has its own database, dist dir, ports and temp directory; the only shared step is the package build, taken under a lock.

## Timeout

Each gate does a `next build` (≈ 1–2 min cold on this container) plus Playwright runs at two widths; G1 also runs plan generation and an insights job. Measured timings are recorded here at CP2. The architect is asked for `gate-check --timeout` (1.4.6 was granted 600 s) rather than cutting coverage; the requested value is set from the CP2 measurements.

## Consequences

The gates exercise the merged route, loop, tools, worker handlers and database; only the model is replaced, and only through the slot the route already exposes to tests.

# leaf-1.3.3 ADR-1: insights engine layout and proposal shape

Status: proposed at CP1.

## Context

FBK-7 has two stages: deterministic rules, then LLM synthesis. FBK-8 adds guardrails, and FBK-9 adds accepting and rejecting. R-2 forbids `ai` importing `db`, and ARC-3 keeps `core` pure. Proposals are change sets that are proposed rather than applied: registered ops from `@mealplanner/core/changes` (AGT-6, DM-6). Protected ops are never proposed by the engine (AGT-5, R-10).

## Decision

Three layers, each inside this leaf's OWNS:

| Layer | Path | Does | Imports |
|---|---|---|---|
| Rules and guardrails (pure) | `packages/core/src/learning/rules/**` → `@mealplanner/core/learning/rules` | `runRules(input) → Candidate[]`, one module per rule; `fingerprintOf(ops)`; `selectProposals(...)` (Zod validation, static protection, fingerprint suppression, duplicate-pending skip, budget); constants in `rules/config.ts` | `core/changes`, `core/learning/preferences`, `core/types` |
| Synthesis | `packages/ai/src/insights/**` → `@mealplanner/ai/insights` | `synthesizeInsights(deps, input)` builds the pseudonymised request, calls the injected `StructuredModel` from 1.3.1, validates each proposal (ADR-2), and records one `ai_generation` row through a port (DM-7) | `ai/client`, `core/*` |
| Service | `packages/db/src/services/proposals/**` → `@mealplanner/db/services/proposals` | `runInsights`, `insightsDue`, `createProposals`, `listProposals`, `expireProposals`, `acceptProposal`, `rejectProposal`; loads rule input from household-scoped repos; conditional AGT-5 check through the change-set `ChangeTx`; stores rows; sets `review.processed_at` | `core/*`, `db` internals. Synthesis arrives as an injected function (R-2), wired by `apps/*` |

### Proposal row

- `payload` = `{ title: string, ops: ChangeOp[] }`, validated by `ProposalPayloadSchema` (ops parsed with `ChangeOpSchema`, at least 1).
- `kind` = the kind of the first op, which is the one the fingerprint and card lead with.
- `evidence` = `{ reviewIds: uuid[], count: number, metrics: Record<string, number> }`.
- `origin` = `rule` for rule candidates, `insights` for synthesised ones, and `agent_chat` for the agent (1.3.5).
- `expires_at` = creation + 14 days.

SPEC-Q-2 records this reading.

### Guardrails (FBK-8)

Applied in this order in `createProposals`, inside one transaction per household (the household row is locked as in `inHouseholdTransaction`):

1. **Zod.** Every op must parse with `ChangeOpSchema`, and the payload with `ProposalPayloadSchema`. A failure drops the draft with a reason.
2. **Protected.**
   - Any origin: `access.block`, `access.remove`, `access.link_member` and `support.grant` are never proposed (R-10).
   - `rule` and `insights` origins: an op is also refused when the registry flags it protected, including the conditional checks (`exclusion.remove`, a relaxing `exclusion.add`, a loosening `tolerance.set`, `dish.retire` of a reviewed dish), which are evaluated against current state.
3. **Expiry.** Pending rows past `expires_at` become `expired` before counting.
4. **Duplicate pending.** A draft whose fingerprint equals a pending proposal's is skipped.
5. **Fingerprint cooldown.** A draft is suppressed if its fingerprint matches a proposal rejected in the last 30 days (by `decided_at`), unless its `evidence.count` is at least twice that proposal's.
6. **Budget.** At most 5 pending per household. Survivors are ordered by priority, then evidence count, then fingerprint (deterministic). The rest are not stored (SPEC-Q-5).

Every dropped draft is returned with its reason, so the caller and the tests can see why.

### Rules (FBK-6, FBK-7, FBK-5 targeted, SC-3)

Each rule is a pure function of `InsightInput` with triggering and non-triggering fixture tests (G1). Thresholds live in `rules/config.ts`. The op each rule proposes is listed in the PR traceability table, and the readings are recorded in `leaf-1.3.3-questions.md`.

## Consequences

- The agent (1.3.5) and the Insights and Chat UI (1.4.5) use one service for proposal storage, accept/reject and guardrails.
- Accepting applies the ops through `applyChangeSet` with `source: proposal_accept`, `actor: user`. The inverse and undo come from 1.1.2 unchanged.

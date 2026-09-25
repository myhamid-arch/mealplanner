# Build ledgers

The architect's durable build plan for v1. It follows the unlazy orchestrated method, adapted for ephemeral sessions: ledgers are tracked in the repo instead of `.unlazy/`.

- `GATES.md`: root acceptance (SC-1 … SC-7).
- `gates/node-<branch>.md`: branch integration gates.
- `gates/leaf-<id>.md`: one ledger per build leaf. The architect authors OWNS, gates, CHECK and EXPECT. Builders write only the verify scripts the CHECKs call, and the checker writes EVIDENCE.
- `BUILDER_PROMPT.md`: the prompt for a builder session (one leaf per session).

Leaf order, dependencies and waves: `docs/spec/11-build-plan.md` §4. Checkpoints (CP1 plan → CP2 evidence → CP3 architect verify) and anti-drift rules: §7.

| Wave | Leaves (can run in parallel within a wave once their Needs are merged) |
|---|---|
| 1 | 1.1.1 |
| 2 | 1.1.2, 1.1.3, 1.2.1, 1.4.2 |
| 3 | 1.2.2, 1.3.2 |
| 4 | 1.2.4, 1.3.1 |
| 5 | 1.2.3, 1.3.4, 1.3.3 |
| 6 | 1.4.1 |
| 7 | 1.3.5, 1.4.3, 1.4.4, 1.4.6 |
| 8 | 1.4.5 |

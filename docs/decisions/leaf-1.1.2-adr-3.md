# leaf-1.1.2 ADR-3: change-op registry (core) and change-set service (db)

Status: proposed (CP1)
Requirement: AGT-1, AGT-5, AGT-6, DM-6, ARC-3, ARC-4, R2-ADM-4, R2-ADM-7, SC-4

## Problem
AGT-6 puts the registry in `packages/core/src/changes/registry.ts` with `apply(tx, payload)`. ARC-3 forbids `core` from doing I/O or importing `drizzle-orm`.

## Decision
**Core (`@mealplanner/core/changes`, pure).**
- `ChangeTx` is an interface declared in core: `householdId`, `newId()`, `now()`, `get(entity, key)`, `find(entity, where)`, `insert(entity, row)`, `update(entity, key, patch)`, `remove(entity, key)`. Entities are named by the spec table names; rows are plain objects typed from `@mealplanner/core/types`.
- `defineOp({ kind, area, schema, protected, describe, apply, inverse })`. `protected` is `boolean | (payload, tx) => Promise<boolean>` for the conditional ones (`tolerance.set` when looser, `dish.retire` when the dish has reviews, `exclusion.remove` of an allergy).
- `registry` holds every v1 op of AGT-6 plus the r2 ops listed in SPEC-Q-5. `ChangeOp` is the discriminated union `{ kind, payload }`; `ChangeOpSchema` is the Zod union used by UI forms, proposals, insights and the agent.
- `inverse(stateBefore, payload)` returns a list of ops. The before-state is the **before-image of every row the forward op wrote**, captured by the `ChangeTx` implementation (not predicted by the op). The inverse is one internal op, `rows.restore { images: [{ entity, key, before: row | null }] }`: it re-inserts, re-updates or deletes each row to its exact before-image. This makes "apply then inverse restores the exact prior state" (SC-4, G3) hold by construction for every op, including cascades (e.g. `dish.update` rewriting components and variants). `rows.restore` is not in the public `ChangeOpSchema`, so the agent, forms and proposals can never send it.
- `describe(payload, state)` produces `{ area, title, lines: [{ label, before, after }] }` for the proposal and applied-change cards (AGT-7).

**DB (`@mealplanner/db/services/changes`).**
- `applyChangeSet(db, ctx, { actor, actorUserId?, source, summary, ops })`: one transaction; validates every payload with its Zod schema; implements `ChangeTx` over the household-scoped repositories (so every read and write is scoped, DM-1) and records before-images; runs each op's `apply`; enforces invariants (the last-admin rule, R2-ADM-4, checked on the post-state of every change set, including undos); writes `change_set` with `forward` = the ops and `inverse` = the restore ops.
- `source = "agent_apply"` with any protected op, or with `household.agent_may_apply = false`, throws `ProtectedOperationError` listing the ops, before anything is written. Turning that into a proposal is the agent leaf's job (1.3.5); the check is server-side here (AGT-5).
- `undoChangeSet(db, ctx, changeSetId, actor)`: refuses (`ChangeConflictError`, with the conflicting change-set ids and entities) if any change set applied after it touched one of the same `(entity, key)` pairs, derived from the stored inverse images. Refuses if already undone. Otherwise applies the stored inverse as a new change set and sets `undone_at` / `undone_by_change_set_id`.
- `listChangeSets(db, ctx, { area?, limit })` and `canUndo(...)` back the change log (R2-ADM-7), including the disabled-with-explanation state.

## Why not per-op hand-written inverses
Hand-written inverses must predict every row an op touches; one missed child row breaks "exact prior state" silently. The before-image log cannot miss a row that went through `ChangeTx`, and `ChangeTx` is the only write path the ops have.

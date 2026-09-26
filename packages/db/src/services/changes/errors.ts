// Errors of the change-set service (ADR-3).
import type { ChangeOpKind } from "@mealplanner/core/changes";

export { ChangeOpError } from "@mealplanner/core/changes";

/** A payload failed its op's Zod schema, or the kind is not a public op. */
export class ChangeValidationError extends Error {
  constructor(
    readonly index: number,
    readonly issues: readonly { path: readonly PropertyKey[]; message: string }[],
  ) {
    super(
      `op ${String(index)} is invalid: ${issues.map((i) => `${i.path.map(String).join(".")}: ${i.message}`).join("; ")}`,
    );
    this.name = "ChangeValidationError";
  }
}

/**
 * AGT-5: the agent tried to apply ops that must become a proposal: protected ops, or any op while
 * the household has "Let the assistant apply changes I ask for" switched off. Nothing was written.
 */
export class ProtectedOperationError extends Error {
  constructor(
    readonly reason: "protected" | "agent_may_apply_off",
    readonly kinds: readonly ChangeOpKind[],
  ) {
    super(
      reason === "protected"
        ? `protected op(s) must be proposed, not applied: ${kinds.join(", ")}`
        : "the household does not let the assistant apply changes; propose them instead",
    );
    this.name = "ProtectedOperationError";
  }
}

/** R2-ADM-4: the change set would leave the household without an active admin. */
export class LastAdminError extends Error {
  constructor() {
    super("the last admin can never be blocked, removed or demoted (R2-ADM-4)");
    this.name = "LastAdminError";
  }
}

export interface UndoConflict {
  changeSetId: string;
  summary: string;
  appliedAt: Date;
  /** `entity:key` identifiers both change sets touched. */
  entities: string[];
}

/** AGT-6: a later change set touched the same entities; the undo is refused. */
export class ChangeConflictError extends Error {
  constructor(
    readonly changeSetId: string,
    readonly conflicts: readonly UndoConflict[],
  ) {
    super(
      `cannot undo ${changeSetId}: later change(s) touched the same entities: ${conflicts
        .map((c) => `"${c.summary}" (${c.changeSetId})`)
        .join(", ")}`,
    );
    this.name = "ChangeConflictError";
  }
}

export class AlreadyUndoneError extends Error {
  constructor(
    readonly changeSetId: string,
    readonly undoneByChangeSetId: string | null,
  ) {
    super(`change set ${changeSetId} is already undone`);
    this.name = "AlreadyUndoneError";
  }
}

export class ChangeSetNotFoundError extends Error {
  constructor(readonly changeSetId: string) {
    super(`change set ${changeSetId} not found`);
    this.name = "ChangeSetNotFoundError";
  }
}

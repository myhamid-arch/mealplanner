// Errors of the proposals service (FBK-8, FBK-9).
import type { ProposalStatus } from "@mealplanner/core/types";

export class ProposalNotFoundError extends Error {
  constructor(readonly proposalId: string) {
    super(`proposal ${proposalId} not found`);
    this.name = "ProposalNotFoundError";
  }
}

/** The proposal was already decided, expired or superseded. */
export class ProposalStateError extends Error {
  constructor(
    readonly proposalId: string,
    readonly status: ProposalStatus,
  ) {
    super(`proposal ${proposalId} is ${status}, not pending`);
    this.name = "ProposalStateError";
  }
}

/** Deciding a proposal needs the acting admin in the household context (AGT-1). */
export class ProposalPermissionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProposalPermissionError";
  }
}

/** A stored payload no longer parses (for example, an op's schema changed since it was made). */
export class ProposalPayloadError extends Error {
  constructor(
    readonly proposalId: string,
    readonly issues: string,
  ) {
    super(`proposal ${proposalId} has an invalid payload: ${issues}`);
    this.name = "ProposalPayloadError";
  }
}

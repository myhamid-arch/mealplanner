// Agent constants and environment (AGT-2, ARC-9; leaf-1.3.5 ADR-1).
import type { Effort } from "../client/index.js";

/** AGT-2: model calls per user turn. */
export const MAX_MODEL_CALLS = 12;

/** Output budget of one streamed call (streaming has no HTTP-timeout ceiling; ADR-1). */
export const AGENT_MAX_TOKENS = 64_000;

/** AGT-3: server-side compaction of long conversations. */
export const COMPACTION_BETA = "compact-2026-01-12";
export const COMPACTION_EDIT = "compact_20260112";

/** SPEC-Q-4: re-issues of a request whose tool JSON the SDK could not parse at all. */
export const JSON_REISSUE_LIMIT = 2;

export const AGENT_EFFORTS: readonly Effort[] = ["low", "medium", "high", "xhigh", "max"];
export const DEFAULT_AGENT_EFFORT: Effort = "high";

/** `AGENT_EFFORT` (default `high`). An unknown value is a configuration error, not a default. */
export function agentEffort(
  env: Readonly<Record<string, string | undefined>> = process.env,
): Effort {
  const raw = env.AGENT_EFFORT?.trim();
  if (raw === undefined || raw === "") return DEFAULT_AGENT_EFFORT;
  const found = AGENT_EFFORTS.find((e) => e === raw);
  if (found === undefined)
    throw new Error(`AGENT_EFFORT must be one of ${AGENT_EFFORTS.join(", ")} (got "${raw}")`);
  return found;
}

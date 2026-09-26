// FBK-5: quantity feedback updates an untargeted member's learned role bias; targeted members'
// grams are fixed by their targets, so their quantity feedback writes nothing here (SPEC-Q-10).
import type { ParsedChangeOp } from "../../changes/index.js";
import type { ComponentRole, MemberRow, PortionBiasRow } from "../../types/index.js";
import {
  BIAS_DECIMALS,
  DOWN_TAGS,
  PORTION_BIAS_BOUNDS,
  PORTION_FACTORS,
  UP_TAGS,
} from "./config.js";

export type PortionBiasSetOp = Extract<ParsedChangeOp, { kind: "portion_bias.set" }>;

/**
 * The factor a review's tags apply: 0.9, 1.1, or null for no quantity signal. `too_much` together
 * with `too_little`/`still_hungry` cancels (SPEC-Q-9); `just_right` changes nothing.
 */
export function portionFactor(tags: readonly string[]): number | null {
  const down = tags.some((t) => DOWN_TAGS.includes(t));
  const up = tags.some((t) => UP_TAGS.includes(t));
  if (down === up) return null;
  return down ? PORTION_FACTORS.down : PORTION_FACTORS.up;
}

/** `bias · factor`, clamped to [0.6, 1.6] and rounded to the stored precision. */
export function nextBias(bias: number, factor: number): number {
  const scale = 10 ** BIAS_DECIMALS;
  const clamped = Math.min(
    PORTION_BIAS_BOUNDS.max,
    Math.max(PORTION_BIAS_BOUNDS.min, bias * factor),
  );
  return Math.round(clamped * scale) / scale;
}

/**
 * The `portion_bias.set` ops that multiply each distinct role's bias by `factor` (absent rows are
 * 1.0). No ops for a targeted member, for factor 1, or where the bias is already at its bound.
 */
export function portionBiasOpsForFactor(
  member: Pick<MemberRow, "id" | "isTargeted">,
  roles: readonly ComponentRole[],
  factor: number,
  current: readonly PortionBiasRow[],
): PortionBiasSetOp[] {
  if (!Number.isFinite(factor) || factor <= 0)
    throw new RangeError(`factor must be positive, got ${String(factor)}`);
  if (member.isTargeted || factor === 1) return [];
  const ops: PortionBiasSetOp[] = [];
  for (const role of new Set(roles)) {
    const bias =
      current.find((r) => r.memberId === member.id && r.componentRole === role)?.bias ?? 1;
    const next = nextBias(bias, factor);
    if (next === bias) continue;
    ops.push({
      kind: "portion_bias.set",
      payload: { memberId: member.id, componentRole: role, bias: next },
    });
  }
  return ops;
}

/** The FBK-5 `portion_bias.set` ops for one review's tags (see `portionFactor`). */
export function portionBiasOps(
  member: Pick<MemberRow, "id" | "isTargeted">,
  roles: readonly ComponentRole[],
  tags: readonly string[],
  current: readonly PortionBiasRow[],
): PortionBiasSetOp[] {
  const factor = portionFactor(tags);
  return factor === null ? [] : portionBiasOpsForFactor(member, roles, factor, current);
}

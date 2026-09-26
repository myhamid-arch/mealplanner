// FBK-4 score update `score = Σ(wᵢ·sᵢ) / (Σwᵢ + k)`, applied incrementally to the stored `score` and
// `evidence_weight` (leaf-1.3.2 ADR-1), and the `preference.set` ops learning emits.
import type { ParsedChangeOp } from "../../changes/index.js";
import type { PreferenceEntityType, PreferenceRow } from "../../types/index.js";
import { SCORE_DECIMALS, SHRINKAGE_K } from "./config.js";
import type { Contribution } from "./propagate.js";

export interface ScoreState {
  score: number;
  evidenceWeight: number;
}

export type PreferenceSetOp = Extract<ParsedChangeOp, { kind: "preference.set" }>;

function round(value: number): number {
  const factor = 10 ** SCORE_DECIMALS;
  return Math.round(value * factor) / factor;
}

/**
 * Adds weighted signals to a stored state. A negative weight retracts an earlier contribution (a
 * review edit, SPEC-Q-11); the evidence never falls below 0, and no evidence means score 0.
 */
export function accumulate(
  state: ScoreState | null,
  contributions: readonly Pick<Contribution, "weight" | "signal">[],
): ScoreState {
  const w0 = state?.evidenceWeight ?? 0;
  let weightedSum = (state?.score ?? 0) * (w0 + SHRINKAGE_K);
  let weight = w0;
  for (const c of contributions) {
    weightedSum += c.weight * c.signal;
    weight += c.weight;
  }
  weight = round(Math.max(0, weight));
  if (weight === 0) return { score: 0, evidenceWeight: 0 };
  const score = round(Math.min(1, Math.max(-1, weightedSum / (weight + SHRINKAGE_K))));
  return { score: Object.is(score, -0) ? 0 : score, evidenceWeight: weight };
}

/** The same contributions with their weights negated: what retracting them adds. */
export function retract(contributions: readonly Contribution[]): Contribution[] {
  return contributions.map((c) => ({ ...c, weight: -c.weight }));
}

function keyOf(entityType: PreferenceEntityType, entityKey: string): string {
  return `${entityType}\u0000${entityKey}`;
}

/**
 * The `preference.set` ops (source `learned`) that fold `contributions` into member `memberId`'s
 * learned rows, one op per key, in first-seen order. A key whose learned row is locked is skipped:
 * learning never changes a locked preference (FBK-4, SPEC-Q-8). A key whose state would not change
 * gets no op.
 */
export function learningPreferenceOps(
  memberId: string,
  contributions: readonly Contribution[],
  existing: readonly PreferenceRow[],
): PreferenceSetOp[] {
  const learned = new Map<string, PreferenceRow>();
  for (const row of existing)
    if (row.memberId === memberId && row.source === "learned")
      learned.set(keyOf(row.entityType, row.entityKey), row);

  const grouped = new Map<string, Contribution[]>();
  for (const c of contributions) {
    const id = keyOf(c.entityType, c.entityKey);
    const list = grouped.get(id);
    if (list === undefined) grouped.set(id, [c]);
    else list.push(c);
  }

  const ops: PreferenceSetOp[] = [];
  for (const [id, group] of grouped) {
    const first = group[0];
    if (first === undefined) continue;
    const row = learned.get(id);
    if (row?.locked === true) continue;
    const next = accumulate(row ?? null, group);
    if (row !== undefined && row.score === next.score && row.evidenceWeight === next.evidenceWeight)
      continue;
    if (row === undefined && next.evidenceWeight === 0) continue;
    ops.push({
      kind: "preference.set",
      payload: {
        memberId,
        entityType: first.entityType,
        entityKey: first.entityKey,
        score: next.score,
        source: "learned",
        evidenceWeight: next.evidenceWeight,
      },
    });
  }
  return ops;
}

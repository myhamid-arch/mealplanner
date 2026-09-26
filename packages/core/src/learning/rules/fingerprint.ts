// FBK-8 fingerprints: the lead op kind plus the normalised target of each op, and the direction of
// the change where one exists (leaf-1.3.3 SPEC-Q-10, BLD-8 R-33). Values that do not change what
// the proposal is about (the exact score or share) are left out, so the same proposal made again
// with new evidence has the same fingerprint, while "less of X" and "more of X" differ.
import { slotWeight } from "../../planner/targets/index.js";
import type { HouseholdConfig } from "../../types/index.js";
import { DEFAULT_MIN_GAP_DAYS } from "./config.js";

type Payload = Record<string, unknown>;
type OpLike = { kind: string; payload: unknown };

/** A payload value as fingerprint text: primitives as themselves, anything else as JSON. */
function str(v: unknown): string {
  if (v === null || v === undefined) return "∅";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return v.toString();
  return JSON.stringify(v);
}
const member = (p: Payload): string => (p.memberId == null ? "household" : str(p.memberId));

function sign(x: unknown): string {
  if (typeof x !== "number" || x === 0) return "0";
  return x > 0 ? "+" : "-";
}

/** FBK-6: a frequency change is "more" or "less" often than the default gap, or a removal. */
function frequencyDirection(p: Payload): string {
  if (p.minGapDays == null && p.maxPerWeek == null) return "remove";
  if (typeof p.minGapDays === "number") {
    if (p.minGapDays < DEFAULT_MIN_GAP_DAYS) return "more";
    if (p.minGapDays > DEFAULT_MIN_GAP_DAYS) return "less";
    return "default";
  }
  return "cap";
}

/**
 * The slot whose share moves most in a `distribution.set`, and whether it moves away (down) or
 * toward (up), compared with the member's current split (stored rows, or the default weights).
 */
function distributionDirection(p: Payload, config: HouseholdConfig | undefined): string {
  const shares = p.shares as { slotTypeId: string; share: number }[] | null | undefined;
  if (shares == null || shares.length === 0) return "reset";
  const rows = (config?.mealDistributions ?? []).filter(
    (r) => r.memberId === p.memberId && r.dayKind === p.dayKind,
  );
  const stored = shares.map((s) => rows.find((r) => r.slotTypeId === s.slotTypeId)?.share);
  let current: number[];
  if (stored.every((s): s is number => s !== undefined)) {
    current = stored;
  } else {
    current = shares.map((s) => {
      const slot = config?.slotTypes.find((t) => t.id === s.slotTypeId);
      return slot === undefined ? 1 : slotWeight(slot);
    });
  }
  const total = current.reduce((a, b) => a + b, 0);
  const normalised = current.map((c) => (total > 0 ? c / total : 1 / current.length));
  let best = 0;
  let bestDelta = 0;
  shares.forEach((s, i) => {
    const delta = s.share - (normalised[i] ?? 0);
    if (Math.abs(delta) > Math.abs(bestDelta) + 1e-9) {
      best = i;
      bestDelta = delta;
    }
  });
  if (Math.abs(bestDelta) < 1e-6) return "same";
  return `${bestDelta < 0 ? "away" : "toward"}:${shares[best]?.slotTypeId ?? "?"}`;
}

/** Id-like fields (`id`, `…Id`) of a payload, sorted, for kinds without a specific rule. */
function idFields(p: Payload): string {
  return Object.keys(p)
    .filter((k) => (k === "id" || k.endsWith("Id")) && typeof p[k] === "string")
    .sort()
    .map((k) => `${k}=${String(p[k])}`)
    .join("|");
}

/** The fingerprint of one op. `config` lets `distribution.set` read the current split. */
export function opFingerprint(op: OpLike, config?: HouseholdConfig): string {
  const p = (op.payload ?? {}) as Payload;
  switch (op.kind) {
    case "preference.set":
      return `preference.set|${member(p)}|${str(p.entityType)}|${str(p.entityKey)}|${sign(p.score)}${p.hard === "never" ? "|never" : ""}`;
    case "preference.reset":
      return `preference.reset|${member(p)}|${str(p.entityType)}|${str(p.entityKey)}`;
    case "exclusion.add":
      return `exclusion.add|${member(p)}|${str(p.kind)}|${str(p.key)}`;
    case "frequency.set":
      return `frequency.set|${member(p)}|${str(p.entityType)}|${str(p.entityKey)}|${frequencyDirection(p)}`;
    case "distribution.set":
      return `distribution.set|${member(p)}|${str(p.dayKind)}|${distributionDirection(p, config)}`;
    case "ingredient.verify":
      return `ingredient.verify|${str(p.ingredientId)}`;
    default:
      return `${op.kind}|${idFields(p)}`;
  }
}

/** A proposal's fingerprint: its op fingerprints, sorted and joined with `+`. */
export function fingerprintOf(ops: readonly OpLike[], config?: HouseholdConfig): string {
  return [...new Set(ops.map((op) => opFingerprint(op, config)))].sort().join("+");
}

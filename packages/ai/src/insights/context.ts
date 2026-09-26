// Pseudonymised synthesis context (FBK-7, ARC-10; leaf-1.3.3 ADR-2). Members are labels
// ("Adult A", "Child A", as in REC-3); names in household text are scrubbed with 1.3.1's
// `scrubNames`; member ids inside rule candidates' payloads become labels, and the synthesiser
// maps labels in the model's payloads back to ids.
import type { InsightNote, ProposalDraft, SynthesisInput } from "@mealplanner/core/learning/rules";
import { ADULT_AGE, scrubNames } from "../recipes/context.js";

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

export interface Pseudonyms {
  /** Member id → label. */
  labelOf: ReadonlyMap<string, string>;
  /** Label → member id. */
  idOf: ReadonlyMap<string, string>;
  /** Scrubs member names out of household text. */
  scrub: (text: string) => string;
}

function letter(i: number): string {
  let n = i;
  let s = "";
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

/** Labels in member order: adults "Adult A, B …", children "Child A, B …" (REC-3 scheme). */
export function pseudonyms(input: Pick<SynthesisInput, "members" | "referenceDate">): Pseudonyms {
  const year = Number(input.referenceDate.slice(0, 4));
  const labelOf = new Map<string, string>();
  let adults = 0;
  let children = 0;
  for (const m of input.members) {
    const adult = m.birthYear === null || year - m.birthYear >= ADULT_AGE;
    labelOf.set(m.id, adult ? `Adult ${letter(adults++)}` : `Child ${letter(children++)}`);
  }
  const idOf = new Map([...labelOf].map(([id, label]) => [label, id]));
  const names = new Map(input.members.map((m) => [m.displayName, labelOf.get(m.id) ?? ""]));
  const labels = [...labelOf.values()];
  return { labelOf, idOf, scrub: (text) => scrubNames(text, names, labels) };
}

/** Replaces every `memberId` value in a payload with `map(value)` (deep). */
export function mapMemberIds(value: unknown, map: (v: string) => string): Json {
  if (Array.isArray(value)) return value.map((v) => mapMemberIds(v, map));
  if (value === null || typeof value !== "object") return value as Json;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([k, v]) => [
      k,
      k === "memberId" && typeof v === "string" ? map(v) : mapMemberIds(v, map),
    ]),
  );
}

function candidateView(c: ProposalDraft, p: Pseudonyms) {
  return {
    title: p.scrub(c.title),
    rationale: p.scrub(c.rationale),
    priority: c.priority,
    evidenceReviewIds: c.evidence.reviewIds,
    evidenceCount: c.evidence.count,
    ops: c.ops.map((op) => ({
      kind: op.kind,
      payload: mapMemberIds(op.payload, (id) => p.labelOf.get(id) ?? "unknown member"),
    })),
  };
}

function noteView(n: InsightNote, p: Pseudonyms) {
  return {
    title: p.scrub(n.title),
    rationale: p.scrub(n.rationale),
    subject: n.subject,
    evidenceReviewIds: n.evidence.reviewIds,
  };
}

/** The user-message context: everything volatile, pseudonymised. */
export function synthesisContext(input: SynthesisInput, p: Pseudonyms) {
  return {
    members: input.members.map((m) => ({
      label: p.labelOf.get(m.id),
      targeted: m.isTargeted,
    })),
    settings: input.settings,
    ruleCandidates: input.candidates.map((c) => candidateView(c, p)),
    ruleNotes: input.notes.map((n) => noteView(n, p)),
    reviews: input.reviews.map((r) => ({
      id: r.id,
      member: p.labelOf.get(r.memberId) ?? "a family member",
      about: p.scrub(r.about),
      rating: r.rating,
      tags: r.tags,
      comment: r.comment === null ? null : p.scrub(r.comment),
    })),
    recentlyRejected: input.rejected.map((r) => ({
      title: p.scrub(r.title),
      kind: r.kind,
      note: r.decisionNote === null ? null : p.scrub(r.decisionNote),
      decidedAt: r.decidedAt,
    })),
    references: {
      dishes: input.references.dishes.map((d) => ({ id: d.id, name: p.scrub(d.name) })),
      ingredients: input.references.ingredients,
      slots: input.references.slots,
    },
  };
}

export type SynthesisContext = ReturnType<typeof synthesisContext>;

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/** Every uuid the model was shown, which are the only ids a proposal may name. */
export function knownIds(context: SynthesisContext, input: SynthesisInput): Set<string> {
  const ids = new Set<string>(
    (JSON.stringify(context).match(UUID) ?? []).map((id) => id.toLowerCase()),
  );
  for (const m of input.members) ids.add(m.id.toLowerCase());
  return ids;
}

/** Review ids a proposal may cite as evidence. */
export function evidenceIds(input: SynthesisInput): Set<string> {
  return new Set([
    ...input.reviews.map((r) => r.id),
    ...input.candidates.flatMap((c) => c.evidence.reviewIds),
    ...input.notes.flatMap((n) => n.evidence.reviewIds),
  ]);
}

export { UUID };

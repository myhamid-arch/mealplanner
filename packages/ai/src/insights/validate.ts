// Local validation of synthesised proposals (FBK-7: "It MUST NOT emit kinds outside the allowed
// set, and every proposal is validated with Zod before it is stored"; leaf-1.3.3 ADR-2). A
// proposal with any invalid op is dropped whole, and every drop is recorded with its reason.
import { ChangeOpSchema, type ChangeOp } from "@mealplanner/core/changes";
import {
  ProposalDraftSchema,
  type ProposalDraft,
  type SynthesisDrop,
} from "@mealplanner/core/learning/rules";
import { UUID, mapMemberIds, type Pseudonyms } from "./context.js";
import { INSIGHT_KINDS } from "./prompt.js";
import type { WireProposal } from "./schema.js";

export interface ValidationEnv {
  pseudonyms: Pseudonyms;
  /** Ids the model was shown (ADR-2: it may name no other). */
  knownIds: ReadonlySet<string>;
  /** Review ids it may cite. */
  evidenceIds: ReadonlySet<string>;
  /** Overridable for the negative control; defaults to INSIGHT_KINDS. */
  allowedKinds?: readonly string[];
}

type Outcome = { ok: true; draft: ProposalDraft } | { ok: false; drop: SynthesisDrop };

function fail(
  index: number,
  title: string,
  reason: SynthesisDrop["reason"],
  detail: string,
  kind?: string,
): Outcome {
  return {
    ok: false,
    drop: { index, title, reason, detail, ...(kind === undefined ? {} : { kind }) },
  };
}

function validateOne(p: WireProposal, index: number, env: ValidationEnv): Outcome {
  const allowed = env.allowedKinds ?? INSIGHT_KINDS;
  const title = p.title;
  const ops: ChangeOp[] = [];
  for (const wire of p.ops) {
    if (!allowed.includes(wire.kind))
      return fail(index, title, "invalid_kind", `kind "${wire.kind}" is not allowed`, wire.kind);
    let raw: unknown;
    try {
      raw = JSON.parse(wire.payloadJson);
    } catch (error) {
      return fail(
        index,
        title,
        "invalid_json",
        error instanceof Error ? error.message : String(error),
        wire.kind,
      );
    }
    let unknownMember: string | undefined;
    const payload = mapMemberIds(raw, (label) => {
      const id = env.pseudonyms.idOf.get(label);
      if (id === undefined) unknownMember ??= label;
      return id ?? label;
    });
    if (unknownMember !== undefined)
      return fail(index, title, "unknown_member", `no member "${unknownMember}"`, wire.kind);
    const unknownId = (JSON.stringify(payload).match(UUID) ?? []).find(
      (id) => !env.knownIds.has(id.toLowerCase()),
    );
    if (unknownId !== undefined)
      return fail(
        index,
        title,
        "unknown_reference",
        `id ${unknownId} was not in the input`,
        wire.kind,
      );
    const parsed = ChangeOpSchema.safeParse({ kind: wire.kind, payload });
    if (!parsed.success)
      return fail(
        index,
        title,
        "invalid_payload",
        parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
        wire.kind,
      );
    // Stored as sent (defaults are filled in again when the op is applied).
    ops.push({ kind: wire.kind, payload } as ChangeOp);
  }
  const unknownEvidence = p.evidenceReviewIds.find((id) => !env.evidenceIds.has(id));
  if (unknownEvidence !== undefined)
    return fail(index, title, "unknown_evidence", `review ${unknownEvidence} was not in the input`);
  const draft: ProposalDraft = {
    origin: "insights",
    title: env.pseudonyms.scrub(p.title.trim()),
    rationale: env.pseudonyms.scrub(p.rationale.trim()),
    ops,
    evidence: {
      reviewIds: [...new Set(p.evidenceReviewIds)].sort(),
      count: new Set(p.evidenceReviewIds).size,
      metrics: {},
    },
    priority: p.priority,
  };
  const checked = ProposalDraftSchema.safeParse(draft);
  if (!checked.success)
    return fail(
      index,
      title,
      "invalid_proposal",
      checked.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
    );
  return { ok: true, draft };
}

export function validateProposals(
  proposals: readonly WireProposal[],
  env: ValidationEnv,
): { proposals: ProposalDraft[]; dropped: SynthesisDrop[] } {
  const kept: ProposalDraft[] = [];
  const dropped: SynthesisDrop[] = [];
  proposals.forEach((p, index) => {
    const outcome = validateOne(p, index, env);
    if (outcome.ok) kept.push(outcome.draft);
    else dropped.push(outcome.drop);
  });
  return { proposals: kept, dropped };
}
